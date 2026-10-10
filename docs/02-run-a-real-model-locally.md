# 2. Run a real model on your laptop (Ollama)

**Goal:** chat with a real open-source LLM running on your own machine. Free, private,
and a good way to learn what small models can and can't do before you rent a GPU.

`make up` already did this the first time you ran it: it asked which model to use,
downloaded it, and connected the app to it. This guide explains what happened, how to
switch models, and how to make answers faster.

[Ollama](https://ollama.com) runs models locally and exposes an **OpenAI-compatible
API**, the same kind of API vLLM exposes on SageMaker. So for the app it's just another
`provider: "openai"` model with a different `base_url`.

## What `make up` does

`make up` runs [`scripts/up.sh`](../scripts/up.sh). The first time, it:

1. **Asks which model to use**, with a menu (below). The answer goes in `.env` as
   `LOCAL_MODEL`, so later runs don't ask again.
2. **Starts Ollama.** If the [Ollama app](https://ollama.com/download) is running on your
   computer, it uses that. Otherwise it starts Ollama in a Docker container
   (`COMPOSE_PROFILES=ollama` in `.env`).
3. **Downloads the model** once, with a progress bar. The Ollama Docker image (about
   4 GB) is downloaded once too.
4. **Writes `config/models.local.json`**, the list of models the app offers, and points
   `LLM_MODELS_FILE` in `.env` at it.
5. **Starts the app**, then asks the model one question from inside the api container,
   to check that the app really gets an answer before telling you it's ready.

## The models in the menu

| # | Model | Download | Understands images | Good for |
|---|---|---|---|---|
| 1 | Qwen3-VL 4B (`qwen3-vl:4b-instruct`) | 3.3 GB | ✅ | Chat, images and OCR. **Recommended** |
| 2 | Gemma 3 4B (`gemma3:4b`) | 3.4 GB | ✅ | Chat and images, by Google |
| 3 | Qwen3 4B (`qwen3:4b-instruct-2507-q4_K_M`) | 2.5 GB | | Text only, quick and capable |
| 4 | Llama 3.2 3B (`llama3.2:3b`) | 2.0 GB | | Text only, the smallest and fastest |
| 5 | Qwen3 4B Thinking (`qwen3:4b`) | 2.5 GB | | Reasons step by step first: slower, better at maths and logic. The app shows the reasoning in a collapsible block |
| 6 | Qwen3-VL 8B (`qwen3-vl:8b-instruct`) | 6.1 GB | ✅ | Smarter, but needs more memory than Docker Desktop gives by default |
| 7 | Any model from [ollama.com/library](https://ollama.com/library) | | | You type its name, e.g. `mistral:7b` |
| 8 | No AI: the mock model | none | | Testing the app itself: it answers by describing what the backend sent it |

The menu marks models that need more memory than you have. Docker Desktop's limit is
in **Settings → Resources → Memory**.

## Switch models: `make model`

To see the menu again, run:

```bash
make model
```

To skip the menu, name the model:

```bash
make model MODEL=llama3.2:3b
```

`MODEL=mock` switches to the fake model. Every model you downloaded from the menu
stays in the app's model picker; the one you chose last is the default.

## Make answers faster: the Ollama app

**Docker on a Mac has no access to the GPU**, so in Docker the model runs on the CPU.
That works, but the Ollama app uses your Mac's GPU (or an NVIDIA GPU on a PC) and
answers several times faster.

1. Install Ollama from https://ollama.com/download and open it.
2. Stop the app's own Ollama container, which uses the same port:

   ```bash
   make down
   ```

3. Choose the model again. `make model` sees the Ollama app and uses it, downloading
   the model once more, into the app:

   ```bash
   make model
   ```

From then on, open the Ollama app before `make up`. To go back to Docker, quit the
Ollama app and run `make model`.

> **Linux:** the Ollama service only listens on `127.0.0.1` by default, which Docker
> containers can't reach. Run `sudo systemctl edit ollama`, add
> `Environment="OLLAMA_HOST=0.0.0.0"` under `[Service]`, then
> `sudo systemctl restart ollama`.

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
  "default": true
}
```

- `provider: "openai"`: the backend uses `apps/llm/providers/openai_compat.py`, which
  POSTs to `{base_url}/chat/completions` with `stream: true` and reads the answer as
  Server-Sent Events.
- `base_url`: `http://ollama:11434/v1` is the Ollama container. With the Ollama app it
  is `http://host.docker.internal:11434/v1`: your computer, seen from a container.
- `model_id`: the name Ollama knows the model by.
- `vision: true`: images are sent to the model as pictures. Without it, the app OCRs
  images first and sends the text.
- `context_window`: how much the model can read at once. The backend trims long
  conversations to fit (`apps/chat/prompting.py`). It matches `OLLAMA_CONTEXT_LENGTH`
  in `docker-compose.yml` (8192); the Ollama app defaults to 4096.

`make up` rewrites this file every time. To add a model from another
OpenAI-compatible server, such as **LM Studio** (`http://host.docker.internal:1234/v1`),
**llama.cpp server**, a **vLLM** box of your own, or OpenAI itself
(`https://api.openai.com/v1` plus `api_key`), add it in `/admin/` → LLM models instead.

## Next

[3. Deploy a model to your own SageMaker GPU →](03-deploy-a-model-on-sagemaker.md)
