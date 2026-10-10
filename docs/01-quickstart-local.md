# 1. Run the app on your laptop (no GPU)

**Goal:** the whole application running locally with a **real open-source AI model**:
sign up, log in, chat, upload files, OCR. Everything runs on your computer, for free,
so you can learn how the app works before paying for a GPU.

**You need:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or
Docker Engine + Compose v2) and `git`. About 15 GB of free disk and 8 GB of memory.
The first start downloads about 7–10 GB (the app, Ollama and the model), so it takes
15–30 minutes; after that it starts in seconds.

## Start it

```bash
git clone https://github.com/codewithmuh/private-llm-chat-sagemaker-aws.git
cd private-llm-chat-sagemaker-aws
make up
```

The first time, `make up` asks which AI model to use:

```
Which AI model should the app use?
It runs on your computer, so your chats stay private. It downloads once.

  1) Qwen3-VL 4B         3.3 GB   chat, images and OCR (recommended)
  2) Gemma 3 4B          3.4 GB   chat and images, by Google
  3) Qwen3 4B            2.5 GB   text only, quick and capable
  ...
Your choice [1]:
```

Press **Enter** for the recommended one. `make up` downloads it, connects the app to
it, checks that it answers, and prints where to open the app:

| What | URL |
|---|---|
| **The chat app** | http://localhost:3000 |
| Emails the app sends (verification codes, password resets) | http://localhost:8025 |
| The API | http://localhost:8000/api/health/ |
| Django admin | http://localhost:8000/admin/ |

> Port already in use? Change `WEB_PORT`, `API_PORT`, `MAILPIT_PORT` or `OLLAMA_PORT`
> in `.env` and run `make up` again.

On a Mac with Apple silicon or a PC with an NVIDIA card, `make up` first offers to
turn on **Docker Model Runner** (part of Docker Desktop), which runs the model on the
GPU. Say yes: it is several times faster. More about the models, switching
(`make model`) and the engines: [guide 2](02-run-a-real-model-locally.md).

## Try it

1. **Sign up** at http://localhost:3000. The app emails you a 6-digit code: open
   **Mailpit** (http://localhost:8025), copy the code, paste it in.
2. **Chat.** Ask anything, then a follow-up. The answer streams in word by word.
   Without Model Runner the model runs on your CPU: expect a few words per second.
3. **Attach a file**: a PDF, a Word document, a text file or an image. Ask about it.
   Documents are pasted into the prompt as text; images go to the model as pictures.
4. **Search the web**: turn on **Search** next to the paperclip and ask something
   recent. The app looks it up with SearXNG (a search engine running in Docker, at
   http://localhost:8888), and the model answers from the pages with [1], [2]
   citations. How it works: [architecture](architecture.md#web-search-answers-newer-than-the-model).
5. **OCR**: open the OCR tool from the menu and drop in a screenshot or a photo of a
   page. The vision model reads the text.
6. **Turn on two-factor authentication** in Settings → Security, with an authenticator
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
                 │   ├──► mailpit (catches all email)
                 │   └──► searxng (:8888, the web search behind the "Search" button)
                 └──────► ollama (:11434, runs the model, speaks the OpenAI API like vLLM)
```

The browser talks to the API directly. The API sends chat requests to the model
server with the **same code** that talks to vLLM or SageMaker: only the address in
`config/models.local.json` changes. That's the point of this project: the app doesn't
care where the model runs.

## Useful commands

| Command | What it does |
|---|---|
| `make model` | Choose another AI model |
| `make logs` | Follow the api and web logs |
| `make down` | Stop (data and models are kept) |
| `make reset` | Stop and delete all local data, including downloaded models |
| `make superuser` | Create an admin account from the terminal |

## Without Docker

Only the backend, with SQLite and a mock model built into Django (it answers by
describing what the backend sent it). In one terminal:

```bash
make backend-dev
```

And in another (the UI on :3000):

```bash
make frontend-dev
```

## Next

[2. Run a real model on your laptop: switch models, make it faster →](02-run-a-real-model-locally.md)
