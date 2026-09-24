# Infrastructure (Terraform)

Everything the app needs on AWS, in one Terraform root module. For the
step-by-step deployment guide (quota request, Google sign-in, email, first
login) read [docs/deploy-aws.md](../../docs/deploy-aws.md). For money, read
[docs/cost.md](../../docs/cost.md). This page explains the code.

> **Cost warning.** The baseline stack costs roughly **$80–110 per month**
> even when nobody uses it. The GPU is extra and billed **per hour while an
> endpoint exists**: one `ml.g6e.xlarge` is about **$2.61/hour** (≈ $1,900 a
> month if left on). The default `scaling = "on_demand"` deletes it after 30
> idle minutes. Check what is running with `./scripts/gpu.sh status`.

## What gets built

```text
                        ┌────────────────────────── AWS account ───────────────────────────┐
  browser ──HTTPS──►  CloudFront  (modules/cdn)                                             │
                        │  adds header X-Origin-Verify: <secret>                          │
                        │  caches /_next/static/*, /django-static/*                       │
                        ▼  HTTP                                                           │
                      ALB  (modules/alb)  ── only CloudFront IPs, only with the header ── │
                        │ /api/*  /admin/*  /django-static/*        everything else       │
                        ▼                                            ▼                    │
                 ECS "api" (Django)                           ECS "web" (Next.js)          │
                        │                                                                 │
                        ├──► RDS PostgreSQL  (modules/database)   private subnets          │
                        ├──► S3 uploads      (modules/storage)                             │
                        ├──► SES email       (modules/email)                               │
                        └──► SageMaker endpoints (the LLMs) ◄── create / delete ──┐        │
                              (modules/sagemaker: model + endpoint configuration) │        │
                                                             ECS "gpu-controller" ┘        │
                                                             (same image as api)           │
                                                                                          │
  modules/network  VPC, 2 AZs, public + private subnets, S3 endpoint, security groups     │
  modules/ecr      image repositories: api, web (+ vllm-router)                           │
  modules/cicd     optional GitHub Actions deploy role (OIDC, no stored keys)             │
                        └──────────────────────────────────────────────────────────────────┘
```

| Module | What it creates | Worth reading for |
|---|---|---|
| [`network`](modules/network/main.tf) | VPC, 2 public + 2 private subnets, optional NAT gateway, free S3 gateway endpoint, the security groups | The "who may talk to whom" list; the NAT trade-off |
| [`database`](modules/database/main.tf) | RDS PostgreSQL 17 (`db.t4g.micro`), password in Secrets Manager | Why not RDS-managed password rotation |
| [`storage`](modules/storage/main.tf) | Private S3 bucket for chat attachments | Why versioning is off |
| [`ecr`](modules/ecr/main.tf) | Repositories `<name>/api`, `<name>/web`, optional `<name>/vllm-router` | Lifecycle policy |
| [`alb`](modules/alb/main.tf) | Load balancer, target groups, path routing, the secret-header rule | The two locks; the health-check Host header trap |
| [`cdn`](modules/cdn/main.tf) | CloudFront distribution, optional ACM certificate + Route 53 records | Which headers reach Django and why |
| [`email`](modules/email/main.tf) | SES identity (one address or a DKIM domain) | The SES sandbox |
| [`sagemaker`](modules/sagemaker/main.tf) | Per model: SageMaker model + endpoint configuration + log group, one IAM role | **The heart of the project.** Who owns the endpoint; content-addressed names; no data capture |
| [`ecs`](modules/ecs/main.tf) | Fargate cluster, 3 services, task definitions, IAM roles ([iam.tf](modules/ecs/iam.tf)) | Exactly what each container receives |
| [`cicd`](modules/cicd/main.tf) | GitHub OIDC provider + deploy role | What CI is allowed to do |

The root [`main.tf`](main.tf) wires the modules together and builds the
environment for the Django containers in one place (`local.django_environment`).

### Who owns the GPU endpoint

Terraform creates the SageMaker **model** (which container, which weights) and
**endpoint configuration** (which instance type). It never creates the
**endpoint**, the running GPU that costs money. The app's `gpu-controller`
service creates and deletes endpoints according to each model's `scaling`:

| `scaling` | The controller… |
|---|---|
| `on_demand` (default) | creates the endpoint when someone chats with the model; deletes it after `idle_minutes` without use |
| `always_on` | keeps it running |
| `off` | keeps it deleted |
| `manual` | never touches it |

If Terraform managed the endpoint too, every `terraform apply` would re-create
an endpoint the controller had just deleted to save money. The flip side:
**`terraform destroy` cannot delete a running endpoint.** Run
`./scripts/gpu.sh stop` first.

## Files

| File | Purpose |
|---|---|
| `versions.tf` | Terraform ≥ 1.9, AWS provider 6.x, random; the extra `us-east-1` provider for the CloudFront certificate |
| `variables.tf` | Every input, with defaults and validation |
| `terraform.tfvars.example` | Commented example: copy to `terraform.tfvars` (gitignored) |
| `main.tf` | The modules and the container environment |
| `outputs.tf` | `app_url`, names for the scripts, `next_steps` |
| `backend.tf.example` | Optional S3 remote state (needed for Terraform in CI) |
| `.terraform.lock.hcl` | Pinned provider versions. Commit it |
| `tests/offline.tftest.hcl` | `terraform test` with **mocked** providers: checks the wiring without an AWS account |
| `image.auto.tfvars` | Written by `scripts/deploy.sh`: the deployed image tag (gitignored) |

## Inputs you are most likely to set

All inputs have defaults; an empty `terraform.tfvars` deploys a working app
with one model (Qwen3-VL 8B FP8 on `ml.g6e.xlarge`) in `us-east-1`.

| Variable | Default | What for |
|---|---|---|
| `aws_region` | `us-east-1` | A region where you have SageMaker GPU quota |
| `admin_emails` | `[]` | Your email: you become admin when you log in with it |
| `models` | Qwen3-VL 8B | The LLMs (see below) |
| `ses_from_email` / `ses_domain` | unset | Real email. Unset = codes only in CloudWatch logs |
| `google_client_id` | `""` | "Sign in with Google" |
| `domain_name` + `route53_zone_id` | unset | Your own domain instead of `xxxx.cloudfront.net` |
| `enable_nat_gateway` | `false` | Tasks in private subnets behind a NAT (+~$33/month) |
| `environment` | `dev` | `prod` enables deletion protection and final snapshots |
| `hf_token` | `""` | Only for gated Hugging Face models |
| `enable_github_oidc` + `github_repository` | off | Deploy from GitHub Actions |

### Models

```hcl
models = {
  "qwen3-vl-8b" = {                                   # slug: model id in the API/UI, part of the endpoint name
    name            = "Qwen3-VL 8B"
    hf_model_id     = "Qwen/Qwen3-VL-8B-Instruct-FP8" # Hugging Face repo, and the "model" name in requests
    instance_type   = "ml.g6e.xlarge"
    max_model_len   = 32768
    vision          = true
    ocr             = true
    scaling         = "on_demand"
    idle_minutes    = 30
    hourly_cost_usd = 2.61
    default         = true
  }
}
```

With the default `container = "dlc"`, SageMaker runs **AWS's vLLM Deep Learning
Container** (`763104351884.dkr.ecr.<region>.amazonaws.com/vllm:0.30-gpu-py312-cu130-ubuntu24.04-sagemaker`).
Nothing is built or pushed: SageMaker pulls it from AWS's registry. The
container is configured with environment variables: `SM_VLLM_<FLAG>=<value>`
becomes `vllm serve --<flag> <value>`. Terraform sets `SM_VLLM_MODEL`,
`SM_VLLM_SERVED_MODEL_NAME` (= `hf_model_id`), `SM_VLLM_MAX_MODEL_LEN`,
`SM_VLLM_GPU_MEMORY_UTILIZATION`, `SM_VLLM_TENSOR_PARALLEL_SIZE` and, for
vision models, `SM_VLLM_LIMIT_MM_PER_PROMPT`. Add any other vLLM flag with
`extra_env`, e.g. `{ SM_VLLM_MAX_NUM_SEQS = "16" }`.

Every change to a model creates a **new** SageMaker model and endpoint
configuration (their names end in a hash of their settings) before the old
ones are deleted. A running endpoint keeps working on its old configuration;
the controller uses the new one the next time it starts the endpoint. To
switch right away: `./scripts/gpu.sh stop <model>` and chat again.

The api receives the models as the `LLM_MODELS` JSON (see
[docs/configuration.md](../../docs/configuration.md)); `terraform output llm_models`
shows it. Add non-SageMaker providers (OpenAI, any OpenAI-compatible server)
with `extra_llm_models`.

## Apply, update, destroy

```bash
export AWS_PROFILE=my-profile
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # optional; edit it

terraform init
terraform apply        # ~15-20 min the first time (RDS and CloudFront are slow)
cd ../.. && ./scripts/deploy.sh               # build + push images, roll them out
```

`scripts/deploy.sh` also works on a completely empty stack: it creates the ECR
repositories first (`terraform apply -target=module.ecr`), pushes the images,
then applies everything. Until images exist (`image_tag = null`), the ECS
services are created with **zero** tasks.

Offline check of the wiring (no AWS account, mocked providers):

```bash
terraform init -backend=false && terraform test
```

**Destroy:**

```bash
./scripts/gpu.sh stop          # 1. delete GPU endpoints (Terraform does not own them)
./scripts/gpu.sh status        #    wait until nothing is running
terraform -chdir=infra/terraform destroy
```

With `environment = "prod"`, destroy is blocked on purpose (RDS and ALB
deletion protection, non-empty S3 bucket and ECR repositories). Switch those
off deliberately first.

## Security notes

- **No SageMaker Data Capture.** It would copy every prompt, document and
  answer to S3. Deliberately absent (see `modules/sagemaker/main.tf`).
- **No telemetry from the model container:** `OPT_OUT_TRACKING=true` (AWS DLC
  start-up telemetry), `VLLM_NO_USAGE_STATS=1` and `DO_NOT_TRACK=1`.
- **The ALB only accepts CloudFront** (prefix list) **and only with the secret
  header**. Opening the ALB's own DNS name returns 403.
- **Secrets** (Django secret key, database password) are injected by ECS from
  Secrets Manager; they are not in the task definition. They **are** in the
  Terraform state: keep the state private (local file is gitignored; the S3
  backend is encrypted).
- **Visible in consoles:** `hf_token` (SageMaker model environment) and any
  `api_key` in `extra_llm_models` (ECS task definition).
- **IAM is per service:** the api can read/write only the uploads prefix and
  invoke only `<name>-*` endpoints; only the gpu-controller can create or
  delete endpoints; the web container has no AWS permissions.
- **ECS Exec** (a shell in the api container) is enabled outside `prod`.
- `sagemaker_vpc_isolated = true` removes internet access from the model
  container entirely (weights must then come from S3).

## Things that will break, and why

| Symptom | Likely cause | Fix |
|---|---|---|
| Model stuck on "starting", controller log / admin shows `ResourceLimitExceeded ... ml.g6e.xlarge for endpoint usage` | Your account's SageMaker quota for that instance is 0 (the default for new accounts) | Service Quotas → Amazon SageMaker → "ml.g6e.xlarge for endpoint usage" → request 1 ([guide](../../docs/deploy-aws.md#2-get-gpu-quota-for-sagemaker)). Or choose an instance you have quota for |
| Endpoint `Failed`, log shows `401`/`403`, "gated repo" or "Access to model ... is restricted" | Gated Hugging Face model | Accept the license on the model page, set `hf_token`, apply |
| Endpoint `Failed` after 10–30 min: "did not pass the ping health check"; log shows `CUDA out of memory` or "No available memory for the cache blocks" | Model + KV cache do not fit the GPU | Lower `max_model_len`, use an FP8/AWQ variant, or a bigger instance |
| Endpoint `Failed`: "CUDA driver version is insufficient" / "forward compatibility" | Host NVIDIA driver older than the container's CUDA | Keep `inference_ami_version = "al2023-ami-sagemaker-inference-gpu-4-1"` (driver 580, CUDA 13) for the cu130 DLC |
| First message waits 5–15 minutes | Normal cold start: image pull, weight download, model load | `scaling = "always_on"` (costly) or stage weights in S3 (`scripts/stage-weights.sh`) to shorten it |
| Endpoint log: "Failed to download model data" (isolated mode) | Security group blocks S3, bucket in another region, or role cannot read the prefix | The S3 egress rule must use the **prefix list**, not a CIDR (it does); keep the bucket in the stack's region |
| Opening the ALB DNS name shows `Forbidden` | By design: only CloudFront, with the secret header, gets through | Use `app_url` |
| `app_url` returns 502/503 | No healthy tasks: images never deployed (`image_tag` null), or the api crashes on start | `./scripts/deploy.sh`; `aws logs tail /ecs/<name>/api --since 30m` |
| `app_url` returns 504 | The api took more than 60 s to send anything (CloudFront's origin timeout) | Streams must send keep-alive comments; long non-streaming work must be async |
| Django answers `400 Bad Request` | Host not in `ALLOWED_HOSTS` (e.g. you set `domain_name` but use the CloudFront name) | Use `app_url` |
| Targets unhealthy although the app runs | Health check hits Django with the task IP as Host | The backend answers `/api/health/` before host validation (`apps/common/health.py`); keep it that way |
| ECS task stops with `exec format error` | Image built for x86; the tasks run on ARM64 | Build with `--platform linux/arm64` (deploy.sh does) |
| `CannotPullContainerError` | Tag not in ECR, or a private subnet with no NAT | Push the tag; with `enable_nat_gateway = false` tasks must be in public subnets (they are) |
| `ResourceInitializationError: unable to pull secrets` | Execution role cannot read the secret, or no route to Secrets Manager | Check `secret_arns` in the ECS module; network as above |
| Verification email never arrives | `EMAIL_PROVIDER=console`, or SES sandbox (recipient not verified) | Read the code in the api logs; verify the recipient or request SES production access |
| `terraform destroy` finished but GPU billing continues | The controller created an endpoint Terraform does not know about | `./scripts/gpu.sh status` lists strays; `./scripts/gpu.sh stop` |
| Re-creating the stack: "secret ... is already scheduled for deletion" | A prod secret in its 7-day recovery window | `aws secretsmanager delete-secret --secret-id <name> --force-delete-without-recovery` |
| `EntityAlreadyExists: Provider with url https://token.actions.githubusercontent.com` | The account already has the GitHub OIDC provider | `create_github_oidc_provider = false` |
| GitHub Actions: "Not authorized to perform sts:AssumeRoleWithWebIdentity" | The run is not on `main`, or `github_repository` does not match `owner/repo` exactly | Check `github_oidc_subjects` and the repository name |
| CloudFront changes take 5–15 minutes | Global propagation | Wait; `terraform apply` waits for it too |
