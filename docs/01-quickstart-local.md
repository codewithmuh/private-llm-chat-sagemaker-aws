# 1. Run the app on your laptop (5 minutes, no GPU)

**Goal:** the whole application running locally: sign up, log in, chat, upload
files, OCR. The "model" is a fake one that streams canned answers, so you can learn
how the app works before paying for a GPU.

**You need:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or
Docker Engine + Compose v2) and `git`. About 3 GB of disk.

## Start it

```bash
git clone https://github.com/codewithmuh/private-llm-chat-sagemaker-aws.git
cd private-llm-chat-sagemaker-aws
make up            # or: cp .env.example .env && docker compose up -d --build
```

The first build takes a few minutes. Then open:

| What | URL |
|---|---|
| **The chat app** | http://localhost:3000 |
| Emails the app sends (verification codes, password resets) | http://localhost:8025 |
| The API | http://localhost:8000/api/health/ |
| Django admin | http://localhost:8000/admin/ |

> Port already in use? Change `WEB_PORT`, `API_PORT` or `MAILPIT_PORT` in `.env` and
> run `make up` again.

## Try it

1. **Sign up** at http://localhost:3000. The app emails you a 6-digit code: open
   **Mailpit** (http://localhost:8025), copy the code, paste it in.
2. **Chat.** Ask anything. The mock model answers by describing what the backend sent
   it: the system prompt, the number of messages, the files. That's the real request a
   real model would get.
3. **Attach a file**: a PDF, a Word document, a text file or an image. Ask about it,
   and the mock tells you the file was pasted into the prompt.
4. **OCR**: open the OCR tool from the menu, drop in an image. (With the mock you get
   sample text; with a real vision model, the real text.)
5. **Turn on two-factor authentication** in Settings → Security, with an authenticator
   app (Google Authenticator, 1Password, Authy...) or email codes. Log out and back in.

## Become an admin

Put your email in `.env` and restart:

```bash
echo "ADMIN_EMAILS=you@example.com" >> .env
make up
```

Log in again: your account is now staff, and the user menu shows **Admin**. The
admin lists users, models (you can add models there too) and conversation metadata.

## What is running?

```
browser ──► web (Next.js :3000)
   │
   └──────► api (Django :8000) ──► postgres
                 │   │
                 │   └──► mailpit (catches all email)
                 └──────► mock-llm (:8080, speaks the OpenAI API, like vLLM does)
```

The browser talks to the API directly. The API sends chat requests to the model
server with the **same code** that talks to vLLM, Ollama or SageMaker: only the address
in `config/models.mock.json` changes. That's the point of this project: the app doesn't
care where the model runs.

## Useful commands

```bash
make logs          # follow api + web logs
make down          # stop (data is kept)
make reset         # stop and delete all local data
make superuser     # create an admin account from the terminal
```

## Without Docker

Only the backend, with SQLite and a mock model built into Django:

```bash
make backend-dev   # API on :8000, emails printed in the terminal
make frontend-dev  # in another terminal: UI on :3000
```

## Next

[2. Run a real model on your laptop with Ollama →](02-run-a-real-model-locally.md)
