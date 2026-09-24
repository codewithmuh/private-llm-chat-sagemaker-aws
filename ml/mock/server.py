"""A fake LLM server for local development: no GPU, no downloads.

It speaks the two contracts a real model server speaks in this project:

    OpenAI API      POST /v1/chat/completions   (what vLLM, Ollama, LM Studio expose)
    SageMaker       GET  /ping, POST /invocations  (what every SageMaker container must expose)

So `docker compose up` exercises the backend's real HTTP streaming code path,
and this file doubles as a readable example of what a model container has to
implement to run on SageMaker. The answers are canned: it describes what it
received, so you can see exactly what the backend sends to a model.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

TOKENS_PER_SECOND = float(os.environ.get("MOCK_TOKENS_PER_SECOND", "40"))
MODEL_NAMES = [m.strip() for m in os.environ.get("MOCK_MODEL_NAMES", "mock-chat,mock-vision").split(",") if m.strip()]

app = FastAPI(title="Mock LLM", docs_url=None, redoc_url=None)


def _flatten(content) -> tuple[str, int]:
    if isinstance(content, str):
        return content, 0
    texts, images = [], 0
    for part in content or []:
        if part.get("type") == "text":
            texts.append(part.get("text", ""))
        elif part.get("type") == "image_url":
            images += 1
    return "\n".join(texts), images


def answer_for(body: dict) -> str:
    messages = body.get("messages") or []
    last_user = next((m for m in reversed(messages) if m.get("role") == "user"), {})
    text, images = _flatten(last_user.get("content"))
    documents = re.findall(r'<(?:document|image) name="([^"]+)"', text)
    question = re.sub(r"<(document|image)[^>]*>.*?</\1>", "", text, flags=re.DOTALL).strip()

    if question.lower().startswith("transcribe all text"):
        return (
            "# Mock OCR result\n\nThis text was produced by **ml/mock**, not by reading your image.\n\n"
            "| Item | Price |\n|---|---|\n| Coffee | 3.50 |\n| Bagel | 2.25 |"
        )
    if "short title" in question.lower():
        first = re.search(r"<message>(.*?)</message>", text, re.DOTALL)
        words = re.findall(r"[\w']+", first.group(1) if first else "")[:5]
        return " ".join(words).capitalize() or "New conversation"

    system = next((m for m in messages if m.get("role") == "system"), None)
    lines = [
        f"Hello from the **mock LLM server** (`ml/mock`), answering as `{body.get('model')}`.",
        "",
        "I can't think, but I can show you what the backend sent me:",
        "",
        f"- **Your message:** {question[:300] or '(no text)'}",
        f"- **Messages in the request:** {len(messages)} (the backend re-sends the whole conversation every turn)",
        f"- **System prompt:** {len(system['content']) if system else 0} characters",
        f"- **max_tokens:** {body.get('max_tokens')}, **temperature:** {body.get('temperature')}",
    ]
    if documents:
        lines.append(f"- **Files pasted into the prompt:** {', '.join(documents)}")
    if images:
        lines.append(f"- **Images attached:** {images} (base64 `image_url` parts)")
    lines += [
        "",
        "```bash",
        "# Next step: talk to a real model",
        "docker compose --profile ollama up -d   # see docs/02-run-a-real-model-locally.md",
        "```",
    ]
    return "\n".join(lines)


def _chunk(completion_id: str, model: str, delta: dict, finish: str | None = None) -> str:
    return json.dumps(
        {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }
    )


async def _stream(body: dict):
    answer = answer_for(body)
    model = body.get("model") or MODEL_NAMES[0]
    cid = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    yield f"data: {_chunk(cid, model, {'role': 'assistant', 'content': ''})}\n\n"
    delay = 1.0 / TOKENS_PER_SECOND if TOKENS_PER_SECOND > 0 else 0
    for token in re.findall(r"\S+\s*|\s+", answer):
        await asyncio.sleep(delay)
        yield f"data: {_chunk(cid, model, {'content': token})}\n\n"
    yield f"data: {_chunk(cid, model, {}, 'stop')}\n\n"
    if (body.get("stream_options") or {}).get("include_usage"):
        prompt_tokens = sum(len(str(m.get("content", ""))) for m in body.get("messages", [])) // 4
        usage = {"prompt_tokens": prompt_tokens, "completion_tokens": len(answer) // 4, "total_tokens": 0}
        yield f"data: {json.dumps({'id': cid, 'object': 'chat.completion.chunk', 'choices': [], 'usage': usage})}\n\n"
    yield "data: [DONE]\n\n"


async def _complete(request: Request):
    body = await request.json()
    if body.get("stream"):
        return StreamingResponse(_stream(body), media_type="text/event-stream")
    answer = answer_for(body)
    return JSONResponse(
        {
            "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": body.get("model"),
            "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": len(answer) // 4, "total_tokens": 0},
        }
    )


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    return await _complete(request)


@app.post("/invocations")
async def invocations(request: Request):
    """SageMaker sends every inference request here."""
    return await _complete(request)


@app.get("/ping")
async def ping():
    """SageMaker's health check: 200 means 'ready for traffic'."""
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok", "models": MODEL_NAMES}


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": m, "object": "model", "owned_by": "mock"} for m in MODEL_NAMES]}
