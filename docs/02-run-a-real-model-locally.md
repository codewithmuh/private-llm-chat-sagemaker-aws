# 2. Run a real model on your laptop (Ollama)

**Goal:** chat with a real open-source LLM, running on your own machine, through the
same app. Free, private, and a good way to learn what small models can and can't do
before you rent a GPU.

[Ollama](https://ollama.com) runs models locally and exposes an **OpenAI-compatible
API**, the same kind of API vLLM exposes on SageMaker. So for the app it's just another
`provider: "openai"` model with a different `base_url`.

## Option A: Ollama inside Docker (any OS)

```bash
# 1. Tell the app to use the Ollama model list
sed -i.bak 's/^LLM_MODELS_FILE=.*/LLM_MODELS_FILE=models.ollama.json/' .env

# 2. Start Ollama too, and download two small models (~5 GB)
make ollama
docker compose logs -f ollama-pull      # wait for "success" twice
```

Refresh the app: the model picker now shows **Qwen2.5-VL 3B** (vision: it can read
images and do OCR) and **Llama 3.2 3B**.

> **On a Mac, this is slow.** Docker on macOS has no access to the Apple GPU, so the
> model runs on the CPU. Use option B instead.

## Option B: native Ollama (Mac with Apple Silicon, or any machine with a GPU)

1. Install Ollama from https://ollama.com/download and pull the models:

   ```bash
   ollama pull qwen2.5vl:3b
   ollama pull llama3.2:3b
   ```

2. Let the app's container reach it. In `config/models.ollama.json`, replace
   `http://ollama:11434/v1` with `http://host.docker.internal:11434/v1` (both entries),
   and set `LLM_MODELS_FILE=models.ollama.json` in `.env`.

3. Restart the api: `docker compose restart api`.

## Try it

- Ask a question, then a follow-up. The model sees the whole conversation every turn:
  that's how chat "memory" works.
- Attach a photo of a receipt to **Qwen2.5-VL** and ask for the total.
- Open the OCR tool and extract the text from a screenshot.
- Attach a PDF and ask for a summary. Small models get lost in long documents; notice
  where. Bigger models on SageMaker do much better.

## How the app talks to Ollama

`config/models.ollama.json`:

```json
{
  "id": "qwen2.5-vl-3b",
  "provider": "openai",
  "base_url": "http://ollama:11434/v1",
  "model_id": "qwen2.5vl:3b",
  "vision": true,
  "ocr": true,
  "context_window": 8192
}
```

- `provider: "openai"`: the backend uses `apps/llm/providers/openai_compat.py`, which
  POSTs to `{base_url}/chat/completions` with `stream: true` and reads the answer as
  Server-Sent Events.
- `model_id`: the name Ollama knows the model by.
- `vision: true`: images are sent to the model as pictures. Without it, the app OCRs
  images first and sends the text.
- `context_window`: how much the model can read at once. The backend trims long
  conversations to fit (`apps/chat/prompting.py`).

Any other OpenAI-compatible server works the same way: **LM Studio**
(`http://host.docker.internal:1234/v1`), **llama.cpp server**, a **vLLM** box of your own,
or OpenAI itself (`https://api.openai.com/v1` plus `api_key`).

## Next

[3. Deploy a model to your own SageMaker GPU →](03-deploy-a-model-on-sagemaker.md)
