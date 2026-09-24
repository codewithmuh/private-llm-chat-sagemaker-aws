# 5. Advanced topics

You have the app on AWS with a model on SageMaker. These are the next levels, roughly
in the order people need them.

## Save money: scale to zero

Every SageMaker model has a `scaling` mode, handled by the GPU controller
(`backend/apps/llm/controller.py`, running as the `gpu-controller` ECS service):

| Mode | Behaviour | Monthly cost of an ml.g6e.xlarge (~$2.2/h) |
|---|---|---|
| `always_on` | Always running; answers in seconds | ~$1,600 |
| `on_demand` | Created on the first message, deleted after `idle_minutes` (default 30) | Only the hours used. 2 h/day ≈ $135 |
| `off` | Kept deleted | $0 |

With `on_demand`, the first message after a quiet period waits for a **cold start**
(5–15 min: the instance boots, the weights download, vLLM loads them). The UI shows
"waking up" and polls until ready. To make cold starts faster, stage the weights in S3
(below).

Change the mode in `terraform.tfvars` (`scaling = "..."`), or live in `/admin/` → LLM
models.

## Faster cold starts and no internet: weights in S3

By default the vLLM container downloads the model from Hugging Face every time the
endpoint starts. Instead, copy the weights to your own S3 bucket once:

```bash
./scripts/stage-weights.sh Qwen/Qwen3-VL-8B-Instruct-FP8 s3://<your-models-bucket>/qwen3-vl-8b/
```

and set `weights_s3_uri` for that model in `terraform.tfvars`. SageMaker then copies the
weights from S3 (in-region, fast) to `/opt/ml/model` and vLLM loads them from disk.

Add `sagemaker_vpc_isolated = true` to also put the endpoint inside your VPC with **no
internet access at all**: it reaches S3 through a VPC gateway endpoint only. This is
the setup for regulated data: the model provably can't send anything anywhere.

## Several models on one GPU

A 48 GB L40S is mostly empty with one 8B model on it. `ml/vllm-router` runs several
`vllm serve` processes on the same GPU behind one endpoint, e.g. a vision model and a
fast text model for the price of one instance. See
[ml/vllm-router/README.md](../ml/vllm-router/README.md).

## More users: scaling out

- **More concurrent answers per model:** vLLM batches requests continuously, so one GPU
  serves many users at once. Watch `ConcurrentRequestsPerModel` / `ModelLatency` in
  CloudWatch before adding instances.
- **More instances:** raise `instance_count` for the model, or add SageMaker endpoint
  auto scaling (Application Auto Scaling on the variant's
  `SageMakerVariantInvocationsPerInstance`). Note: `on_demand` deletes and recreates the
  endpoint, so combine auto scaling with `always_on`.
- **More API capacity:** each api task streams 32 answers at once (2 gunicorn workers ×
  16 threads). Raise the ECS service's `desired_count`; the ALB spreads load.

## Bigger models

- **FP8** weights (`...-FP8` repos) halve memory with little quality loss on Ada/Hopper
  GPUs (L4, L40S, H100).
- **Tensor parallelism** splits a model across the GPUs of one instance:
  `tensor_parallel_size = 4` on `ml.g6e.12xlarge` (4× L40S) runs 70B models.
- **Quantized** (AWQ/GPTQ, ~4-bit) weights fit 70B on a single 48 GB GPU, with more
  quality loss; set `SM_VLLM_QUANTIZATION`.

## Custom domain

Set `domain_name` and `route53_zone_id` in `terraform.tfvars`. Terraform requests a
certificate in us-east-1 (CloudFront's requirement), validates it through DNS and points
the domain at CloudFront. Remember to add the new origin to your Google OAuth client.

## CI/CD

`.github/workflows/deploy.yml` builds the api and web images on GitHub's ARM runners,
pushes them to ECR (authenticating with OIDC: no AWS keys in GitHub) and runs
`terraform apply` with the new image tag when remote state is configured. Setup steps
are in [04-deploy-the-full-stack-on-aws.md](04-deploy-the-full-stack-on-aws.md).

## Ideas to build next

The [roadmap](roadmap.md) lists features that fit this architecture, with pointers to
where they'd go: RAG over your documents with pgvector, tool calling, voice, team
workspaces, usage quotas, Bedrock as a provider...
