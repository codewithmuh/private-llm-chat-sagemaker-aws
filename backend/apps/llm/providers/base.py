"""The provider interface: one way to talk to every kind of model server.

Every provider takes an OpenAI-style chat request and yields the answer
piece by piece. The rest of the app never needs to know whether the model
runs on SageMaker, on a vLLM box, in Ollama on a laptop, or is the mock.

    for piece in provider.stream(request):
        if isinstance(piece, Usage): ...   # token counts, at the end
        else: ...                          # a str: the next bit of the answer
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field


@dataclass
class ChatRequest:
    messages: list[dict]  # OpenAI chat format (see prompting.py)
    max_tokens: int = 2048
    temperature: float = 0.7
    extra: dict = field(default_factory=dict)  # passed through to the server


@dataclass
class Usage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass
class Completion:
    text: str
    usage: Usage


class ProviderError(Exception):
    """Something went wrong talking to the model. `code` is one of:

    provider_error      the server answered with an error
    model_starting      the GPU endpoint is not up yet (retry later)
    model_unavailable   cannot reach it / it is switched off
    context_too_long    the conversation does not fit the model's window
    """

    def __init__(self, message: str, code: str = "provider_error"):
        super().__init__(message)
        self.code = code
        self.message = message


class Provider:
    def stream(self, request: ChatRequest) -> Iterator[str | Usage]:
        raise NotImplementedError

    def complete(self, request: ChatRequest) -> Completion:
        """Non-streaming convenience built on stream()."""
        parts: list[str] = []
        usage = Usage()
        for piece in self.stream(request):
            if isinstance(piece, Usage):
                usage = piece
            else:
                parts.append(piece)
        return Completion(text="".join(parts), usage=usage)


# --------------------------------------------------- parsing the stream ----

_CONTEXT_ERRORS = re.compile(
    r"maximum context length|context length|too many tokens|prompt is too long|max_model_len",
    re.IGNORECASE,
)


def error_from_body(body: str | dict, status: int | None = None) -> ProviderError:
    """Turn a server's error body into a ProviderError with a useful code."""
    message = ""
    if isinstance(body, dict):
        err = body.get("error", body)
        message = err.get("message", "") if isinstance(err, dict) else str(err)
        message = message or str(body.get("message", ""))
    else:
        try:
            return error_from_body(json.loads(body), status)
        except (ValueError, TypeError):
            message = body
    message = (message or f"HTTP {status}").strip()[:500]
    if _CONTEXT_ERRORS.search(message):
        return ProviderError(
            "This conversation is too long for the model. Start a new chat or remove a large file.",
            "context_too_long",
        )
    return ProviderError(f"The model server returned an error: {message}", "provider_error")


class ChunkParser:
    """Turns raw stream lines into answer text.

    Handles both shapes you meet in the wild:
      * Server-Sent Events:  `data: {...chunk...}` ... `data: [DONE]`
        (OpenAI, vLLM, Ollama, and SageMaker's vLLM containers)
      * JSON lines:          `{...chunk...}`  (SageMaker LMI containers)

    Reasoning models (DeepSeek-R1, Qwen3 "thinking") may send their thinking in
    a separate `reasoning_content` field. It is wrapped in <think>...</think>
    so the answer keeps one shape; the UI shows it as a collapsible block.
    """

    def __init__(self) -> None:
        self.usage = Usage()
        self.done = False
        self._in_reasoning = False

    def feed_line(self, line: str) -> list[str]:
        line = line.strip()
        if not line or line.startswith(":") or line.startswith("event:"):
            return []
        if line.startswith("data:"):
            line = line[5:].strip()
        if line == "[DONE]":
            self.done = True
            return self._close_reasoning()
        try:
            chunk = json.loads(line)
        except ValueError:
            return []
        if not isinstance(chunk, dict):
            return []
        if "error" in chunk or chunk.get("object") == "error":
            raise error_from_body(chunk)

        usage = chunk.get("usage")
        if isinstance(usage, dict):
            self.usage = Usage(usage.get("prompt_tokens"), usage.get("completion_tokens"))

        out: list[str] = []
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or choice.get("message") or {}
            reasoning = delta.get("reasoning_content") or delta.get("reasoning")
            if reasoning:
                if not self._in_reasoning:
                    self._in_reasoning = True
                    out.append("<think>\n")
                out.append(reasoning)
            content = delta.get("content")
            if content:
                out.extend(self._close_reasoning())
                out.append(content)
        return out

    def finish(self) -> list[str]:
        return self._close_reasoning()

    def _close_reasoning(self) -> list[str]:
        if self._in_reasoning:
            self._in_reasoning = False
            return ["\n</think>\n\n"]
        return []


def split_lines(chunks: Iterable[bytes]) -> Iterator[str]:
    """Re-assemble lines from arbitrary byte chunks (a line can be split
    across two network packets, or two lines can arrive in one)."""
    buffer = b""
    for chunk in chunks:
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            yield line.decode("utf-8", errors="replace")
    if buffer.strip():
        yield buffer.decode("utf-8", errors="replace")
