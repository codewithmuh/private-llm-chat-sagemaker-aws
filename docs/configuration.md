# Configuration reference

Everything is configured with environment variables, the same way locally
(`docker-compose.yml`, `.env`) and on AWS (ECS task definitions, written by
Terraform). This page lists every variable each container reads.

## Containers at a glance

| Container | Image built from | Port | Command | Health check |
|---|---|---|---|---|
| **api** | `backend/Dockerfile` (target `api`) | 8000 | gunicorn (default `CMD`) | `GET /api/health/` |
| **gpu-controller** | same image as api | — | `python manage.py gpu_controller` | — (a loop; restarts on exit) |
| **web** | `frontend/Dockerfile` | 3000 | `node server.js` (Next.js standalone) | `GET /healthz` |
| **mock-llm** (dev only) | `ml/mock/Dockerfile` | 8080 | uvicorn | `GET /health` |

In production, one domain serves everything (CloudFront → ALB):

| Path | Goes to |
|---|---|
| `/api/*`, `/admin/*`, `/django-static/*` | api |
| everything else | web |

Because the browser sees a single origin, cookies and CSRF need no cross-origin setup.

---

## api / gpu-controller (Django)

### Core

| Variable | Default | Notes |
|---|---|---|
| `DJANGO_SETTINGS_MODULE` | `config.settings.dev` | `config.settings.production` on AWS |
| `DJANGO_SECRET_KEY` | dev-only value | **Required** in production. Long random string |
| `DATABASE_URL` | — | `postgres://user:pass@host:5432/db`. Takes precedence over `DB_*` |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | `localhost` `5432` `llmchat` `llmchat` `""` | Used when `DATABASE_URL` is unset. On AWS, `DB_PASSWORD` comes from Secrets Manager |
| `DB_SSLMODE` | `prefer` | `require` on RDS |
| `PUBLIC_URL` | `http://localhost:3000` | Where users open the app. Used in email links, and as the default for `CSRF_TRUSTED_ORIGINS` |
| `ALLOWED_HOSTS` | `*` in dev | Comma-separated host names (production: your CloudFront/custom domain) |
| `CSRF_TRUSTED_ORIGINS` | `PUBLIC_URL` | Comma-separated full origins |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` in dev | Only needed when web and api are on different origins (local dev) |
| `PROXY_SSL_HEADER` | `HTTP_X_FORWARDED_PROTO` | Header that tells Django the original request was HTTPS. Behind CloudFront → ALB (HTTP), use `HTTP_CLOUDFRONT_FORWARDED_PROTO` |
| `RUN_BOOTSTRAP` | `false` | `true` → on container start, run migrations (under a Postgres advisory lock) and sync `LLM_MODELS` into the database |
| `ENABLE_ADMIN` | `true` | Django admin at `/admin/` (staff users only) |
| `ADMIN_EMAILS` | `""` | Comma-separated. A user with a **verified** email in this list becomes staff + superuser at login. Simplest way to get into `/admin/` |
| `LOG_LEVEL` | `INFO` | |

### Accounts & email

| Variable | Default | Notes |
|---|---|---|
| `APP_NAME` | `Private LLM Chat` | Shown in emails, TOTP apps, and the UI |
| `SIGNUP_ENABLED` | `true` | `false` = invite-only (create users in `/admin/`) |
| `EMAIL_VERIFICATION` | `mandatory` | `mandatory`, `optional` or `none` |
| `GOOGLE_CLIENT_ID` | `""` | OAuth **Web** client id. Empty hides "Sign in with Google" |
| `EMAIL_PROVIDER` | `console` | `console` (print to logs), `smtp`, or `ses` |
| `DEFAULT_FROM_EMAIL` | `Private LLM Chat <no-reply@localhost>` | Must be a verified SES identity when `EMAIL_PROVIDER=ses` |
| `EMAIL_HOST` `EMAIL_PORT` `EMAIL_HOST_USER` `EMAIL_HOST_PASSWORD` `EMAIL_USE_TLS` | — | For `smtp`. Local dev uses Mailpit (`mailpit:1025`, no TLS) |

### File storage

| Variable | Default | Notes |
|---|---|---|
| `STORAGE_BACKEND` | `local` | `local` (a folder) or `s3` |
| `MEDIA_ROOT` | `backend/media` | For `local` |
| `S3_BUCKET` | — | For `s3` |
| `S3_PREFIX` | `uploads/` | Key prefix inside the bucket |
| `AWS_REGION` | `us-east-1` | Region for S3, SES and SageMaker |
| `MAX_UPLOAD_MB` | `20` | |

### Models

| Variable | Default | Notes |
|---|---|---|
| `LLM_MODELS` | `[]` | JSON list of models, see below. Synced into the database by `python manage.py sync_models` (run by `RUN_BOOTSTRAP`). Models added in `/admin/` are left alone |
| `LLM_TIMEOUT_SECONDS` | `300` | Upper bound for one answer |
| `OCR_ENGINE` | `auto` | `auto` (the OCR/vision model if one is ready, else Tesseract), `llm`, `tesseract`, `none` |
| `TITLE_GENERATION` | `true` | Ask the model for a short title after the first answer |
| `GPU_CONTROLLER_INTERVAL` | `30` | Seconds between controller ticks |

#### `LLM_MODELS` entries

```jsonc
[
  {
    "id": "qwen3-vl-8b",                    // slug used by the API and UI (required)
    "name": "Qwen3-VL 8B",                   // display name
    "description": "Chat, vision and OCR",
    "provider": "sagemaker",                 // "sagemaker" | "openai" | "mock"
    "model_id": "Qwen/Qwen3-VL-8B-Instruct-FP8", // sent as "model" in the request

    // provider = "openai" (vLLM, Ollama, LM Studio, OpenAI itself, ...)
    "base_url": "http://ollama:11434/v1",
    "api_key": "",

    // provider = "sagemaker"
    "endpoint_name": "llmchat-dev-qwen3-vl-8b",
    "endpoint_config_name": "llmchat-dev-qwen3-vl-8b-1a2b3c4d", // lets the controller create the endpoint
    "region": "us-east-1",                   // optional, defaults to AWS_REGION
    "scaling": "on_demand",                  // "on_demand" | "always_on" | "off" | "manual"
    "idle_minutes": 30,                      // on_demand: delete after this long unused
    "hourly_cost_usd": 1.86,                 // shown in the admin

    // capabilities & limits
    "vision": true,
    "ocr": true,
    "context_window": 32768,
    "max_output_tokens": 4096,
    "temperature": 0.7,
    "default": true,
    "sort": 10,
    "enabled": true
  }
]
```

`scaling` (SageMaker only):

| Value | The GPU controller… |
|---|---|
| `on_demand` | creates the endpoint when someone chats with the model, and deletes it after `idle_minutes` without use. Cheapest; the first message after a quiet period waits for a cold start (≈ 5–15 min) |
| `always_on` | keeps the endpoint running |
| `off` | deletes it and keeps it deleted |
| `manual` | never touches it. You created the endpoint yourself (e.g. with `ml/sagemaker/deploy.py`) |

---

## web (Next.js)

| Variable | When | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **build** time | `""` | Empty = same origin (production). `http://localhost:8000` for local dev |
| `PORT` | runtime | `3000` | |
| `HOSTNAME` | runtime | `0.0.0.0` | |

Everything else the UI needs (Google client id, upload limits, app name) is
fetched at runtime from `GET /api/config/`, so one web image works in every
environment.

---

## mock-llm (local development only)

| Variable | Default | Notes |
|---|---|---|
| `MOCK_TOKENS_PER_SECOND` | `40` | Streaming speed of the fake answers |
| `MOCK_MODEL_NAMES` | `mock-chat,mock-vision` | Model ids it answers to |
