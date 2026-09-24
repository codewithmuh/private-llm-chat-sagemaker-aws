# Contributing

Thanks for helping! This project is meant to be **the place people learn to run
LLMs privately on AWS**, so contributions that make it clearer are as welcome as
new features: a better explanation, a model preset you tested, a fix for a
confusing error message.

## Ways to help

- **Try it and report what confused you.** If a doc step failed, that's a bug.
- **Add a model preset** you actually deployed (see below).
- **Improve the docs**: typos, missing steps, screenshots, translations.
- **Pick an issue** labelled `good first issue` or `help wanted`.
- **Build a feature** from the [roadmap](docs/roadmap.md). Open an issue first for
  anything big, so we can agree on the approach before you spend a weekend on it.

## Project map

```
backend/            Django + Django REST Framework API
  config/           settings (base / dev / production / test), urls
  apps/accounts/    users, email verification, password reset, Google, 2FA
  apps/llm/         model registry, providers (sagemaker, openai, mock), GPU controller
  apps/chat/        conversations, prompt building, SSE streaming, titles
  apps/files/       uploads, text extraction, OCR
  apps/common/      errors, CSRF-aware auth, email, health check, throttles
  tests/            pytest suite (no network, no AWS)
frontend/           Next.js (App Router, TypeScript) chat UI
ml/
  sagemaker/        deploy.py: deploy a model to SageMaker by hand (learning path)
  models/           catalog.json: tested model presets
  mock/             fake OpenAI-compatible + SageMaker-compatible model server
  vllm-router/      several models on one GPU (advanced)
infra/terraform/    the full AWS stack
scripts/            deploy, GPU start/stop, state bucket, weight staging
config/             model lists for local development
docs/               guides and reference
```

## Development setup

You need Docker, Python 3.12 and Node 22.

```bash
make up                 # everything in Docker: http://localhost:3000
```

or, to work on one side with hot reload:

```bash
make backend-dev        # Django on :8000 with SQLite + the in-process mock model
make frontend-dev       # Next.js on :3000, talking to :8000
```

Emails (verification codes, password resets) are printed in the backend's output with
`make backend-dev`, and appear in Mailpit (http://localhost:8025) with `make up`.

## Before you open a pull request

```bash
make lint               # ruff + eslint + tsc
make test               # pytest + frontend build
```

CI runs the same checks, plus `terraform validate` and Docker builds.

- **Backend**: `ruff format` style (`make fmt`), type hints on new functions, a test
  for every bug fix and every new endpoint. Tests never touch the network: fake the
  provider (see `tests/test_providers.py`) or AWS (see `tests/test_controller.py`).
- **Frontend**: TypeScript strict, no `any`. Keep components small. Plain CSS with
  the variables in `globals.css`.
- **Terraform**: `terraform fmt`, and explain *why* in comments. Many resources here
  exist because of a specific failure; write it down so nobody "simplifies" it away.
- **Docs**: if you change behaviour or add a setting, update `docs/` in the same PR.
  Every environment variable must be listed in `docs/configuration.md`.
- **No secrets**: no keys, tokens, AWS account ids or real personal data, ever, not
  even in tests.

## Common changes, step by step

### Add a model preset

1. Deploy it for real: `python ml/sagemaker/deploy.py deploy <your-preset>` after adding
   it to `ml/models/catalog.json`. Chat with it; try an image if it has vision.
2. Note the instance type that worked, `max_model_len`, and anything special (extra
   `SM_VLLM_*` flags, gated licence).
3. Add it to the table in `docs/models.md`. Mention the date and container version you
   tested with.

### Add a model provider (e.g. Amazon Bedrock)

1. Create `backend/apps/llm/providers/<name>.py` with a class implementing
   `stream(request) -> Iterator[str | Usage]` (see `base.py`). Raise `ProviderError`
   with a meaningful `code`.
2. Register it in `providers/__init__.py` and add the choice to `LLMModel.Provider`
   (plus a migration: `python manage.py makemigrations llm`).
3. Validate its config in `apps/llm/services.parse_models_config`.
4. Tests with a faked client, and a section in `docs/models.md`.

### Add an API endpoint

1. View + URL in the app it belongs to. Use `ApiError` for failures so the error
   shape stays consistent.
2. Document it in `docs/api.md` (request, response, errors).
3. Tests in `backend/tests/`.
4. Call it from `frontend/src/lib/api.ts` with a typed response.

## Commit messages

Short imperative subject, e.g. `Add Gemma 3 preset` or `fix(ocr): handle rotated
photos`. Explain the why in the body when it isn't obvious.

## Code of conduct

Be kind; this project exists for learners. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
