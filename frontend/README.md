# Web app (Next.js)

The ChatGPT-like interface for Private LLM Chat. It is a **client-side app**:
every page renders in the browser and talks to the Django API with `fetch`.
The Next.js server only serves the pages (and `/healthz`).

- Next.js 16 (App Router, `output: "standalone"`), React 19, TypeScript (strict)
- Plain CSS: design tokens in `src/app/globals.css` + one CSS Module per component. No Tailwind, no UI kit.
- `lucide-react` icons; `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-highlight` for answers

The API it talks to is documented in [`docs/api.md`](../docs/api.md).

## Run it

```bash
cd frontend
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev                     # http://localhost:3000 (the API must be on :8000)
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload on port 3000 |
| `npm run build` | Production build (`.next/standalone/server.js`) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (flat config in `eslint.config.mjs`; Next 16 removed `next lint`) |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |

### Configuration

Only one variable, read at **build time** (it is inlined into the JavaScript):

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `""` | Where the API is. Empty = same origin (production, where CloudFront sends `/api/*` to Django). `http://localhost:8000` in local dev. |

Everything else (app name, Google client id, upload limits, whether sign-up is
open) comes from `GET /api/config/` at runtime, so one image works everywhere.

### Docker

```bash
docker build -t llmchat-web frontend                         # same-origin API
docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost:8000 -t llmchat-web frontend
docker run -p 3000:3000 llmchat-web                          # health check: GET /healthz
```

Multi-stage (deps → build → runner) on `node:24-alpine`, runs as the non-root
`node` user, builds for `linux/amd64` and `linux/arm64`.

## Folder structure

```
src/
  app/                        routes (App Router)
    layout.tsx                <html>, global CSS, theme script, global providers
    globals.css               design tokens (light + dark) and shared primitives (.btn, .input…)
    icon.svg                  favicon / app icon
    healthz/route.ts          GET /healthz -> "ok" (container health check)
    (auth)/                   signed-out pages, centered card layout
      login/ signup/ verify-email/ forgot-password/ reset-password/
    (app)/                    signed-in pages
      layout.tsx              auth guard + providers + sidebar shell
      page.tsx                "/"  new chat
      c/[id]/page.tsx         "/c/<id>"  a conversation
      settings/page.tsx       General | Security | Data
      ocr/page.tsx            OCR tool
  components/
    ui/                       generic building blocks: Dialog, Menu, Toast, Confirm, Tabs, OtpInput, Field…
    shell/                    AppShell, Sidebar, ConversationList/Item, UserMenu
    chat/                     ChatView, MessageList, MessageItem, Markdown, Thinking, Composer, ModelPicker, ModelBanner…
    auth/                     AuthShell, GoogleButton, MfaStep, PasswordStrength
    settings/                 the three settings tabs + 2FA dialogs
    ocr/                      OcrTool
  providers/                  React context: config, theme, session, models, conversations, chat store
  hooks/                      small reusable hooks (useCooldown, useCopy, useMediaQuery…)
  lib/
    api.ts                    typed fetch wrapper: base URL, cookies, CSRF, ApiError
    sse.ts                    POST + Server-Sent Events parser (chat streaming)
    upload.ts                 file upload with progress (XMLHttpRequest)
    types.ts                  User, Model, Conversation, Message, Attachment… (mirrors docs/api.md)
    thinking.ts               splits <think>…</think> reasoning from the answer
    …                         formatting, forms, theme, browser helpers
  styles/highlight.css        code highlighting colors (uses the theme tokens)
```

## How the important parts work

### Sessions and CSRF (`src/lib/api.ts`)

The API uses Django's session cookie, not tokens, so no secret ever sits in
JavaScript or localStorage.

1. Every request uses `credentials: "include"`, so the browser sends the
   `sessionid` cookie (HttpOnly; we can't read it, and don't need to).
2. Django requires a CSRF token on POST/PATCH/PUT/DELETE. The first time one is
   needed, `ensureCsrf()` calls `GET /api/auth/csrf/`, which sets the
   `csrftoken` cookie. We copy that cookie into the `X-CSRFToken` header.
3. Django **rotates** the token when you log in, so the cookie is read fresh on
   every request instead of being stored in a variable.
4. A `403 csrf_failed` gets a fresh token and one retry. A `401` anywhere in the
   signed-in app sends you to `/login?next=<where you were>`.

In local dev the page is on `localhost:3000` and the API on `localhost:8000`.
Those count as the *same site*, so cookies flow (the API allows the origin with CORS).

Errors always come back as `ApiError { status, code, message, fields }`;
`lib/forms.ts` turns `fields` into inline form errors.

### Chat streaming (`src/lib/sse.ts`, `src/providers/ChatProvider.tsx`)

`EventSource` can't POST, so we `fetch` with POST and read the response body as
a stream, splitting it into Server-Sent Events (`event:` / `data:` lines,
blank line between events, `:` lines are keep-alives).

1. Your message appears immediately with an empty answer under it.
2. If the server refuses before streaming (400, 404, `503 model_starting`…),
   nothing was saved: both local messages disappear and the text and files go
   back into the message box. For `model_starting` the GPU banner appears and
   polls `GET /api/models/` every 15 s, then says "ready, press Send again".
3. Otherwise the events arrive: `start` (saved messages) → `delta`… (text) →
   `done` or `error`, and `title` for a new chat. Deltas are applied once per
   animation frame.
4. **Stop** does two things: `POST /api/messages/{id}/stop/` (the id comes from
   the `start` event; reliable behind proxies) and `abort()` on the fetch.

**New chat → `/c/<id>` without losing the stream.** The chat store lives in
`app/(app)/layout.tsx`, which stays mounted when the URL changes. On the first
message from `/` we create the conversation, start the stream, then
`router.replace("/c/<id>")`. The new page reads the same store, so the answer
keeps streaming.

Reasoning models: text inside `<think>…</think>` is shown as a collapsible
"Thinking" section (`components/chat/Thinking.tsx`); Copy copies only the answer.

### Uploads (`src/lib/upload.ts`, `components/chat/useUploads.ts`)

`fetch` has no upload progress, so uploads use `XMLHttpRequest` with
`withCredentials = true` and the same `X-CSRFToken` header. Files are checked
against `max_upload_mb` / `accepted_file_types` from `/api/config/` first, then
uploaded as soon as they're added (paperclip, drag and drop, or paste).
Send stays disabled until every upload has finished.

### Theme

`<html data-theme="light|dark">` switches all color tokens. A tiny inline
script in `app/layout.tsx` sets it before the first paint (no white flash);
the choice is saved in localStorage and in the user's preferences on the server.

## Adding things

**A page for signed-in users:** create `src/app/(app)/<name>/page.tsx` starting
with `"use client"`. It gets the auth guard, sidebar and all providers for free.
Use `<PageHeader>` (from `components/chat/ChatHeader`) for the top bar and
`useDocumentTitle("…")` for the tab title. Link it from `components/shell/UserMenu.tsx`
or `Sidebar.tsx`.

**A public page:** put it under `src/app/(auth)/` to get the centered card, or
directly under `src/app/` for a blank page.

**A component:** `src/components/<area>/MyThing.tsx` + `MyThing.module.css`.
Use the tokens (`var(--text)`, `var(--surface-2)`, `var(--radius)`…) instead of
raw colors so dark mode keeps working. For animations inside a CSS Module use
`animation: var(--anim-pop-in)` (and friends): CSS Modules rename keyframe
names, so global keyframes can't be referenced by name there.

**An API call:** add the response type to `lib/types.ts`, then
`await api.get<MyType>("/api/…")` / `api.post(…)`. Wrap it in `try/catch` and
show `errorMessage(error)` with `useToast()`.
