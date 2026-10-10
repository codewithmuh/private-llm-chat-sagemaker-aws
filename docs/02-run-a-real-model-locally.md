# 2. Run a real model on your laptop

**Goal:** chat with a real open-source LLM running on your own machine. Free, private,
and a good way to learn what small models can and can't do before you rent a GPU.

`make up` already did this the first time you ran it: it asked which model to use,
downloaded it, and connected the app to it. This guide explains what happened, how to
switch models, and how to make answers faster.

The model runs in **Docker Model Runner** (part of Docker Desktop, on your GPU) or in
**[Ollama](https://ollama.com)** (in a container, on the CPU). Both expose an
**OpenAI-compatible API**, the same kind of API vLLM exposes on SageMaker. So for the
app it's just another `provider: "openai"` model with a different `base_url`.

## What `make up` does

`make up` runs [`scripts/up.sh`](../scripts/up.sh). The first time, it:

1. **Picks where the model runs** (`MODEL_ENGINE` in `.env`):
   - **Docker Model Runner** (`docker-model-runner`) when your computer has a GPU it can
     use (a Mac with Apple silicon, or an NVIDIA card). It is part of Docker Desktop but
     switched off by default, so the script asks first, then runs
     `docker desktop enable model-runner` for you. Several times faster.
   - **Ollama in Docker** (`ollama`) otherwise, or if you say no: works everywhere, on
     the CPU (`COMPOSE_PROFILES=ollama` in `.env`).
   - The **Ollama app** (`ollama-app`) if you happen to have it installed and running.
     Nothing in this repo installs it.
2. **Asks which model to use**, with a menu (below). The answer goes in `.env` as
   `LOCAL_MODEL`, so later runs don't ask again.
3. **Downloads the model** once, with a progress bar. With Ollama in Docker, its
   image (about 4 GB) is downloaded once too.
4. **Writes `config/models.local.json`**, the list of models the app offers, and points
   `LLM_MODELS_FILE` in `.env` at it.
5. **Starts the app**, then asks the model one question from inside the api container,
   to check that the app really gets an answer before telling you it's ready.

## The models in the menu

| # | Model | Docker Model Runner name | Ollama name | Download | Images | Good for |
|---|---|---|---|---|---|---|
| 1 | Qwen3-VL 4B | `ai/qwen3-vl:4B-UD-Q4_K_XL` | `qwen3-vl:4b-instruct` | 3.3 GB | ✅ | Chat, images and OCR. **Recommended on the CPU** |
| 2 | Gemma 3 4B | `ai/gemma3:4B-Q4_K_M` | `gemma3:4b` | 3.4 GB | ✅ | Chat and images, by Google |
| 3 | Qwen3 4B | `ai/qwen3:4b-instruct-2507` | `qwen3:4b-instruct-2507-q4_K_M` | 2.5 GB | | Text only, quick and capable |
| 4 | Llama 3.2 3B | `ai/llama3.2:3B-Q4_K_M` | `llama3.2:3b` | 2.0 GB | | Text only, the smallest and fastest |
| 5 | Qwen3 4B Thinking | `ai/qwen3:4b-thinking-2507` | `qwen3:4b` | 2.5 GB | | Reasons step by step first: slower, better at maths and logic. The app shows the reasoning in a collapsible block |
| 6 | Qwen3-VL 8B | `ai/qwen3-vl:8B` | `qwen3-vl:8b-instruct` | 6.2 GB | ✅ | Smarter, fewer mistakes. **Recommended on a GPU** when about 10 GB are free next to Docker (a 24 GB Mac, or Docker's memory lowered) |
| 7 | Any other model | [hub.docker.com/u/ai](https://hub.docker.com/u/ai) | [ollama.com/library](https://ollama.com/library) | | | You type its name |
| 8 | No AI: the mock model | | | none | | Testing the app itself: it answers by describing what the backend sent it |

The menu marks models that need more memory than you have: your computer's memory
with Docker Model Runner, Docker Desktop's limit (**Settings → Resources → Memory**)
with Ollama in Docker.

## Switch models: `make model`

To see the menu again, run:

```bash
make model
```

To skip the menu, name the model:

```bash
make model MODEL=ai/llama3.2:3B-Q4_K_M
```

(Either engine's name works; the script translates menu models.) `MODEL=mock`
switches to the fake model. Every model you downloaded from the menu
stays in the app's model picker; the one you chose last is the default.

## Make answers faster: Docker Model Runner

**Docker on a Mac has no access to the GPU**, so Ollama in a container runs the model
on the CPU: a few words per second, and a minute or more to read an image or a long
web page. **Docker Model Runner** solves this without installing anything new: it is
part of Docker Desktop, and runs the model as a normal program on your computer, next
to Docker, with the GPU (Metal on Apple silicon, CUDA on NVIDIA).

`make up` offers to turn it on when your computer can use it. To switch later:

```bash
make model
```

Answer **yes** when it asks about Docker Model Runner (or turn it on yourself in
Docker Desktop → **Settings → AI**). It downloads the model once more, into Model
Runner. On an Apple M1 Pro, Qwen3-VL 4B in Ollama on the CPU writes about 8 tokens a
second and needs about 90 seconds to read a receipt photo; on the GPU, a small vision
model read the same photo in 2 seconds.

### Memory: the model lives next to Docker

With Model Runner the model doesn't run inside Docker's virtual machine: it shares
your computer's memory with it. Docker Desktop keeps the memory it was given
(**Settings → Resources → Memory**, often half your RAM), so the menu only counts what
is left, and marks the models that don't fit. Pick one anyway and macOS swaps the model
to disk: it gets *slower* than the CPU (Qwen3-VL 8B on a 16 GB Mac with Docker at 8 GB:
about 5 tokens/s).

With Model Runner, the app's own containers need only 1–2 GB (a bit more while images
build). So to make room for a bigger model, lower Docker's memory to 4 GB, then run
`make model` again.

To go back to the CPU engine, turn Model Runner off in Docker Desktop and run
`make model`.

**Already have the Ollama app?** If it's running when you run `make model` (and
Model Runner is off), the script uses it: it also uses the GPU. Run `make down`
first, so the app's own Ollama container frees port 11434. On Linux, the Ollama
service only listens on `127.0.0.1`, which containers can't reach: run
`sudo systemctl edit ollama`, add `Environment="OLLAMA_HOST=0.0.0.0"` under
`[Service]`, then `sudo systemctl restart ollama`.

## Try it

- Ask a question, then a follow-up. The model sees the whole conversation every turn:
  that's how chat "memory" works.
- With **Qwen3-VL**, attach a photo of a receipt and ask for the total.
- Open the **OCR tool** and extract the text from a screenshot.
- Attach a PDF and ask for a summary. Small models get lost in long documents; notice
  where. Bigger models on SageMaker do much better.
- Try **Qwen3 4B Thinking** on a logic puzzle, and open its reasoning.

## How the app talks to Ollama

`config/models.local.json`, as `make up` writes it for Ollama in Docker:

```json
{
  "id": "qwen3-vl-4b-instruct",
  "name": "Qwen3-VL 4B",
  "provider": "openai",
  "base_url": "http://ollama:11434/v1",
  "model_id": "qwen3-vl:4b-instruct",
  "vision": true,
  "ocr": true,
  "context_window": 8192,
  "max_output_tokens": 2048,
  "temperature": 0.7,
  "params": {"top_p": 0.8, "top_k": 20, "presence_penalty": 1.5},
  "default": true
}
```

- `provider: "openai"`: the backend uses `apps/llm/providers/openai_compat.py`, which
  POSTs to `{base_url}/chat/completions` with `stream: true` and reads the answer as
  Server-Sent Events.
- `base_url`: where the model server is, seen from the api container.
  `http://model-runner.docker.internal/engines/v1` is Docker Model Runner (Docker
  Desktop gives containers that name), `http://ollama:11434/v1` the Ollama container,
  `http://host.docker.internal:11434/v1` the Ollama app on your computer.
- `model_id`: the name Ollama knows the model by.
- `vision: true`: images are sent to the model as pictures. Without it, the app OCRs
  images first and sends the text.
- `temperature`, `params`: the sampling settings the model's authors recommend, sent
  with every chat request. Small models need them: without `presence_penalty`,
  Qwen3-VL can go round in circles ("Wait, correction: ...").
- `context_window`: how much the model can read at once. The backend trims long
  conversations to fit (`apps/chat/prompting.py`). The script sets the engine to the
  same 8192 tokens (`docker model configure --context-size`, or
  `OLLAMA_CONTEXT_LENGTH` in `docker-compose.yml`); the Ollama app defaults to 4096.

`make up` rewrites this file every time. To add a model from another
OpenAI-compatible server, such as **LM Studio** (`http://host.docker.internal:1234/v1`),
**llama.cpp server**, a **vLLM** box of your own, or OpenAI itself
(`https://api.openai.com/v1` plus `api_key`), add it in `/admin/` → LLM models instead.

## Next

[3. Deploy a model to your own SageMaker GPU →](03-deploy-a-model-on-sagemaker.md)
