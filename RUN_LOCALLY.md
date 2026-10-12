# Run Private LLM Chat on your computer

This guide takes you from a computer with nothing installed to chatting with a real
AI model in the app. You don't need a GPU, an AWS account, or any programming
experience. Plan for 30–45 minutes, most of it waiting for downloads.

> **What you'll have at the end:** the whole app running on your own computer, with
> sign-up, login, chat, file uploads and OCR, answered by a **real open-source AI
> model** (such as Qwen or Llama) that also runs on your computer. Nothing you type
> leaves your machine, and it's free.

## What you need

| | |
|---|---|
| A computer | Mac, Windows 10/11, or Linux. **16 GB of memory** is comfortable; with 8 GB, pick the smallest model and give Docker 6 GB (Docker Desktop → Settings → Resources → Memory) |
| Free disk space | About **15 GB** |
| Internet | For the first setup only. It downloads 7–10 GB: the app, plus the AI model |
| Docker Desktop | Runs the app and the model. Free for personal use. You install it in step 1 |
| Git | Downloads the code. You install it in step 1 |

You do **not** need to install Python, Node.js, a database or the AI model yourself.
Docker and the start command take care of all of it.

### How to use the terminal

Every step below types commands into a **terminal**, a window where you type
instructions instead of clicking.

- **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
- **Windows:** use **Git Bash**, which you install with Git in step 1. Click Start,
  type `Git Bash`, and open it. (Not PowerShell: the start command needs Git Bash.)
- **Linux:** press `Ctrl + Alt + T` on most systems.

To run a command, copy it from this page, paste it into the terminal and press
**Enter**. (In Git Bash, paste with `Shift + Insert` or a right-click.) Wait until it
finishes (you get a fresh line where you can type again) before running the next one.
When a box shows several lines, run them one at a time, top to bottom.

---

## Step 1: Install Docker Desktop and Git

### Docker Desktop

1. Download it from https://www.docker.com/products/docker-desktop/
   - **Mac:** choose **Apple Silicon** or **Intel**. Not sure which? Click the Apple
     menu → **About This Mac**. If it says "Chip: Apple M1/M2/M3/M4…", choose Apple Silicon.
   - **Windows:** if the installer asks about **WSL 2**, keep it ticked. Docker needs
     it on Windows. Restart your computer if asked.
   - **Linux:** follow https://docs.docker.com/desktop/setup/install/linux/ (or
     install Docker Engine with the Compose plugin).
2. Open Docker Desktop, accept the terms, and wait until it shows **Engine running**
   (bottom-left of its window). You can skip signing in.

> Docker Desktop must be **open** every time you use the app. If it's closed, nothing
> below will work.

### Git

- **Mac:** open Terminal and run `git --version`. If a window asks you to install the
  **command line developer tools**, click **Install** and wait. This also installs
  `make`, which you'll use in step 3.
- **Windows:** download Git from https://git-scm.com/download/win and install it,
  clicking **Next** to accept the defaults. This also installs **Git Bash**: open it
  now (Start → type `Git Bash`), and use it for the rest of this guide.
- **Linux (Ubuntu/Debian):** run `sudo apt install git make curl`

### Check that it worked

Run each of these:

```bash
docker --version
```

```bash
docker compose version
```

```bash
git --version
```

Each one should print a version number, such as `Docker version 29.0.0`,
`Docker Compose version v2.40.0` and `git version 2.50.0`. If you see "command not
found", see [Something went wrong?](#something-went-wrong).

---

## Step 2: Download the code

These commands put the project in your home folder.

**Mac or Linux:**

```bash
cd ~
git clone https://github.com/codewithmuh/private-llm-chat-sagemaker-aws.git
cd private-llm-chat-sagemaker-aws
```

**Windows (Git Bash):**

```bash
cd ~
git clone --config core.autocrlf=false https://github.com/codewithmuh/private-llm-chat-sagemaker-aws.git
cd private-llm-chat-sagemaker-aws
```

> **Windows users: keep `--config core.autocrlf=false`.** By default, Git on Windows
> changes the line endings of text files, which breaks the app's scripts. This option
> keeps the files exactly as they are.

`cd` means "change directory": it moves the terminal into a folder. **Run every
command from here on inside the project folder.** If you open a new terminal later,
run this first:

```bash
cd ~/private-llm-chat-sagemaker-aws
```

---

## Step 3: Start the app and choose your AI model

Check that Docker Desktop is running, then:

**Mac or Linux:**

```bash
make up
```

**Windows (Git Bash):** Windows doesn't come with `make`, so run the script it runs:

```bash
./scripts/up.sh
```

The first time, it asks you two things.

**1. On a Mac with an M1/M2/M3/M4 chip, or a PC with an NVIDIA graphics card**, it
first asks:

```
Docker Model Runner (part of Docker Desktop) runs AI models on your GPU:
answers come several times faster than from a container. It is switched off.
Turn it on? This runs: docker desktop enable model-runner  [Y/n]
```

**Press Enter (yes).** It switches on a feature of Docker Desktop that you already
have; nothing new is installed. The AI then uses your computer's graphics chip
instead of only its processor. (Say no, or on other computers, and the AI runs in a
normal Docker container: it works, just slower.)

**2. Which AI model to use:**

```
Which AI model should the app use?
It runs on your computer, so your chats stay private. It downloads once.

  1) Qwen3-VL 4B         3.3 GB   chat, images and OCR (recommended)
  2) Gemma 3 4B          3.4 GB   chat and images, by Google
  3) Qwen3 4B            2.5 GB   text only, quick and capable
  4) Llama 3.2 3B        2.0 GB   text only, the smallest and fastest
  5) Qwen3 4B Thinking   2.5 GB   text only, reasons step by step first (slower)
  6) Qwen3-VL 8B         6.2 GB   chat, images and OCR, smarter
  7) Another model from https://hub.docker.com/u/ai (or hf.co/...) (you type its name)
  8) No AI: the mock model, for testing the app (no download)

Your choice [1]:
```

**Not sure? Just press Enter** to get the model marked "(recommended)": the best one
your computer can run well (the bigger 8B needs about 10 GB of free memory). It can chat, read pictures and pull text out of images.
If a line says "needs more memory", pick a smaller model. You can change your mind
later (see [Change the AI model](#change-the-ai-model)).

What happens next:

- It downloads **the model** with a progress bar (and, without Model Runner,
  **Ollama**, the program that runs it), then builds the app. **The first time takes
  15–45 minutes**, depending on your internet and computer. Lots of text scrolls by.
  That's normal.
- Then it asks the model a test question, to be sure everything is connected.
- It's done when you see **Ready!**, with the address to open:

  ```
    Ready! Open http://localhost:3000 and sign up.
    Emails (your sign-up code):  http://localhost:8025
    AI model:  Qwen3-VL 4B (ai/qwen3-vl:4B-UD-Q4_K_XL), in Docker Model Runner (GPU).
  ```

- Starting the app again later takes seconds, and doesn't ask again: everything is
  already downloaded.

This step also created a file called `.env`, which holds the app's settings, including
the model you chose. You don't need to change it now.

---

## Step 4: Check that it's running

```bash
docker compose ps
```

You should see `api`, `mailpit`, `postgres`, `searxng`, `web` and `whisper`, all with a
STATUS starting with `Up`, plus `ollama` if the AI runs in a container, or `mock-llm` (the
fake model) if you chose "No AI". (With Docker Model Runner the AI isn't in this list:
Docker Desktop runs it. `make status` shows it by name, or check it with `docker model ps`.)

Then open this address in your web browser:

**http://localhost:8000/api/health/**

If the page shows `{"status": "ok"}`, the app's server is ready.

---

## Step 5: Create your account

1. Open **http://localhost:3000** in your browser and click **Get started**.

   > Type `localhost` exactly. `127.0.0.1` looks like the same thing, but logging in
   > won't work there.

2. Enter an email and a password. The name is optional.
   - **Any email works, even a made-up one like `me@example.com`.** No email ever
     leaves your computer: the app delivers them to a test inbox called **Mailpit**.
   - The password needs at least 8 characters, can't be only numbers, and can't be a
     common one like `password123`.
3. The app asks for a **6-digit code**. Open **http://localhost:8025** in a new tab
   (that's Mailpit), open the newest email, and copy the code into the app.

You're in.

---

## Step 6: Try it

- **Chat:** type a message and press Enter. The answer appears word by word, like
  ChatGPT. With Docker Model Runner (your graphics chip) it writes quickly; in a
  container (processor only) expect a few words per second. See
  [guide 2](docs/02-run-a-real-model-locally.md#make-answers-faster-docker-model-runner).
- **Ask a follow-up.** The model remembers the conversation.
- **Attach a file:** click the paperclip next to the message box and pick a PDF, Word
  document, text file or image. Then ask about it, for example "Summarize this".
- **Talk instead of typing:** click the **microphone** next to the send button and
  allow the microphone when your browser asks (only the first time). Speak, then
  click the red button: your words appear in the message box, ready to edit and
  send. Whisper turns them into text right here on your computer, in any language.
- **Search the web:** click **Search** next to the paperclip (it turns green), then ask
  something recent, like "Who is the prime minister of Pakistan?". The app looks it
  up first, the model answers from the pages it found, and the sources are listed
  under the answer as [1], [2]... Without Search, the model only knows what it learned
  during training, which can be out of date. The search engine is
  [SearXNG](https://docs.searxng.org), running on your computer as part of the app:
  open http://localhost:8888 to try it yourself.
- **OCR (read text from a picture):** open **OCR tool** in the sidebar and drop in a
  screenshot or a photo of a page.
- **Settings:** open your user menu (bottom-left) for **Settings** and the light/dark
  theme. Under **Settings → Security** you can turn on two-factor authentication.

---

## Change the AI model

Run this, and pick another model from the same menu:

| Mac / Linux | Windows (Git Bash) |
|---|---|
| `make model` | `./scripts/up.sh --choose` |

It downloads the new model and makes it the default. Models you downloaded before stay
in the app's model picker (the name at the top of the chat).

---

## Stop, restart, start over

| What you want | Mac / Linux | Windows (Git Bash) |
|---|---|---|
| Stop the app (accounts, chats and models are kept) | `make down` | `docker compose --profile ollama down` |
| Start it again | `make up` | `./scripts/up.sh` |
| Watch what the app is doing (press `Ctrl + C` to stop watching) | `make logs` | `docker compose logs -f api web` |
| **Delete everything** and start fresh (erases all accounts, chats, files and downloaded models) | `make reset` | `docker compose --profile ollama down -v` |

Good to know:

- Closing the terminal does **not** stop the app. It keeps running in Docker until you
  stop it or quit Docker Desktop.
- After you restart your computer, open Docker Desktop, then run the "Start it again"
  command.

---

## Optional: make yourself an admin

The admin panel lists users and conversations, and lets you add AI models.

1. Open the `.env` file in a text editor. From the project folder, run:
   - Mac: `open -e .env`
   - Windows: `notepad .env`
   - Linux: `nano .env` (save with `Ctrl + O`, Enter, then exit with `Ctrl + X`)
2. Find the line `ADMIN_EMAILS=` and add the email you signed up with, like this:
   `ADMIN_EMAILS=me@example.com`. Save the file.
3. Run the "Start it again" command from the table above, so the app reads the change.
4. In the app, log out and log back in. Your user menu now has **Admin**. You can also
   go straight to http://localhost:8000/admin/

---

## Something went wrong?

| What you see | What to do |
|---|---|
| `Docker is not running`, `Cannot connect to the Docker daemon` or `failed to connect to the docker API` | Open Docker Desktop, wait for **Engine running**, and try again |
| `docker: command not found` | Docker Desktop isn't installed, or the terminal was opened before you installed it. Close the terminal and open a new one |
| `make: command not found` (Mac or Linux) | Mac: run `xcode-select --install`. Linux: run `sudo apt install make`. Or run `./scripts/up.sh` instead of `make up` |
| `'make' is not recognized` or `./scripts/up.sh` not found (Windows) | You're in PowerShell. Open **Git Bash** instead, go to the project folder (`cd ~/private-llm-chat-sagemaker-aws`), and run `./scripts/up.sh` |
| `port is already allocated` or `address already in use` | Another program is using port 3000, 8000, 8025, 8888 or 11434. Open `.env`, change for example `WEB_PORT=3000` to `WEB_PORT=3001`, start again, and use http://localhost:3001 |
| The download stops with an error | Check your internet connection and run the start command again: the download continues where it stopped. If you typed a model name yourself, check it on https://ollama.com/library |
| `the app cannot get an answer from the model`, or the chat shows an error about memory | The model is too big for the memory Docker has. Choose a smaller one ([Change the AI model](#change-the-ai-model)), or give Docker more memory: Docker Desktop → Settings → Resources → Memory |
| "Web search failed" under an answer | The search engines refused for a moment (they limit automated searches). Try again in a minute; `docker compose logs searxng` shows which engines answered |
| Answers are very slow | The model runs on your processor (`AI model: ... CPU only` when it starts). On a Mac with an M chip or a PC with an NVIDIA card, run the "Change the AI model" command and answer yes to Docker Model Runner. Otherwise, choose a smaller model |
| Slow even with Docker Model Runner, and the whole computer feels sluggish | The model is too big for the memory left next to Docker. Run the "Change the AI model" command and pick the "(recommended)" one, or see [guide 2](docs/02-run-a-real-model-locally.md#memory-the-model-lives-next-to-docker) |
| `Docker Model Runner is switched off` | It was turned off in Docker Desktop. Turn it back on in Docker Desktop → Settings → AI, or run the "Change the AI model" command to choose again |
| Windows: the `api` keeps restarting, and `docker compose logs api` shows `exec /app/docker-entrypoint.sh: no such file or directory` | Git changed the line endings. Delete the project folder, clone it again with `--config core.autocrlf=false` ([step 2](#step-2-download-the-code)), then do step 3 again |
| The page says **"Not found. Try again"** or **"Can't reach the server"** | The app isn't running, or is still starting. Run the start command, wait for **Ready!**, then refresh |
| "Your session expired. Refresh the page" on every click | You opened `127.0.0.1`. Use http://localhost:3000 instead |
| The microphone button does nothing, or says the browser blocked it | Allow the microphone for the site: click the icon at the left of the address bar. It only works on `http://localhost`, not on `127.0.0.1` or another address |
| The verification email never arrives | It never goes to your real inbox. Open Mailpit: http://localhost:8025 |
| The password is rejected | Use at least 8 characters, not only numbers, not a common password, and not too close to your email |
| `no space left on device` | Free some disk space. `docker system prune` deletes old Docker downloads you no longer use |
| Odd errors like `read-only file system` or `input/output error` | Restart Docker Desktop (whale icon → **Restart**) |

To see what the server is doing at any time, run `docker compose logs api`. For the
model, run `docker compose logs ollama`.

More fixes are in [docs/troubleshooting.md](docs/troubleshooting.md). Still stuck?
[Open an issue](https://github.com/codewithmuh/private-llm-chat-sagemaker-aws/issues)
with your operating system, the command you ran, and the error message (remove
anything private).

---

## Next steps

- **Faster answers, and more about the models:**
  [Guide 2: real models locally](docs/02-run-a-real-model-locally.md): what each model
  is good at, and how Docker Model Runner uses your computer's graphics chip.
- **Use a bigger model on your own AWS GPU:**
  [Guide 3: deploy a model on SageMaker](docs/03-deploy-a-model-on-sagemaker.md). This
  costs money for every hour the GPU runs.
- **Learn how the pieces fit together:** [Architecture](docs/architecture.md).

---

## For developers: run without Docker

To change the code and see it reload instantly, you can run the server and the website
directly. You need **Python 3.12** (check with `python3 --version`), **Node.js 22**
(check with `node --version`) and `make`.

Open two terminals in the project folder. In the first one, run:

```bash
make backend-dev
```

In the second one, run:

```bash
make frontend-dev
```

Then open http://localhost:3000. This mode uses a simple SQLite database file and a
pretend model built into the server, which answers by describing what it received.
Email verification is switched off, and any email the app sends is printed in the first
terminal. More in [docs/01-quickstart-local.md](docs/01-quickstart-local.md#without-docker)
and [CONTRIBUTING.md](CONTRIBUTING.md).
