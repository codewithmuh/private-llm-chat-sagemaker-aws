"""Any server that speaks the OpenAI Chat Completions API.

That covers a lot: vLLM (`vllm serve`), Ollama (`/v1`), LM Studio, llama.cpp's
server, Hugging Face TGI, and OpenAI itself. Point `base_url` at the `/v1`
root and set `model_id` to the name the server knows the model by.
"""

from __future__ import annotations

from collections.abc import Iterator

import httpx
from django.conf import settings

from .base import ChatRequest, ChunkParser, Provider, ProviderError, Usage, error_from_body


class OpenAICompatibleProvider(Provider):
    def __init__(
        self,
        base_url: str,
        model_id: str,
        api_key: str = "",
        timeout: float | None = None,
        transport: httpx.BaseTransport | None = None,  # tests inject a fake one
    ):
        self.base_url = base_url.rstrip("/")
        self.model_id = model_id
        self.api_key = api_key
        self.timeout = timeout or settings.LLM_TIMEOUT_SECONDS
        self.transport = transport

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def stream(self, request: ChatRequest) -> Iterator[str | Usage]:
        body = {
            "model": self.model_id,
            "messages": request.messages,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "stream": True,
            # Ask for token counts in the last chunk (OpenAI, vLLM, Ollama).
            "stream_options": {"include_usage": True},
            **request.extra,
        }
        parser = ChunkParser()
        timeout = httpx.Timeout(self.timeout, connect=10.0)
        try:
            with httpx.Client(timeout=timeout, transport=self.transport) as client:
                with client.stream(
                    "POST", f"{self.base_url}/chat/completions", json=body, headers=self._headers()
                ) as response:
                    if response.status_code >= 400:
                        raise error_from_body(response.read().decode("utf-8", "replace"), response.status_code)
                    for line in response.iter_lines():
                        yield from parser.feed_line(line)
                        if parser.done:
                            break
        except httpx.ConnectError:
            raise ProviderError(
                f"Could not reach the model server at {self.base_url}. Is it running?",
                "model_unavailable",
            ) from None
        except httpx.TimeoutException:
            raise ProviderError("The model took too long to answer.", "provider_error") from None
        except httpx.HTTPError as exc:
            raise ProviderError(f"Connection to the model server failed ({type(exc).__name__}).") from None
        yield from parser.finish()
        yield parser.usage
