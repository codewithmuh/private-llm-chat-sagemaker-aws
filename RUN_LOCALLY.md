# Run Private LLM Chat on your computer

This guide takes you from a computer with nothing installed to chatting in the app.
You don't need a GPU, an AWS account, or any programming experience. Plan for about
15 minutes, most of it waiting for downloads.

> **What you'll have at the end:** the whole app running on your own computer, with
> sign-up, login, chat, file uploads and OCR. The AI model is a **pretend one** (a
> "mock") that answers by describing what it received. That's on purpose: you can
> try everything for free. Connecting a real model comes after this guide (see
> [Next steps](#next-steps)).

## What you need

| | |
|---|---|
| A computer | Mac, Windows 10/11, or Linux, ideally with 8 GB of memory or more |
| Free disk space | At least 5 GB |
| Internet | For the first setup only (it downloads 2–3 GB) |
| Docker Desktop | Runs the app. Free for personal use. You install it in step 1 |
| Git | Downloads the code. You install it in step 1 |

You do **not** need to install Python, Node.js or a database. Docker brings all of them.

### How to use the terminal

Every step below types commands into a **terminal**, a window where you type
instructions instead of clicking.

- **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
- **Windows:** click Start, type `PowerShell`, open **Windows PowerShell**.
- **Linux:** press `Ctrl + Alt + T` on most systems.

To run a command, copy it from this page, paste it into the terminal and press
**Enter**. Wait until it finishes (you get a fresh line where you can type again)
before running the next one. When a box shows several lines, run them one at a time,
top to bottom.

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
  clicking **Next** to accept the defaults. Then **close PowerShell and open it again**
  so it can find Git.
- **Linux (Ubuntu/Debian):** run `sudo apt install git make`

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
found" or "is not recognized", see [Something went wrong?](#something-went-wrong).

---

## Step 2: Download the code

These commands put the project in your home folder.

**Mac or Linux:**

```bash
cd ~
git clone https://github.com/codewithmuh/private-llm-chat-sagemaker-aws.git
cd private-llm-chat-sagemaker-aws
```

**Windows (PowerShell):**

```powershell
cd ~
git clone --config core.autocrlf=false https://github.com/codewithmuh/private-llm-chat-sagemaker-aws.git
cd private-llm-chat-sagemaker-aws
```

> **Windows users: keep `--config core.autocrlf=false`.** By default, Git on Windows
> changes the line endings of text files, which breaks one of the app's startup
> scripts inside Docker. This option keeps the files exactly as they are.

`cd` means "change directory": it moves the terminal into a folder. **Run every
command from here on inside the project folder.** If you open a new terminal later,
run this first:

```bash
cd ~/private-llm-chat-sagemaker-aws
```

---

## Step 3: Start the app

Check that Docker Desktop is running, then:

**Mac or Linux:**

```bash
make up
```

**Windows (PowerShell):** Windows doesn't come with `make`, so run the two commands
it would run for you:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

What happens now:

- Docker downloads what the app needs (a database, a test email inbox, Python,
  Node.js) and builds the app. **The first time takes 5–15 minutes**, depending on
  your internet and computer. Lots of text scrolls by. That's normal.
- It's done when you get your prompt back and see lines like
  `Container llmchat-web-1  Started`.
- Starting the app again later takes seconds, because everything is already downloaded.

This step also created a file called `.env`, which holds the app's settings. You don't
need to change it now.

---

## Step 4: Check that it's running

```bash
docker compose ps
```

You should see five services: `api`, `mailpit`, `mock-llm`, `postgres` and `web`, all
with a STATUS starting with `Up`. The `api` line says `(health: starting)` for up to a
minute, then `(healthy)`. Run the command again until it does.

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
  ChatGPT.
- **The answers look strange, and that's expected.** The pretend model doesn't really
  answer: it **describes what the app sent it**, such as the instructions, how many
  messages and which files. A real AI model gets exactly the same thing.
- **Attach a file:** click the paperclip next to the message box and pick a PDF, Word
  document, text file or image. Then ask about it.
- **OCR (read text from a picture):** open **OCR tool** in the sidebar and drop in an
  image. The pretend model returns sample text; a real vision model returns the real text.
- **Settings:** open your user menu (bottom-left) for **Settings** and the light/dark
  theme. Under **Settings → Security** you can turn on two-factor authentication.

---

## Stop, restart, start over

| What you want | Mac / Linux | Windows (PowerShell) |
|---|---|---|
| Stop the app (accounts and chats are kept) | `make down` | `docker compose --profile ollama down` |
| Start it again | `make up` | `docker compose up -d --build` |
| Watch what the app is doing (press `Ctrl + C` to stop watching) | `make logs` | `docker compose logs -f api web` |
| **Delete everything** and start fresh (erases all accounts, chats and files) | `make reset` | `docker compose --profile ollama down -v` |

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
| `Cannot connect to the Docker daemon`, `failed to connect to the docker API` or `error during connect` | Docker Desktop isn't running. Open it, wait for **Engine running**, and try again |
| `docker: command not found` or `'docker' is not recognized` | Docker Desktop isn't installed, or the terminal was opened before you installed it. Close the terminal and open a new one |
| `make: command not found` (Mac or Linux) | Mac: run `xcode-select --install`. Linux: run `sudo apt install make`. Or use the Windows commands in this guide, which work everywhere |
| `'make' is not recognized` (Windows) | Expected. Use the Windows (PowerShell) commands in this guide |
| `port is already allocated` or `address already in use` | Another program is using port 3000, 8000 or 8025. Open `.env`, change for example `WEB_PORT=3000` to `WEB_PORT=3001`, start again, and use http://localhost:3001 |
| Windows: the `api` keeps restarting, and `docker compose logs api` shows `exec /app/docker-entrypoint.sh: no such file or directory` | Git changed the line endings. Delete the project folder, clone it again with `--config core.autocrlf=false` ([step 2](#step-2-download-the-code)), then do step 3 again |
| The page says **"Not found. Try again"** or won't load | The server is still starting. Wait a minute, check that http://localhost:8000/api/health/ shows `ok`, then refresh |
| "Your session expired. Refresh the page" on every click | You opened `127.0.0.1`. Use http://localhost:3000 instead |
| The verification email never arrives | It never goes to your real inbox. Open Mailpit: http://localhost:8025 |
| The password is rejected | Use at least 8 characters, not only numbers, not a common password, and not too close to your email |
| `no space left on device` | Free some disk space. `docker system prune` deletes old Docker downloads you no longer use |
| Odd errors like `read-only file system` or `input/output error` | Restart Docker Desktop (whale icon → **Restart**) |
| The model list in the chat is empty | Run `docker compose logs api` and look for the error. It's usually a typo in a model file in `config/` |

To see what the server is doing at any time, run `docker compose logs api`.

More fixes are in [docs/troubleshooting.md](docs/troubleshooting.md). Still stuck?
[Open an issue](https://github.com/codewithmuh/private-llm-chat-sagemaker-aws/issues)
with your operating system, the command you ran, and the error message (remove
anything private).

---

## Next steps

- **Chat with a real AI model on your computer, for free:**
  [Guide 2: run a real model locally with Ollama](docs/02-run-a-real-model-locally.md).
  It downloads small open-source models (about 5 GB).
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
pretend model built into the server. Email verification is switched off, and any email
the app sends is printed in the first terminal. More in
[docs/01-quickstart-local.md](docs/01-quickstart-local.md#without-docker) and
[CONTRIBUTING.md](CONTRIBUTING.md).
