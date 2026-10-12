# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- ChatGPT-style web app (Next.js): streaming answers, conversation history, model
  picker, file and image attachments, OCR tool, dark mode.
- Accounts: email + password, email verification, password reset, Sign in with Google,
  two-factor authentication (authenticator app or email codes) with recovery codes.
- Django REST backend with pluggable model providers: SageMaker, any OpenAI-compatible
  server (vLLM, Ollama, LM Studio...), and a mock for development.
- GPU controller: SageMaker endpoints start on demand and are deleted when idle.
- `ml/sagemaker/deploy.py`: deploy a model preset to SageMaker with AWS's vLLM container.
- `ml/vllm-router`: several models on one GPU behind one endpoint (advanced).
- Terraform for the full stack on AWS (CloudFront, ALB, ECS Fargate, RDS, S3, SES,
  SageMaker).
- Docker Compose for local development, with Mailpit and an optional Ollama profile.
- `make up` runs a real open-source model locally: the first time it asks which model
  (Qwen3-VL, Gemma 3, Llama 3.2, Qwen3...), downloads it, writes
  `config/models.local.json`, and checks that the model answers. `make model` switches
  models. It runs them on the GPU with Docker Model Runner (part of Docker Desktop; it
  asks before turning it on), else in Ollama in Docker (CPU).
- Web search: a **Search** button in the chat. The api looks the question up with
  SearXNG (`search/`, self-hosted, no API key; a compose service locally and a sidecar
  container in the api task on AWS, `enable_web_search`), reads the top pages, and
  the model answers from them with numbered citations and a sources list.
- Models can carry their recommended sampling settings (`params` in `LLM_MODELS`,
  editable in the admin); `make up` sets them for every menu model. The system prompt
  names the model, and without web search it tells the model to answer questions
  about the present once, with the year of its knowledge, instead of arguing with
  itself.
- Voice input: a microphone button in the chat. The browser records and converts
  to 16 kHz WAV; Whisper (`speech/`, whisper.cpp built from source, works on ARM)
  transcribes it in a container next to the api, locally and on AWS
  (`enable_speech_to_text`), so voice never leaves your infrastructure. The api
  task's default memory is now 2 GiB (api + SearXNG + Whisper).
- `docs/concepts.md`: every concept behind the project in one page, from tokens,
  model sizes, GPU memory and quantization to RAG, tool calling, Whisper, SageMaker
  and the app's architecture, with a pitch, design trade-offs and common questions.
- `RUN_LOCALLY.md`: a step-by-step guide for beginners, from installing Docker to chatting.
- `make status`: the running containers, and the AI model by name, including one
  that Docker Model Runner runs outside the containers.

### Changed
- The `mock-llm` container (fake answers) starts only when you choose "No AI" (the
  `mock` compose profile) or use `make up-aws`. With a real model, `make up` no longer
  starts it, so `docker ps` doesn't suggest the app is using it.

### Removed
- `make ollama` and `config/models.ollama.json`: replaced by `make up` / `make model`.
