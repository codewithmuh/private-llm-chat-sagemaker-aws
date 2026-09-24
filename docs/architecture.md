# Architecture

How the pieces fit, and what happens when you press **Send**.

## The big picture (on AWS)

```mermaid
flowchart LR
    U[Browser] -->|HTTPS| CF[CloudFront]
    CF -->|"/api/*, /admin/*"| ALB[Load balancer]
    CF -->|everything else| ALB
    ALB --> WEB["web<br/>Next.js on ECS Fargate"]
    ALB --> API["api<br/>Django on ECS Fargate"]
    API --> RDS[(RDS PostgreSQL)]
    API --> S3[(S3 uploads bucket)]
    API --> SES[SES email]
    API -->|"sagemaker-runtime<br/>(IAM signed)"| EP["SageMaker endpoint<br/>vLLM on a GPU"]
    CTRL["gpu-controller<br/>ECS Fargate"] -->|create / delete| EP
    CTRL --> RDS
```

| Piece | What it does | Where the code is |
|---|---|---|
| **CloudFront** | HTTPS for free on `*.cloudfront.net` (or your domain), one origin for the whole app | `infra/terraform/modules/cdn` |
| **Load balancer** | Routes `/api/*`, `/admin/*`, `/django-static/*` to Django and the rest to Next.js; only accepts traffic from CloudFront | `infra/terraform/modules/alb` |
| **web** | The chat UI. Server-renders almost nothing: pages run in the browser and call the API | `frontend/` |
| **api** | Accounts, conversations, files, prompt building, streaming answers | `backend/` |
| **gpu-controller** | Starts SageMaker endpoints when needed, deletes them when idle | `backend/apps/llm/controller.py` |
| **SageMaker endpoint** | The model: AWS's vLLM container (or `ml/vllm-router`) on a GPU instance | `infra/terraform/modules/sagemaker`, `ml/` |
| **RDS** | Users, conversations, messages, extracted file text, model registry | Django models in `backend/apps/*/models.py` |
| **S3** | Uploaded files (private bucket, presigned links) | `apps/files` + `django-storages` |

Locally, `docker compose` runs the same `web` and `api` images, with Postgres, Mailpit
and a fake model server instead of RDS, SES and SageMaker.

## What happens when you press Send

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as Django api
    participant DB as Postgres
    participant M as Model (SageMaker / vLLM / Ollama)

    B->>A: POST /api/conversations/{id}/messages/ {content, attachment_ids}
    A->>DB: is the model ready? (endpoint status)
    alt GPU asleep (on-demand model)
        A-->>B: 503 model_starting (and asks the controller to start it)
    end
    A->>DB: save user message + empty assistant message
    A-->>B: event: start
    A->>A: build the prompt: system prompt + history + files, trimmed to fit
    A->>M: chat request, stream=true
    loop every token
        M-->>A: chunk
        A-->>B: event: delta {"content": "..."}
    end
    A->>DB: save the full answer, token counts
    A-->>B: event: done
    A->>M: "write a short title" (first message only)
    A-->>B: event: title
```

Key files, in order:

1. `apps/chat/views.py` `SendMessageView`: validates, checks the model is up
   (`apps/llm/services.ensure_ready`), saves the messages, returns a streaming
   response.
2. `apps/chat/prompting.py` `build_prompt`: turns the conversation into OpenAI-format
   messages. Documents become `<document>` blocks, images become `image_url` parts (or
   OCR text for models without vision), and the whole thing is trimmed to the model's
   context window.
3. `apps/llm/providers/*`: one class per kind of model server, all with the same
   `stream()` interface.
4. `apps/chat/streaming.py` `stream_answer`: reads the provider in a background thread,
   writes Server-Sent Events, sends keep-alive pings, saves progress, and handles Stop.

## Why these choices

**Streaming with Server-Sent Events, not WebSockets.** SSE is plain HTTP: it works
through CloudFront, load balancers and corporate proxies, needs no extra server, and
the browser reads it with `fetch()`. Chat only needs server → browser streaming.

**Sync Django + gunicorn threads, not async.** boto3 (SageMaker) is synchronous, and
threaded workers stream fine: each answer holds one thread. 2 workers × 16 threads =
32 simultaneous answers per container; add containers to scale.

**Session cookies, not JWTs in localStorage.** An `HttpOnly` cookie can't be read by
JavaScript, so an XSS bug can't steal the session. The cost is CSRF protection, which
Django provides. CloudFront puts the UI and the API on one origin, so cookies need no
cross-site settings.

**The app never talks to SageMaker over HTTP.** A SageMaker endpoint has no public URL.
Calls go through the AWS API, signed with the api task's IAM role. There's no API key to
leak, and without IAM permission in your account nobody can call your model.

**The GPU controller owns the endpoint, Terraform doesn't.** Terraform creates the model
and endpoint *configuration* (free). A GPU endpoint costs ~$1–2+/hour just by existing,
so the controller creates it when someone chats and deletes it after `idle_minutes`. If
Terraform owned it, every `apply` would recreate an endpoint the controller had
stopped.

**One prompt format everywhere.** vLLM, Ollama, LM Studio, OpenAI and SageMaker's vLLM
containers all accept the OpenAI chat-completions format. The backend builds it once;
each provider only differs in *how* it sends it.

## The GPU controller's state machine

```mermaid
stateDiagram-v2
    [*] --> NotFound
    NotFound --> Creating: wanted (message sent / always_on)
    Creating --> InService: model loaded (5-15 min)
    Creating --> Failed: error (quota, bad model, OOM)
    InService --> Deleting: idle for idle_minutes / scaling=off
    Failed --> Deleting: record error, back off 10 min
    Deleting --> NotFound
```

`decide()` in `apps/llm/controller.py` is a pure function of (scaling mode, wanted?,
status, config, last use, last error), so the whole policy is readable in one place
and covered by a table test (`tests/test_controller.py`).

## Data model

```mermaid
erDiagram
    User ||--o{ Conversation : has
    User ||--o{ Attachment : uploads
    User ||--o| TOTPDevice : "authenticator app"
    User ||--o{ RecoveryCode : has
    User ||--o{ OneTimeCode : "email codes"
    Conversation ||--o{ Message : contains
    Message ||--o{ Attachment : "sent with"
    LLMModel {
        string slug
        string provider "sagemaker | openai | mock"
        string endpoint_name
        string scaling "on_demand | always_on | off | manual"
        string endpoint_status
    }
```

Conversations store the model's **slug**, not a foreign key: a conversation outlives
the model it started with.

## Privacy by design

- Prompts and answers are **never logged**, only ids, sizes, durations and statuses.
- SageMaker **Data Capture is off** (it would copy every prompt to S3).
- Files live in a **private** bucket; the browser gets 5-minute presigned links.
- The Django admin shows conversation **metadata only**, not message text.
- Everything (model, database, files) stays in **your** AWS account and region.
