# What it costs

Two parts: a **baseline** that runs all month whether anyone chats or not, and
the **GPU**, billed by the hour only while a SageMaker endpoint exists.

Prices are approximate **us-east-1 on-demand** list prices in USD, taken from
the AWS public price list in September 2026. They differ by region and change
over time: check the [SageMaker pricing page](https://aws.amazon.com/sagemaker/ai/pricing/)
(tab "Real-Time Inference") and the
[AWS Pricing Calculator](https://calculator.aws/) for your region. A month is
730 hours. Taxes, support plans and credits are not included.

## Baseline (always on)

With the defaults (`enable_nat_gateway = false`, one task per service):

| Item | Sizing | Rate | ≈ per month |
|---|---|---|---|
| Application Load Balancer | 1 ALB, light traffic | $0.0225/hour + $0.008 per LCU-hour | $17–20 |
| Fargate `api` (ARM64) | 0.5 vCPU, 1 GB | $0.03238 per vCPU-hour + $0.00356 per GB-hour | $14.40 |
| Fargate `web` (ARM64) | 0.25 vCPU, 0.5 GB | same | $7.20 |
| Fargate `gpu-controller` (ARM64) | 0.25 vCPU, 0.5 GB | same | $7.20 |
| Public IPv4 addresses | 2 for the ALB + 1 per task (3) | $0.005 per address-hour | $18.25 |
| RDS PostgreSQL `db.t4g.micro` | single-AZ, 20 GB gp3, 7-day backups | $0.016/hour + $0.115 per GB-month | $14 |
| Secrets Manager | 2 secrets | $0.40 per secret-month | $0.80 |
| CloudWatch Logs | a few hundred MB/month | $0.50 per GB ingested | $1–3 |
| ECR image storage | up to 20 images per repository | $0.10 per GB-month | $1–2 |
| S3 uploads | a few GB | $0.023 per GB-month | < $1 |
| CloudFront | first 1 TB out and 10 M requests/month are free | | $0 for most users |
| **Total** | | | **≈ $80–90** |

Options that add to it:

| Option | ≈ per month | Why you might want it |
|---|---|---|
| `enable_nat_gateway = true` | +$33 NAT (+ $0.045 per GB through it), +$3.65 its IP, −$11 task IPs | Tasks in private subnets without public IPs |
| `db_multi_az = true` | +$14 | A standby database in a second AZ |
| `api_desired_count = 2` | +$14.40 (+$3.65 IP) | Zero-downtime deploys, survives an AZ failure |
| Custom domain | +$0.50 | Route 53 hosted zone |
| SES email | $0.10 per 1,000 emails | Real verification emails |
| Container Insights (off by default) | a few $ | Per-task CPU/memory dashboards |

Why the baseline is not lower: the ALB and RDS bill every hour they exist, and
AWS charges for every public IPv4 address since 2024. Turning the stack off
means `terraform destroy` (the data in RDS and S3 goes with it, unless you
snapshot it first).

## GPU prices

SageMaker real-time inference, per instance-hour (us-east-1, on-demand).
"Always on" is × 730 hours.

| Instance | GPU | GPU memory | $/hour | Always on, $/month | Fits (roughly) |
|---|---|---|---|---|---|
| `ml.g6.xlarge` | 1× NVIDIA L4 | 24 GB | 1.13 | 822 | 7–8B in FP8/AWQ, moderate context |
| `ml.g5.xlarge` | 1× NVIDIA A10G | 24 GB | 1.41 | 1,028 | same, faster than L4 |
| `ml.g6e.xlarge` | 1× NVIDIA L40S | 48 GB | 2.61 | 1,902 | 8B FP8 with 32K+ context, 14B FP8, 8B vision **(default)** |
| `ml.g6e.2xlarge` | 1× NVIDIA L40S | 48 GB | 2.80 | 2,046 | as above, more CPU and RAM |
| `ml.g5.12xlarge` | 4× NVIDIA A10G | 96 GB | 7.09 | 5,176 | ~30B in FP8/AWQ (`tensor_parallel_size = 4`) |
| `ml.g6e.12xlarge` | 4× NVIDIA L40S | 192 GB | 13.12 | 9,575 | 70B in FP8 (`tensor_parallel_size = 4`) |
| `ml.p4d.24xlarge` | 8× NVIDIA A100 | 320 GB | 25.25 | 18,434 | 70B in BF16, or very high throughput |

A model needs its **weights** (≈ 1 GB per billion parameters in FP8, 2 GB in
BF16) plus **KV cache** for the context of every concurrent request, all
within `gpu_memory_utilization` of the GPU. If it does not fit, the endpoint
fails to start and the log says `CUDA out of memory` or
"No available memory for the cache blocks": lower `max_model_len` or pick a
bigger instance.

Put the price in `hourly_cost_usd` for each model: the admin shows it, and
`./scripts/gpu.sh status` uses it to show the current burn rate.

## on_demand vs always_on

SageMaker bills from the moment an endpoint's instance starts until it is
deleted, including the minutes it spends starting up. What you pay therefore
depends on **how many hours an endpoint exists**, not on how much you chat.

With `scaling = "on_demand"`, the GPU controller creates the endpoint at the
first message and deletes it `idle_minutes` after the last one. Each busy
period costs its length + `idle_minutes` + the cold start (≈ 10 minutes).

Examples for `ml.g6e.xlarge` at $2.61/hour, `idle_minutes = 30`:

| Usage pattern | GPU hours / month | on_demand | always_on |
|---|---|---|---|
| Trying it out: 10 sessions of 1 hour | 10 × 1.7 = 17 | **$44** | $1,902 |
| One person, 1 hour every day | 30 × 1.7 = 51 | **$133** | $1,902 |
| A team, 8 busy hours on 22 workdays | 22 × 8.7 = 191 | **$500** | $1,902 |
| In use around the clock | 730 | $1,902 | $1,902 |

The trade-off is waiting: after a quiet period, the first message waits for a
**5–15 minute** cold start. Ways to tune it:

- Shorter `idle_minutes` saves money, but more people hit a cold start.
- Staging weights in S3 (`scripts/stage-weights.sh`) shortens cold starts.
- `always_on` during working hours only: switch `scaling` in `/admin/` (or
  tfvars) in the morning and back in the evening.
- Smaller GPU: `ml.g6.xlarge` costs 43% of an `ml.g6e.xlarge` if your model fits.

And the one rule that matters most: **a forgotten GPU costs about $63 a day.**
`./scripts/gpu.sh status` shows what is running; a budget alert (see
[deploy-aws.md](deploy-aws.md#1-prerequisites)) catches the rest.
