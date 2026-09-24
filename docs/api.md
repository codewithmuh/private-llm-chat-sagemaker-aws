# REST API reference

The Django backend serves everything under `/api/`. The Next.js frontend is the
main client, but nothing here is frontend-specific. You can script against it
with `curl` or build your own client.

- **Base URL**: same origin as the web app in production (CloudFront routes
  `/api/*` to Django). In local development it is `http://localhost:8000`.
- **Format**: JSON request and response bodies, except file upload (multipart)
  and chat streaming (Server-Sent Events).
- **Ids**: UUIDs (strings). Timestamps: ISO-8601 in UTC.

---

## Authentication model

The API uses **Django session cookies**, not bearer tokens. That keeps
credentials out of JavaScript (`sessionid` is `HttpOnly`).

1. Call `GET /api/auth/csrf/` once. It sets a `csrftoken` cookie (readable by JS).
2. Send `credentials: "include"` on every `fetch`.
3. On every `POST`, `PATCH`, `PUT` and `DELETE`, send the header
   `X-CSRFToken: <value of the csrftoken cookie>`.

A successful login (password, Google, email verification or MFA step) sets the
`sessionid` cookie. Django rotates the CSRF token at login, so **read the
cookie again** after logging in; don't cache it in a variable.

```bash
# curl example: keep cookies in a jar
curl -c jar -b jar http://localhost:8000/api/auth/csrf/
TOKEN=$(grep csrftoken jar | awk '{print $7}')
curl -c jar -b jar -H "X-CSRFToken: $TOKEN" -H "Content-Type: application/json" \
     -d '{"email":"ada@example.com","password":"correct horse battery"}' \
     http://localhost:8000/api/auth/login/
```

## Errors

Every error has the same shape:

```json
{
  "error": "Human readable message you can show to the user.",
  "code": "machine_readable_code",
  "fields": { "email": "Enter a valid email address." }
}
```

`fields` is present only for validation errors (HTTP 400). Common codes:

| HTTP | code | Meaning |
|---|---|---|
| 400 | `invalid` | Validation failed; see `fields` |
| 400 | `invalid_credentials` | Wrong email or password |
| 400 | `invalid_code` / `expired_code` | A one-time code is wrong or expired |
| 401 | `not_authenticated` | No session, or it expired |
| 403 | `email_not_verified` | Log in refused until the email address is verified |
| 403 | `permission_denied` / `csrf_failed` | Not allowed / missing CSRF header |
| 404 | `not_found` | Unknown id, or it belongs to another user |
| 413 | `file_too_large` | Upload bigger than `max_upload_mb` |
| 415 | `unsupported_file_type` | Upload type not accepted |
| 429 | `throttled` / `too_many_attempts` | Rate limited |
| 503 | `model_starting` | The model's GPU endpoint is starting; retry later |
| 503 | `model_unavailable` | The model is stopped/off or its endpoint failed |

---

## Public

### `GET /api/health/`
`200 {"status": "ok"}`. Used by the load balancer; no auth, no DB access.

### `GET /api/config/`
Runtime configuration for the web app, so the frontend never needs rebuilding
to change these.

```json
{
  "app_name": "Private LLM Chat",
  "google_client_id": "1234.apps.googleusercontent.com",
  "signup_enabled": true,
  "email_verification": "mandatory",
  "max_upload_mb": 20,
  "accepted_file_types": [".pdf", ".docx", ".txt", ".md", ".csv", ".json", ".png", ".jpg", ".jpeg", ".webp", ".gif"]
}
```

`google_client_id` is `null` when Google sign-in is not configured. Hide the
button in that case. `email_verification` is `"mandatory"`, `"optional"` or `"none"`.

---

## Auth — `/api/auth/`

### The `User` object

```json
{
  "id": "5d3c…",
  "email": "ada@example.com",
  "name": "Ada Lovelace",
  "avatar_url": null,
  "email_verified": true,
  "has_password": true,
  "google_linked": false,
  "is_staff": false,
  "mfa": {
    "enabled": true,
    "totp": true,
    "email": false,
    "recovery_codes_remaining": 8
  },
  "preferences": {
    "default_model": "qwen3-vl-8b",
    "custom_instructions": "Answer briefly.",
    "theme": "system"
  },
  "date_joined": "2026-09-24T10:00:00Z"
}
```

`preferences.theme` is `"system"`, `"light"` or `"dark"`. `default_model` is a
model `id` (slug) or `null`.

### Login responses

`login/`, `google/` and `verify-email/` answer with one of:

```json
{ "status": "ok", "user": { …User } }
```
```json
{ "status": "mfa_required", "methods": ["totp", "email", "recovery"] }
```

`mfa_required` means the password (or Google) step passed and the server is
holding a **pending login** for 10 minutes. Finish it with `POST login/mfa/`.
`methods` lists only what this user has enabled (`recovery` whenever any is).

### Endpoints

| Method & path | Body | Success |
|---|---|---|
| `GET csrf/` | — | `204`, sets `csrftoken` cookie |
| `POST signup/` | `{email, password, name?}` | `201 {"status":"verification_required","email"}` when verification is mandatory, else `201 {"status":"ok","user"}` (logged in) |
| `POST verify-email/` | `{email, code}` | Login response (logs in) |
| `POST verify-email/resend/` | `{email}` | `200 {"status":"sent"}` (always; no account enumeration) |
| `POST login/` | `{email, password}` | Login response. `403 email_not_verified` if verification is mandatory and pending (a fresh code is emailed) |
| `POST login/mfa/` | `{method: "totp"\|"email"\|"recovery", code}` | `{"status":"ok","user"}` |
| `POST login/mfa/email/` | — | `200 {"status":"sent"}`, emails a code for the pending login |
| `POST google/` | `{credential}` (Google Identity Services ID token) | Login response. Creates the account on first sign-in; links to an existing account with the same verified email |
| `POST logout/` | — | `204` |
| `GET me/` | — | `User`, or `401 not_authenticated` |
| `PATCH me/` | `{name?, preferences?: {default_model?, custom_instructions?, theme?}}` | `User` |
| `DELETE me/` | `{password}` (or `{confirm: "DELETE"}` for accounts without a password) | `204`, deletes the account and all its data |
| `POST password/change/` | `{current_password?, new_password}` | `200 {"status":"ok"}`. `current_password` is required when `has_password` |
| `POST password/reset/` | `{email}` | `200 {"status":"sent"}` (always) |
| `POST password/reset/confirm/` | `{uid, token, new_password}` | `200 {"status":"ok"}` |

The password reset email links to `{PUBLIC_URL}/reset-password?uid=…&token=…`.
The verification email contains a 6-digit code (valid 15 minutes, 5 attempts).

### Two-factor authentication — `/api/auth/mfa/`

| Method & path | Body | Success |
|---|---|---|
| `GET mfa/` | — | `{"enabled","totp","email","recovery_codes_remaining"}` |
| `POST mfa/totp/setup/` | — | `{"secret":"BASE32…","otpauth_url":"otpauth://totp/…","qr_svg":"<svg …>"}`. Nothing is enabled yet |
| `POST mfa/totp/confirm/` | `{code}` | `{"status":"ok","recovery_codes":["abcd-efgh", …]}`, TOTP enabled. `recovery_codes` is non-empty only when this is the user's **first** MFA method; show them once |
| `POST mfa/totp/disable/` | `{code}` (TOTP or recovery code) | `{"status":"ok"}` |
| `POST mfa/email/send/` | — | `{"status":"sent"}`, a code to the account email (used to enable **or** disable email 2FA) |
| `POST mfa/email/confirm/` | `{code}` | `{"status":"ok","recovery_codes":[…]}`, email 2FA enabled (same rule for `recovery_codes`) |
| `POST mfa/email/disable/` | `{code}` (emailed code or recovery code) | `{"status":"ok"}` |
| `POST mfa/recovery-codes/` | `{code}` (a TOTP or emailed code) | `{"recovery_codes":[…]}`, replaces the old set |

When the last method is disabled, recovery codes are deleted and
`mfa.enabled` becomes `false`.

---

## Models — `/api/models/`

### `GET /api/models/`

The models this deployment offers, in display order.

```json
[
  {
    "id": "qwen3-vl-8b",
    "name": "Qwen3-VL 8B",
    "description": "Chat, vision and OCR. Runs on one ml.g6e.xlarge.",
    "provider": "sagemaker",
    "vision": true,
    "ocr": true,
    "context_window": 32768,
    "is_default": true,
    "status": "ready",
    "status_detail": ""
  }
]
```

- `provider`: `"sagemaker"`, `"openai"` (any OpenAI-compatible server: vLLM,
  Ollama, LM Studio…) or `"mock"`.
- `vision`: accepts images directly. Images sent to a model without vision are
  OCR'd first and passed as text.
- `ocr`: preferred model for the OCR tool.
- `status`: `"ready"`, `"starting"`, `"stopped"`, `"failed"` or `"unknown"`.
  Non-SageMaker models are always `"ready"`. `status_detail` is a sentence to
  show next to a non-ready model (e.g. `"Starting — usually 8-12 minutes"`).

### `POST /api/models/{id}/wake/`

Ask for a stopped on-demand model to start (the GPU controller picks it up
within ~30 s). `202 {"status":"starting","status_detail":"…"}`. Idempotent.

---

## Conversations — `/api/conversations/`

### `Conversation`

```json
{
  "id": "9f1e…",
  "title": "Summarise the Q3 report",
  "model": "qwen3-vl-8b",
  "pinned": false,
  "system_prompt": "",
  "created_at": "2026-09-24T10:00:00Z",
  "updated_at": "2026-09-24T10:05:00Z"
}
```

A new conversation's `title` is `""` until the first answer completes; the
server then generates one and sends a `title` event on the stream.

### `Message`

```json
{
  "id": "0c7a…",
  "role": "assistant",
  "content": "Markdown text…",
  "model": "qwen3-vl-8b",
  "status": "complete",
  "error": null,
  "attachments": [ { …Attachment } ],
  "usage": { "prompt_tokens": 812, "completion_tokens": 240 },
  "duration_ms": 5120,
  "created_at": "2026-09-24T10:05:00Z"
}
```

`role`: `"user"` or `"assistant"`. `status`: `"complete"`, `"streaming"`,
`"stopped"` (user pressed stop, `content` is the partial answer) or `"error"`
(`error` holds a message). `usage` and `duration_ms` may be `null`.

### Endpoints

| Method & path | Body / query | Success |
|---|---|---|
| `GET /api/conversations/` | `?q=search` (optional, matches titles) | `{"results":[Conversation…]}`, pinned first, then most recently updated (max 500) |
| `POST /api/conversations/` | `{model?, title?, system_prompt?}` | `201 Conversation` |
| `GET /api/conversations/{id}/` | — | `Conversation` plus `"messages":[Message…]` (oldest first) |
| `PATCH /api/conversations/{id}/` | `{title?, model?, pinned?, system_prompt?}` | `Conversation` |
| `DELETE /api/conversations/{id}/` | — | `204` |
| `DELETE /api/conversations/` | — | `204`, deletes **all** of the user's conversations |

---

## Chat streaming

### `POST /api/conversations/{id}/messages/`

Send a user message and stream the assistant's answer.

```json
{
  "content": "What is in this invoice?",
  "attachment_ids": ["a1b2…"],
  "model": "qwen3-vl-8b"
}
```

- `content` may be empty only if there are attachments.
- `attachment_ids`: files uploaded with `POST /api/files/` (max 10).
- `model` is optional. It switches the conversation to that model.

### `POST /api/conversations/{id}/regenerate/`

Body `{"model"?}`. Deletes the last assistant message and answers the last user
message again. Same stream format.

### `POST /api/messages/{id}/stop/`

Stop a streaming answer. `200 {"status":"stopped"}`. Closing the HTTP
connection (aborting the `fetch`) also stops it; this endpoint is the reliable
way when a proxy sits in between.

### The stream

If validation fails before streaming starts, you get a normal JSON error
(`400`, `404`, `503 model_starting`…). Otherwise the response is
`Content-Type: text/event-stream` and carries these events:

```text
event: start
data: {"user_message": {…Message}, "assistant_message": {…Message, "status": "streaming", "content": ""}}

event: delta
data: {"content": "Hello"}

event: delta
data: {"content": " world"}

event: done
data: {"message": {…Message, "status": "complete"}}

event: title
data: {"conversation_id": "9f1e…", "title": "Greeting the world"}
```

- `start`: first event. `user_message` is `null` on regenerate.
- `delta`: a piece of the answer; append it.
- `done`: the final saved message (`status` is `complete` or `stopped`).
- `title`: only after the first exchange in a conversation.
- `error`: `data: {"code": "provider_error", "error": "Human readable…", "message": {…Message}}`.
  Replaces `done`; the saved message has `status: "error"`. `code` is one of
  `provider_error`, `model_starting`, `model_unavailable`, `context_too_long`.
- Lines starting with `:` are keep-alive comments. Ignore them.

Minimal client:

```ts
const res = await fetch(`/api/conversations/${id}/messages/`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
  body: JSON.stringify({ content: "Hi" }),
  signal: abortController.signal,
});
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  let i;
  while ((i = buffer.indexOf("\n\n")) >= 0) {
    const raw = buffer.slice(0, i); buffer = buffer.slice(i + 2);
    const event = /^event: (.*)$/m.exec(raw)?.[1];
    const data = /^data: (.*)$/m.exec(raw)?.[1];
    if (event && data) handle(event, JSON.parse(data));
  }
}
```

---

## Files — `/api/files/`

### `Attachment`

```json
{
  "id": "a1b2…",
  "filename": "invoice.pdf",
  "content_type": "application/pdf",
  "size": 482113,
  "kind": "document",
  "status": "ready",
  "error": null,
  "page_count": 3,
  "has_text": true,
  "text_chars": 5231,
  "text_preview": "INVOICE #2291 …",
  "ocr_done": false,
  "url": "/api/files/a1b2…/content/",
  "created_at": "2026-09-24T10:04:00Z"
}
```

- `kind`: `"image"` or `"document"`.
- `status`: `"ready"` or `"error"` (text extraction failed: the file is kept,
  `error` says why).
- `has_text`: text was extracted (or OCR'd). A scanned PDF has `has_text: false`
  until you run OCR on it.
- `url`: the file itself (authenticated; redirects to a short-lived S3 URL in
  production). Use it as an `<img src>` for images.

### Endpoints

| Method & path | Body | Success |
|---|---|---|
| `POST /api/files/` | multipart form, field `file` | `201 Attachment` |
| `GET /api/files/{id}/` | — | `Attachment` |
| `GET /api/files/{id}/content/` | — | The file bytes (or `302` to S3) |
| `GET /api/files/{id}/text/` | — | `{"text":"…","source":"extracted"\|"ocr"\|null}` |
| `POST /api/files/{id}/ocr/` | `{model?, force?}` | `{"text":"…","engine":"llm:qwen3-vl-8b"\|"tesseract","duration_ms":4210, "attachment": Attachment}`. Runs OCR now (5–60 s); cached, so `force: true` reruns it |
| `DELETE /api/files/{id}/` | — | `204` |

Accepted types: images (`png`, `jpeg`, `webp`, `gif`) and documents (`pdf`,
`docx`, `txt`, `md`, `csv`, `json`, plus common source-code extensions).
Default limit: 20 MB.

---

## Rate limits

Per client IP for anonymous endpoints, per user otherwise. The defaults are in
`backend/config/settings/base.py` (`REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`):

| Scope | Default |
|---|---|
| `auth` (login, signup, Google, reset, MFA, verification) | 20/min |
| `otp_send` (anything that emails a code) | 5/min |
| `chat` (send / regenerate) | 60/min |
| `upload` | 120/hour |
| `ocr` | 30/hour |
