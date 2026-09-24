# vLLM router: several models on one GPU (advanced)

The beginner path (`ml/sagemaker/deploy.py`, or Terraform with `container = "dlc"`)
runs **one model per SageMaker endpoint** using AWS's ready-made vLLM container.
Nothing to build, and it's the right place to start.

This folder is the next step: **your own container** that runs **several models on
the same GPU** behind one endpoint. For example, a vision model and a fast text model
share one `ml.g6e.xlarge` (48 GB) instead of paying for two GPUs.

```
SageMaker endpoint (1 GPU)
└── this container (:8080)            /ping, /invocations
    ├── vllm serve model A  (:8001)   55% of GPU memory
    └── vllm serve model B  (:8002)   35% of GPU memory
```

## Configure

`MODELS_JSON` is a list of models (see the docstring in [`server.py`](server.py)):

```json
[
  {"name": "Qwen/Qwen3-VL-8B-Instruct-FP8", "gpu_fraction": 0.55,
   "args": ["--max-model-len", "16384", "--limit-mm-per-prompt", "{\"image\": 4}"]},
  {"name": "Qwen/Qwen3-4B", "gpu_fraction": 0.35, "args": ["--max-model-len", "16384"]}
]
```

The app then needs **one `LLM_MODELS` entry per model**, all with the same
`endpoint_name` and different `model_id`s. The router picks the model by the
request's `"model"` field.

## Build and push

The image is ~10 GB (CUDA + PyTorch + vLLM), so build it in CI rather than from a
laptop: run the **Build vLLM router** GitHub workflow
(`.github/workflows/build-vllm-router.yml`), which frees disk space on the runner and
pushes to your ECR repository. You can also build it by hand:

```bash
docker build --platform linux/amd64 -t vllm-router ml/vllm-router
```

## Deploy

In `infra/terraform/terraform.tfvars` set `enable_vllm_router_repo = true`, then give
the model `container = "router"` and pass `MODELS_JSON` through `extra_env`. See
[docs/models.md](../../docs/models.md).

## Test locally (needs an NVIDIA GPU)

```bash
docker run --gpus all -p 8080:8080 \
  -e MODELS_JSON='[{"name":"Qwen/Qwen3-0.6B","gpu_fraction":0.8}]' vllm-router
curl localhost:8080/ping
curl localhost:8080/invocations -H 'content-type: application/json' \
  -d '{"model":"Qwen/Qwen3-0.6B","messages":[{"role":"user","content":"Hi"}]}'
```
