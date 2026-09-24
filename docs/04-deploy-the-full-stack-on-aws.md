# Deploy to AWS

This guide takes you from an empty AWS account to your own private ChatGPT-like
app, with the LLM running on a SageMaker GPU in **your** account. Nothing you
type into it leaves AWS.

Plan for about an hour the first time, most of it waiting (for the GPU quota,
the database and CloudFront). The infrastructure code is explained in
[infra/terraform/README.md](../infra/terraform/README.md).

> **This costs real money.** About **$80–110/month** for the always-on parts,
> plus the GPU at about **$2.61/hour while it runs** (`ml.g6e.xlarge`). With the
> default `scaling = "on_demand"` the GPU is deleted after 30 idle minutes.
> Details and examples in [cost.md](cost.md). Set a budget alert (step 1) before
> you start.

**Contents**

1. [Prerequisites](#1-prerequisites)
2. [Get GPU quota for SageMaker](#2-get-gpu-quota-for-sagemaker)
3. [Configure](#3-configure)
4. [Create the infrastructure](#4-create-the-infrastructure)
5. [Build and deploy the app](#5-build-and-deploy-the-app)
6. [First login, and becoming admin](#6-first-login-and-becoming-admin)
7. [Real email with Amazon SES](#7-real-email-with-amazon-ses)
8. ["Sign in with Google"](#8-sign-in-with-google)
9. [Your first chat: the GPU cold start](#9-your-first-chat-the-gpu-cold-start)
10. [Changing models and GPU scaling](#10-changing-models-and-gpu-scaling)
11. [Your own domain](#11-your-own-domain)
12. [Updating the app](#12-updating-the-app)
13. [Deploy from GitHub Actions](#13-deploy-from-github-actions)
14. [Day-to-day operations](#14-day-to-day-operations)
15. [Tearing everything down](#15-tearing-everything-down)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Prerequisites

**An AWS account** where you can create IAM roles, VPCs, RDS, ECS, CloudFront
and SageMaker resources (an administrator user or role is simplest).

Set up a budget alert first, so a forgotten GPU cannot surprise you:
AWS console → **Billing and Cost Management → Budgets → Create budget →
"Monthly cost budget"**, e.g. $150, with an email alert.

**Tools on your machine:**

| Tool | Version | Check with | Install |
|---|---|---|---|
| AWS CLI | v2 | `aws --version` | [docs.aws.amazon.com/cli](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| Terraform | 1.9 or newer (1.10+ for S3 remote state) | `terraform version` | [developer.hashicorp.com/terraform/install](https://developer.hashicorp.com/terraform/install) |
| Docker | with `buildx` | `docker buildx version` | Docker Desktop, or Docker Engine + buildx plugin |
| git | any | `git --version` | |
| jq *(optional)* | any | `jq --version` | The scripts fall back to `python3` without it |

**AWS credentials for the CLI.** Use a named profile, never keys in files in
this repository:

```bash
# IAM Identity Center (SSO), recommended:
aws configure sso --profile llmchat
aws sso login --profile llmchat

# or an IAM user's access key, stored in ~/.aws/credentials (outside the repo):
aws configure --profile llmchat

export AWS_PROFILE=llmchat
aws sts get-caller-identity          # must print your account id
```

Every command in this guide assumes `AWS_PROFILE` is exported in your shell.

**Docker and ARM64.** The containers run on AWS Graviton (ARM64), which is
cheaper. On an Apple Silicon Mac the images build natively. On an Intel/AMD
machine Docker emulates ARM with QEMU: slower (10–20 minutes for the first
build), but it works. Docker Desktop has QEMU built in; on Linux run once:

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

## 2. Get GPU quota for SageMaker

New AWS accounts can usually run **zero** GPU instances on SageMaker. Without
quota, everything deploys fine, but the model never starts and the GPU
controller logs `ResourceLimitExceeded`. Request it now: approval takes from
minutes to a couple of days.

1. Pick your region (default `us-east-1`). The GPU must be in the same region
   as the rest of the stack.
2. AWS console → **Service Quotas** → **AWS services** → **Amazon SageMaker**.
3. Search for **`ml.g6e.xlarge for endpoint usage`**. ("endpoint usage", not
   "training job usage" or "processing job usage".)
4. **Request increase at account level** → new value **1** → Request.
   In the case notes, a sentence like "Hosting a private LLM for internal use
   with a SageMaker real-time endpoint" helps.

Or with the CLI:

```bash
aws service-quotas list-service-quotas --service-code sagemaker --region us-east-1 \
  --query "Quotas[?QuotaName=='ml.g6e.xlarge for endpoint usage'].[QuotaCode,Value]" --output table

aws service-quotas request-service-quota-increase --service-code sagemaker --region us-east-1 \
  --quota-code <QuotaCode from above> --desired-value 1
```

Prefer a cheaper or more available GPU? Request quota for that instance type
instead (for example `ml.g6.xlarge`, 24 GB) and change `instance_type` in
step 3. Rule of thumb: model weights + context memory must fit in the GPU;
[cost.md](cost.md#gpu-prices) lists GPU memory per instance.

## 3. Configure

```bash
git clone https://github.com/<you>/private-llm-chat-sagemaker-aws.git
cd private-llm-chat-sagemaker-aws
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
```

Every setting has a default, so an empty file works. For a first deployment,
set just these in `infra/terraform/terraform.tfvars`:

```hcl
aws_region   = "us-east-1"            # where you got the GPU quota
admin_emails = ["you@example.com"]    # you become admin when you log in with this address
```

Everything else can be added later with another `terraform apply`. The file is
gitignored: it never ends up in git.

## 4. Create the infrastructure

```bash
cd infra/terraform
terraform init
terraform apply
```

Terraform lists about 80 resources and asks for `yes`. The first apply takes
**15–20 minutes**; RDS and CloudFront are the slow ones. When it finishes it
prints `app_url` and `next_steps`.

What you have now: the network, database, bucket, load balancer, CloudFront,
the SageMaker model definition, and three ECS services running **zero**
containers, because no images exist yet. No GPU is running.

> You can also skip this step: `./scripts/deploy.sh` (next step) runs
> `terraform apply` itself and, on an empty stack, creates the image
> repositories first.

## 5. Build and deploy the app

From the repository root:

```bash
./scripts/deploy.sh
```

It:

1. logs Docker in to your ECR registry,
2. builds `backend/` (Dockerfile target `api`) and `frontend/` for
   `linux/arm64`, tagged with the git commit (e.g. `3f2a9c1b7d4e`),
3. pushes both images,
4. runs `terraform apply -var image_tag=<tag>` (Terraform owns the ECS task
   definitions, so the rollout goes through it) and remembers the tag in
   `infra/terraform/image.auto.tfvars`,
5. waits until the `api`, `web` and `gpu-controller` services are stable.

On its first start the api runs all database migrations and loads the models
from `LLM_MODELS` into the database (`RUN_BOOTSTRAP=true`). Allow a minute or two.

## 6. First login, and becoming admin

Open the URL printed at the end (also `terraform -chdir=infra/terraform output app_url`),
something like `https://d1a2b3c4d5e6f7.cloudfront.net`, and sign up with the
address you put in `admin_emails`.

**Email verification code.** Until you set up SES (step 7) the app is in
**console** mode: it does not send email, it prints the email, code included,
to the api's log. Read it with:

```bash
aws logs tail /ecs/llmchat-dev/api --follow --since 10m
```

After verifying, log out and in again: a user with a verified address listed in
`admin_emails` is made staff and superuser at login. The admin is at
`<app_url>/admin/`.

Alternative: create a superuser from a shell inside the running container
(ECS Exec, enabled outside `prod`; needs the
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)):

```bash
TASK=$(aws ecs list-tasks --cluster llmchat-dev --service-name api --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster llmchat-dev --task "$TASK" --container api \
  --interactive --command "python manage.py createsuperuser"
```

## 7. Real email with Amazon SES

Pick one:

```hcl
ses_from_email = "no-reply@example.com"   # verify one address (quickest)
# or
ses_domain = "example.com"                # verify a whole domain with DKIM (better deliverability)
```

Run `terraform apply`. Then:

- **One address:** AWS emails a verification link to it. Click it within 24
  hours. The app switches to `EMAIL_PROVIDER=ses` on this apply.
- **Domain:** with `route53_zone_id` set, Terraform creates the three DKIM
  records. Otherwise `terraform output ses_dns_records` lists them; add them at
  your DNS provider. Verification takes minutes to a few hours.

**The SES sandbox.** Every new account starts in it: you can only send **to**
verified addresses, at most 200 emails a day. That is fine for testing (verify
your own address, or a colleague's with
`aws sesv2 create-email-identity --email-identity colleague@example.com`), but
real users will not receive codes. To leave the sandbox: SES console →
**Account dashboard → Request production access**. Describe the mail as
transactional (verification and sign-in codes), give `app_url` as the website.
Approval usually takes about a day.

## 8. "Sign in with Google"

You need `app_url` first (step 4), because Google only accepts sign-ins from
origins you list.

1. Open [console.cloud.google.com](https://console.cloud.google.com/) and
   create (or pick) a project.
2. **Google Auth Platform** (formerly "OAuth consent screen") → **Get started**:
   app name, support email, audience **External**, contact email. Save.
3. **Audience**: while the app is in *Testing*, only the test users you add can
   sign in. Click **Publish app** to allow any Google account (the app only asks
   for name and email, which needs no Google review).
4. **Clients** → **Create client** → application type **Web application**.
5. **Authorized JavaScript origins**: add your `app_url`, e.g.
   `https://d1a2b3c4d5e6f7.cloudfront.net` (no trailing slash; add
   `http://localhost:3000` too if you develop locally). No redirect URIs are
   needed: the app uses Google's ID-token sign-in.
6. Create, and copy the **Client ID** (`1234...apps.googleusercontent.com`).
   It is not a secret.

```hcl
google_client_id = "1234567890-abc123.apps.googleusercontent.com"
```

`terraform apply`, and the button appears (the UI reads it from `/api/config/`).
If you later add a custom domain, add that origin to the client too.

## 9. Your first chat: the GPU cold start

Start a chat. Because no GPU is running, the model shows **starting** and the
GPU controller creates the SageMaker endpoint. A **cold start takes 5–15
minutes**: SageMaker starts a GPU machine, pulls the ~10 GB vLLM container,
downloads the model from Hugging Face and loads it onto the GPU.

Watch it:

```bash
./scripts/gpu.sh status                        # state and $/hour of every model
aws logs tail /aws/sagemaker/Endpoints/llmchat-dev-qwen3-vl-8b --follow
```

Once it is **InService**, answers stream in. With `scaling = "on_demand"` the
endpoint is deleted after `idle_minutes` (default 30) without messages, and the
next message starts it again.

`./scripts/gpu.sh stop` deletes endpoints immediately, but remember that the
controller re-applies each model's `scaling` (an `always_on` model is started
again within a minute). To keep a model off, set `scaling = "off"`.

## 10. Changing models and GPU scaling

Models are defined in `terraform.tfvars` (full field list in
[terraform.tfvars.example](../infra/terraform/terraform.tfvars.example)):

```hcl
models = {
  "qwen3-vl-8b" = {
    name            = "Qwen3-VL 8B"
    hf_model_id     = "Qwen/Qwen3-VL-8B-Instruct-FP8"
    instance_type   = "ml.g6e.xlarge"
    max_model_len   = 32768
    vision          = true
    ocr             = true
    scaling         = "on_demand"   # on_demand | always_on | off | manual
    idle_minutes    = 30
    hourly_cost_usd = 2.61
    default         = true
  }
}
```

After `terraform apply`:

- A **new or changed** model gets a new SageMaker model and endpoint
  configuration; the api restarts with the new `LLM_MODELS` and syncs it into
  the database. A model that is running keeps its old configuration until it
  is next started (or `./scripts/gpu.sh stop <model>` now).
- A **removed** model disappears from `LLM_MODELS`. If its endpoint was running,
  delete it: `./scripts/gpu.sh status` lists endpoints no model owns.

Things to know:

- **Any vLLM-supported model** on Hugging Face works, if it fits the GPU. FP8
  or AWQ variants of 7–14B models fit a 24–48 GB GPU.
- **Gated models** (you had to accept a license on the model page): set
  `hf_token` (read-only token), preferably as `TF_VAR_hf_token=hf_... terraform apply`.
  The token is visible in the SageMaker console.
- **Faster, internet-free cold starts**: copy the weights to S3 once with
  `./scripts/stage-weights.sh <hf-model-id> s3://<bucket>/<prefix>/` and set
  `weights_s3_uri`.
- **Other providers** (OpenAI, a vLLM or Ollama server elsewhere) go into
  `extra_llm_models` and appear next to the SageMaker models.
- Models added by hand in `/admin/` are left alone by the sync.

## 11. Your own domain

With a Route 53 hosted zone for the domain in the same account:

```hcl
domain_name     = "chat.example.com"
route53_zone_id = "Z0123456789ABCDEFGHIJ"
```

`terraform apply` requests a free certificate (in us-east-1, as CloudFront
requires), validates it through DNS, attaches it to CloudFront and points the
domain at it. `app_url` becomes `https://chat.example.com`, and Django then
only accepts that host. Update the Google client's JavaScript origins.

DNS elsewhere (Cloudflare, your registrar)? Delegate a subdomain to Route 53:
create a hosted zone for `chat.example.com`, and add its four NS records at
your DNS provider.

## 12. Updating the app

```bash
git pull
./scripts/deploy.sh
```

A new tag is built and rolled out with no downtime when two or more tasks run
(`api_desired_count = 2`); with one task there is a short gap while the new
one becomes healthy. A deployment whose new tasks keep failing is rolled back
automatically (ECS deployment circuit breaker).

Changed only `terraform.tfvars`? Just `terraform apply`: the deployed image
tag is remembered in `image.auto.tfvars`.

## 13. Deploy from GitHub Actions

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) builds the
images on GitHub's ARM runners and deploys them. It uses **OIDC**: GitHub gets
short-lived AWS credentials for one role; no AWS keys are stored in GitHub.

1. In `terraform.tfvars`:

   ```hcl
   enable_github_oidc = true
   github_repository  = "your-name/private-llm-chat-sagemaker-aws"
   # create_github_oidc_provider = false   # if your account already has token.actions.githubusercontent.com
   ```

   `terraform apply`, then note `terraform output github_deploy_role_arn`.

2. GitHub → your repository → **Settings → Secrets and variables → Actions**:
   - Secret `AWS_DEPLOY_ROLE_ARN` = the role ARN
   - Variable `AWS_REGION` = your region
   - Variable `DEPLOY_ENABLED` = `true` (deploy on every push to `main`;
     without it the workflow only runs when started by hand)

3. **Images only (default).** Each run pushes images tagged with the commit
   and tells you how to roll them out:
   `IMAGE_TAG=<tag> ./scripts/deploy.sh --skip-build`.

4. **Full deployment (optional).** To let CI run `terraform apply` itself:
   - move the state to S3: `./scripts/bootstrap-state.sh`, then follow what it prints;
   - variable `TF_STATE_BUCKET` = the bucket name (optionally `TF_STATE_KEY`);
   - secret `TFVARS_B64` = `base64 < infra/terraform/terraform.tfvars`
     (update it whenever you change the file);
   - `github_terraform_apply = true` in `terraform.tfvars`, and apply.

   This gives the role near-admin rights (it must be able to change every
   resource in the stack, IAM roles included). Anyone who can push to `main`
   can then change your AWS infrastructure: protect the branch.

   From then on CI is the deployer. A local `terraform apply` would use the
   tag in your `infra/terraform/image.auto.tfvars`, which may be older than
   what CI deployed, and roll the containers back. Delete that file and pass
   the current tag explicitly if you must apply locally:
   `terraform apply -var image_tag=$(git rev-parse --short=12 origin/main)`.

The role only trusts runs on `main` of that one repository
(`github_oidc_subjects`). If you changed `project` or `environment`, set the
variable `NAME_PREFIX` to `<project>-<environment>`.

## 14. Day-to-day operations

| Task | Command |
|---|---|
| App URL and all outputs | `terraform -chdir=infra/terraform output` |
| API logs (live) | `aws logs tail /ecs/llmchat-dev/api --follow` |
| GPU controller logs | `aws logs tail /ecs/llmchat-dev/gpu-controller --follow` |
| Model (SageMaker) logs | `aws logs tail /aws/sagemaker/Endpoints/llmchat-dev-<model> --follow` |
| What GPUs run, and cost | `./scripts/gpu.sh status` |
| Stop all GPUs now | `./scripts/gpu.sh stop` |
| Shell in the api container | see step 6 (ECS Exec) |
| Service events | `aws ecs describe-services --cluster llmchat-dev --services api --query 'services[0].events[:5]'` |

Keep an eye on cost in **Billing → Cost Explorer**. Activate the `Project` tag
under **Billing → Cost allocation tags** to filter on this stack.

## 15. Tearing everything down

**Order matters.** The GPU endpoints are created by the app's GPU controller,
not by Terraform, so `terraform destroy` does not know about them. Stop the
controller first (otherwise it may start an `always_on` model again), then
delete the endpoints, then destroy:

```bash
# 1. Stop the GPU controller, so nothing starts a GPU any more.
aws ecs update-service --cluster llmchat-dev --service gpu-controller --desired-count 0 >/dev/null

# 2. Delete every running endpoint of this stack, and check.
./scripts/gpu.sh stop
./scripts/gpu.sh status          # repeat until nothing runs and no "Other endpoints" are listed

# 3. Delete everything else (10-20 minutes; CloudFront is slow to delete).
terraform -chdir=infra/terraform destroy

# 4. Double-check that no endpoint survived (should print nothing):
aws sagemaker list-endpoints --name-contains llmchat-dev --query 'Endpoints[].EndpointName' --output text
```

Left behind on purpose:

- The Terraform **state bucket**, if you created one with `bootstrap-state.sh`
  (delete it in the S3 console once you no longer need the state).
- A **weights bucket** from `stage-weights.sh`.
- With `environment = "prod"`: destroy is blocked by deletion protection and
  by non-empty buckets/repositories. That is the point of `prod`; disable them
  deliberately if you really mean it.

## 16. Troubleshooting

The most common problems (GPU quota, gated models, out-of-memory, 403 from the
load balancer, emails not arriving, `exec format error`...) are in the table
[Things that will break, and why](../infra/terraform/README.md#things-that-will-break-and-why).

First places to look:

1. `./scripts/gpu.sh status`: is the endpoint there, and in which state?
2. The endpoint log group `/aws/sagemaker/Endpoints/<endpoint>`: vLLM prints
   exactly why a model did not load.
3. `/ecs/<name>/gpu-controller`: why the controller did (not) start something.
4. `/ecs/<name>/api`: errors behind a failed request, and console-mode emails.
