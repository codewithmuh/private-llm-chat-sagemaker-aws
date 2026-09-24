"""Several models on ONE GPU, behind one SageMaker endpoint (advanced).

The beginner path runs one model per endpoint with AWS's ready-made vLLM
container. That is simple, but each endpoint is a whole GPU billed by the hour.
A 48 GB L40S is often mostly empty with one 8B model on it. This router starts
several `vllm serve` processes on the same GPU, each with its share of GPU
memory, and puts SageMaker's container contract in front of them:

    GET  /ping                 200 only when EVERY model is loaded
    POST /invocations          routed by the request's "model" field
    POST /v1/chat/completions  same, for local testing with OpenAI clients

Configure it with MODELS_JSON, e.g. a vision model plus a fast text model:

    [{"name": "Qwen/Qwen3-VL-8B-Instruct-FP8", "gpu_fraction": 0.55,
      "args": ["--max-model-len", "16384", "--limit-mm-per-prompt", "{\"image\": 4}"]},
     {"name": "Qwen/Qwen3-4B", "gpu_fraction": 0.35,
      "args": ["--max-model-len", "16384"]}]

Each entry: `name` (served model name, what clients send as "model"), `path`
(optional: a Hugging Face id or a folder under /opt/ml/model; default = name),
`gpu_fraction` (share of GPU memory; the fractions must add up to < 1),
`args` (extra `vllm serve` flags, passed verbatim).

Lessons that shaped this file (from running it in production):

* It drives `vllm serve` (vLLM's own OpenAI server) instead of vLLM's Python
  engine API. The engine API changes between releases and each change only
  showed up as a crash on SageMaker after a 20-minute deploy; `vllm serve` is
  the most-tested entrypoint and applies each model's chat template itself.
* Models start one after another, not in parallel: each vLLM process measures
  free GPU memory at startup, and two measuring at once both claim the same
  memory.
* /ping must not say "ok" until every model answers. Answering early makes
  SageMaker send traffic to a half-loaded endpoint.
* Request bodies are never logged (they are people's conversations).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("uvicorn.access").disabled = True
log = logging.getLogger("router")

MODEL_DIR = os.environ.get("MODEL_DIR", "/opt/ml/model")
STARTUP_TIMEOUT = int(os.environ.get("BACKEND_STARTUP_TIMEOUT", "1500"))
FIRST_PORT = 8001


@dataclass
class Backend:
    name: str
    path: str
    port: int
    gpu_fraction: float
    args: list[str]
    process: asyncio.subprocess.Process | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def load_backends() -> list[Backend]:
    raw = os.environ.get("MODELS_JSON", "").strip()
    if not raw:
        # Single-model mode: MODEL_ID (+ GPU_MEMORY_UTILIZATION, MAX_MODEL_LEN).
        model = os.environ.get("MODEL_ID")
        if not model:
            raise SystemExit("Set MODELS_JSON (a list) or MODEL_ID.")
        raw = json.dumps(
            [
                {
                    "name": model,
                    "gpu_fraction": float(os.environ.get("GPU_MEMORY_UTILIZATION", "0.90")),
                    "args": ["--max-model-len", os.environ.get("MAX_MODEL_LEN", "16384")],
                }
            ]
        )
    entries = json.loads(raw)
    total = sum(float(e.get("gpu_fraction", 0)) for e in entries)
    if total >= 1.0:
        raise SystemExit(f"gpu_fraction values add up to {total:.2f}; they must stay below 1.0")
    backends = []
    for i, entry in enumerate(entries):
        path = entry.get("path") or entry["name"]
        local = os.path.join(MODEL_DIR, path)
        if os.path.isdir(local):  # weights staged in S3 -> synced to /opt/ml/model/<path>
            path = local
        backends.append(
            Backend(
                name=entry["name"],
                path=path,
                port=FIRST_PORT + i,
                gpu_fraction=float(entry.get("gpu_fraction", round(0.9 / len(entries), 3))),
                args=[str(a) for a in entry.get("args", [])],
            )
        )
    return backends


BACKENDS = load_backends()
_client: httpx.AsyncClient | None = None


def command(b: Backend) -> list[str]:
    return [
        "vllm", "serve", b.path,
        "--served-model-name", b.name,
        "--host", "127.0.0.1", "--port", str(b.port),
        "--gpu-memory-utilization", str(b.gpu_fraction),
        *b.args,
    ]


async def wait_healthy(b: Backend) -> None:
    deadline = time.monotonic() + STARTUP_TIMEOUT
    async with httpx.AsyncClient(timeout=5) as client:
        while time.monotonic() < deadline:
            if b.process and b.process.returncode is not None:
                raise RuntimeError(f"{b.name} exited with code {b.process.returncode}; its error is in the lines above")
            try:
                if (await client.get(f"{b.url}/health")).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            await asyncio.sleep(3)
    raise RuntimeError(f"{b.name} was not healthy after {STARTUP_TIMEOUT}s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _client
    for b in BACKENDS:
        cmd = command(b)
        log.info("starting %s: %s", b.name, " ".join(cmd))
        # stdout/stderr are inherited, so vLLM's own errors reach CloudWatch.
        b.process = await asyncio.create_subprocess_exec(*cmd)
        await wait_healthy(b)
        log.info("%s ready on :%d", b.name, b.port)
    _client = httpx.AsyncClient(timeout=httpx.Timeout(600, connect=5))
    yield
    await _client.aclose()
    for b in BACKENDS:
        if b.process and b.process.returncode is None:
            b.process.terminate()


app = FastAPI(title="vLLM router", lifespan=lifespan, docs_url=None, redoc_url=None)


def backend_for(model: str | None) -> Backend:
    """Exact match on the served name. With one model, "model" is optional.
    No fuzzy matching: a typo must fail loudly, not hit the wrong model."""
    if not model and len(BACKENDS) == 1:
        return BACKENDS[0]
    for b in BACKENDS:
        if b.name == model:
            return b
    raise HTTPException(404, detail=f"Unknown model {model!r}. Served: {[b.name for b in BACKENDS]}")


async def healthy() -> bool:
    if _client is None:
        return False
    for b in BACKENDS:
        try:
            if (await _client.get(f"{b.url}/health", timeout=3)).status_code != 200:
                return False
        except httpx.HTTPError:
            return False
    return True


@app.get("/ping")
async def ping():
    if not await healthy():
        raise HTTPException(status_code=503, detail="models still loading")
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok" if await healthy() else "starting", "models": [b.name for b in BACKENDS]}


async def forward(body: dict):
    if _client is None:
        raise HTTPException(status_code=503, detail="not ready")
    backend = backend_for(body.get("model"))
    body = {**body, "model": backend.name}
    url = f"{backend.url}/v1/chat/completions"
    if body.get("stream"):
        request = _client.build_request("POST", url, json=body)
        upstream = await _client.send(request, stream=True)

        async def relay():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()

        return StreamingResponse(
            relay(), status_code=upstream.status_code, media_type=upstream.headers.get("content-type", "text/event-stream")
        )
    started = time.monotonic()
    upstream = await _client.post(url, json=body)
    log.info("completed model=%s status=%d ms=%d", backend.name, upstream.status_code, (time.monotonic() - started) * 1000)
    return Response(upstream.content, status_code=upstream.status_code, media_type="application/json")


@app.post("/invocations")
async def invocations(request: Request):
    return await forward(await request.json())


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    return await forward(await request.json())


@app.get("/v1/models")
async def models():
    return JSONResponse({"object": "list", "data": [{"id": b.name, "object": "model"} for b in BACKENDS]})
