# Troubleshooting

## Local (docker compose)

| Symptom | Fix |
|---|---|
| The page says **"Not found. Try again"** | The web app can't reach the API. It expects Django on http://localhost:8000: start it with `make up` (Docker) or `make backend-dev` (no Docker). If your API runs elsewhere, set `NEXT_PUBLIC_API_URL` before `npm run dev` |
| `port is already allocated` | Something else uses 3000/8000/8025. Set `WEB_PORT`, `API_PORT`, `MAILPIT_PORT` in `.env` |
| Sign-up says "check your email" but nothing arrives | Local email goes to **Mailpit**: http://localhost:8025. With `make backend-dev`, the code is printed in the terminal |
| "Your session expired. Refresh the page" on every action | Open the app on `http://localhost:3000`, not `127.0.0.1`: cookies from `localhost:8000` aren't sent to `127.0.0.1` |
| The model picker is empty | The api couldn't load `LLM_MODELS_FILE`. `docker compose logs api` shows the reason (invalid JSON, missing file) |
| "Could not reach the model server at http://ollama:11434/v1" | The Ollama container isn't running: run `make up` again. `docker compose logs ollama` shows why it stopped |
| "Could not reach the model server at http://host.docker.internal:11434/v1" | The app is set up for the Ollama app, and it isn't open. Open Ollama, or `make model` to run models in Docker instead. On Linux, see the `OLLAMA_HOST` note in [guide 2](02-run-a-real-model-locally.md#make-answers-faster-docker-model-runner) |
| `make up` stops at "Downloading..." with an error | No internet, or a mistyped model name (check it on https://ollama.com/library). Run `make model` to choose again. A download that stopped halfway resumes |
| The model answers with an error about memory, or `docker compose logs ollama` says `model requires more system memory` | The model doesn't fit in Docker's memory. Choose a smaller one (`make model`), or raise Docker Desktop → Settings → Resources → Memory |
| "Web search failed" under an answer, or no Search button | The button needs `WEB_SEARCH_URL` (set by `docker-compose.yml`). "Failed": search engines limit automated searches; try again in a minute. `docker compose logs searxng` shows which engines refused (`too many requests`, `CAPTCHA`); SearXNG uses the ones that still answer |
| Answers are very slow | The model runs on the CPU (`MODEL_ENGINE=ollama`; Docker on macOS can't give containers the GPU). Use Docker Model Runner: `make model` and answer yes ([guide 2](02-run-a-real-model-locally.md#make-answers-faster-docker-model-runner)), or a smaller model |
| "Docker Model Runner is switched off" | It was turned off in Docker Desktop (Settings → AI). Turn it on, or `make model` to choose again |
| "Could not reach the model server at http://model-runner.docker.internal/engines/v1" | Docker Model Runner stopped or was turned off. `docker model status`; then `make up` again |
| Docker errors like `read-only file system` or `input/output error` | Docker Desktop's VM disk is in a bad state (often after sleep). Restart Docker Desktop |
| Google button missing | `GOOGLE_CLIENT_ID` is empty. Set it in `.env`, then `docker compose up -d api` |
| Google popup: "origin is not allowed" | Add `http://localhost:3000` (exact, no trailing slash) to the OAuth client's **Authorized JavaScript origins**; it can take a few minutes to apply |

## SageMaker

| Symptom | Fix |
|---|---|
| `ResourceLimitExceeded` when creating the endpoint | No quota for that GPU in that region. Service Quotas → Amazon SageMaker → "`<instance> for endpoint usage`" → request 1 |
| Endpoint `Failed`: "did not pass the ping health check" | Look at the container's logs: CloudWatch → `/aws/sagemaker/Endpoints/<name>`. Usual causes below |
| Logs: `401` / `gated repo` / `Access to model ... is restricted` | Gated model: accept the licence on huggingface.co and pass a token (`--hf-token` / `hf_token`) |
| Logs: `CUDA out of memory` or `max_model_len ... larger than the maximum number of tokens that can be stored in KV cache` | Lower `max_model_len`, use an FP8 variant, or a bigger instance ([models.md](models.md#will-this-model-fit-on-that-gpu)) |
| Logs: `CUDA driver version is insufficient` / `forward compatibility was attempted on non supported HW` | The GPU host image has an older NVIDIA driver than the container needs. The CUDA 13 vLLM container needs `InferenceAmiVersion = al2023-ami-sagemaker-inference-gpu-4-1` (driver 580), which `deploy.py` and Terraform set by default |
| Logs: `model type ... not supported` | This vLLM version doesn't know the architecture. Use a newer DLC tag (`vllm_dlc_image`) or another model |
| Takes 15+ minutes to start | Normal for big models downloading from Hugging Face. Stage weights in S3 ([advanced](05-advanced.md#faster-cold-starts-and-no-internet-weights-in-s3)) |
| App: "The model's GPU is asleep" and never wakes | Is the gpu-controller running? On AWS: ECS → service `gpu-controller` → logs. Locally it only runs with `make up-aws`. `/admin/` → LLM models shows the last error |
| App: "This server is not allowed to call the SageMaker endpoint" | The api's IAM role (AWS) or your `AWS_PROFILE` (local) lacks `sagemaker:InvokeEndpoint*` on that endpoint |
| Answers stop after a few words | `max_output_tokens` too low for that model, or the conversation filled the context window |

## AWS (full stack)

| Symptom | Fix |
|---|---|
| CloudFront URL shows **403** | The request reached the load balancer without CloudFront's secret header (e.g. you opened the ALB's own URL). Use the CloudFront URL |
| **502/503** from CloudFront right after deploying | The ECS tasks are still starting or failing health checks. ECS → cluster → service → Events / Logs |
| api logs: `Missing required environment variables` | A secret or variable wasn't injected. `terraform apply` again and check the task definition |
| Emails never arrive | SES sandbox: you can only send to verified addresses until you request production access. Check the api logs for SES errors |
| "Web search failed" in the chat | Look at `/ecs/<name>/searxng` in CloudWatch. Search engines limit requests from cloud IPs (`too many requests`, `CAPTCHA`); SearXNG skips those engines. If the container keeps restarting, the api task may be short of memory: raise `api_memory` |
| `terraform destroy` hangs on the VPC / subnets | A SageMaker endpoint created by the GPU controller still exists. `./scripts/gpu.sh stop` first, then destroy again |

## Still stuck?

Open an issue with what you ran, what you expected, and the relevant logs (remove
anything private). Include whether you're running locally, only the model on
SageMaker, or the full stack.
