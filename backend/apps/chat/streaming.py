"""Streaming an answer to the browser with Server-Sent Events (SSE).

SSE is plain HTTP: the response stays open and the server writes small text
events as they happen:

    event: delta
    data: {"content": "Hel"}

    event: delta
    data: {"content": "lo"}

The browser appends each piece as it arrives, which is what makes the answer
"type itself" like in ChatGPT.

How it is wired:

  * A background thread reads the model's stream (HTTP to vLLM/Ollama, or the
    SageMaker streaming API) and puts each piece on a queue.
  * This generator takes pieces off the queue and yields SSE events. While
    it waits (e.g. the model is reading a long document before its first
    token) it sends a `: ping` comment every few seconds, so proxies like
    CloudFront (60 s idle timeout) don't close the connection.
  * The answer is saved to the database every couple of seconds, and at the
    end, so a reload mid-answer shows what was written so far.
  * Stopping: the user clicks Stop -> POST /api/messages/{id}/stop/ sets a
    flag we check here; or the browser just closes the connection, which
    raises GeneratorExit at our `yield`. Either way the partial answer is
    kept with status "stopped".
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections.abc import Iterator

from apps.files.ocr import run_ocr
from apps.llm.models import LLMModel
from apps.llm.providers import ChatRequest, ProviderError, Usage, provider_for

from .models import Conversation, Message
from .prompting import ContextTooLong, build_prompt, images_needing_ocr
from .titles import generate_title

log = logging.getLogger(__name__)

PING_EVERY_SECONDS = 10
SAVE_EVERY_SECONDS = 2.0
_END = object()


def sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


PING = b": ping\n\n"


class _ProducerThread(threading.Thread):
    """Runs provider.stream() and hands pieces to the web request over a queue."""

    def __init__(self, provider, request: ChatRequest):
        super().__init__(daemon=True)
        self.provider = provider
        self.request = request
        self.queue: queue.Queue = queue.Queue()
        self.cancelled = threading.Event()

    def run(self) -> None:
        pieces = self.provider.stream(self.request)
        try:
            for piece in pieces:
                if self.cancelled.is_set():
                    break
                self.queue.put(piece)
        except Exception as exc:  # noqa: BLE001 - handed to the consumer
            self.queue.put(exc)
        finally:
            pieces.close()  # closes the HTTP stream to the model server
            self.queue.put(_END)


def stream_answer(
    *,
    conversation: Conversation,
    model: LLMModel,
    user,
    user_message: Message | None,
    assistant: Message,
    first_exchange: bool,
) -> Iterator[bytes]:
    yield sse(
        "start",
        {
            "user_message": user_message.as_api() if user_message else None,
            "assistant_message": assistant.as_api(),
        },
    )

    started = time.monotonic()
    parts: list[str] = []
    usage = Usage()
    status = Message.Status.STREAMING
    error: ProviderError | None = None
    producer: _ProducerThread | None = None

    def save(final: bool) -> None:
        fields = {"content": "".join(parts)}
        if final:
            fields.update(
                status=status,
                error=(error.message if error else "")[:1000],
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        Message.objects.filter(pk=assistant.pk).update(**fields)

    try:
        # A text-only model can't see images: read them first (OCR).
        if user_message is not None:
            for attachment in images_needing_ocr(user_message, model):
                try:
                    run_ocr(attachment)
                except Exception:  # noqa: BLE001 - the prompt says "could not be read"
                    log.info("auto-OCR failed", extra={"attachment_id": str(attachment.id)})
                yield PING

        try:
            prompt = build_prompt(conversation, model, user)
        except ContextTooLong:
            raise ProviderError(
                "This conversation is too long for the model. Start a new chat or remove a large file.",
                "context_too_long",
            ) from None

        producer = _ProducerThread(
            provider_for(model),
            ChatRequest(messages=prompt.messages, max_tokens=prompt.max_tokens, temperature=model.temperature),
        )
        producer.start()
        last_save = time.monotonic()
        while True:
            try:
                piece = producer.queue.get(timeout=PING_EVERY_SECONDS)
            except queue.Empty:
                yield PING
                continue
            if piece is _END:
                break
            if isinstance(piece, Exception):
                raise piece
            if isinstance(piece, Usage):
                usage = piece
                continue
            parts.append(piece)
            yield sse("delta", {"content": piece})

            if time.monotonic() - last_save > SAVE_EVERY_SECONDS:
                last_save = time.monotonic()
                save(final=False)
                if Message.objects.filter(pk=assistant.pk, stop_requested=True).exists():
                    status = Message.Status.STOPPED
                    break
        if status == Message.Status.STREAMING:
            status = Message.Status.COMPLETE
    except ProviderError as exc:
        status, error = Message.Status.ERROR, exc
    except GeneratorExit:
        # The browser went away (tab closed, Stop pressed). Keep what we have.
        status = Message.Status.STOPPED
        if producer:
            producer.cancelled.set()
        save(final=True)
        raise
    except Exception:
        log.exception("chat stream failed", extra={"message_id": str(assistant.pk)})
        status, error = Message.Status.ERROR, ProviderError("Something went wrong while answering.")
    finally:
        if producer:
            producer.cancelled.set()

    save(final=True)
    assistant.refresh_from_db()
    log.info(
        "answer finished",
        extra={
            "message_id": str(assistant.pk),
            "model": model.slug,
            "status": status,
            "duration_ms": assistant.duration_ms,
            "completion_tokens": usage.completion_tokens,
        },
    )
    if error is not None:
        yield sse("error", {"code": error.code, "error": error.message, "message": assistant.as_api()})
        return
    yield sse("done", {"message": assistant.as_api()})

    if first_exchange and not conversation.title and user_message is not None:
        # No text (just a file)? Name the chat after the file.
        source = user_message.content or ", ".join(a.filename for a in user_message.attachments.all())
        title = generate_title(model, source)
        Conversation.objects.filter(pk=conversation.pk).update(title=title)
        yield sse("title", {"conversation_id": str(conversation.pk), "title": title})
