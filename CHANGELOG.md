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
  (Qwen3-VL, Gemma 3, Llama 3.2, Qwen3...), downloads it with Ollama, writes
  `config/models.local.json`, and checks that the model answers. `make model` switches
  models. It uses the Ollama app when it's running (GPU), else Ollama in Docker.
- `RUN_LOCALLY.md`: a step-by-step guide for beginners, from installing Docker to chatting.

### Removed
- `make ollama` and `config/models.ollama.json`: replaced by `make up` / `make model`.
