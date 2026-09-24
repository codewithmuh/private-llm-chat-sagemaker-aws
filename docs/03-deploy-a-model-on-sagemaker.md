# 3. Deploy a model to your own SageMaker GPU

**Goal:** a real open-source LLM on a GPU in **your** AWS account, private to you, and
the local app chatting with it.

> 💸 **This costs money.** An `ml.g6e.xlarge` is about **$2.61 per hour while it
> exists** (us-east-1), whether you use it or not. Finish this guide with `make model-stop` and
> check with `make model-presets` / the SageMaker console that nothing is left running.

## How SageMaker hosting works (3 objects)

```
Model                   WHAT to run: container image + settings (which LLM)
  └── EndpointConfig    ON WHAT: instance type (GPU) and count
        └── Endpoint    the running server you call and pay for per hour
```

We use **AWS's own vLLM container** (a "Deep Learning Container"). SageMaker pulls it
from AWS's registry, and the container downloads the model from Hugging Face when it
starts. **Nothing to build.**

`ml/sagemaker/deploy.py` makes these three API calls. Read it: it's short and
commented, and it's all there is to it.

## Before you start

1. **AWS CLI v2 configured**: `aws sts get-caller-identity` should print your account.
   Use a profile (`export AWS_PROFILE=...`) or `aws configure sso`.
2. **Python 3.10+ with boto3**: `pip install boto3`.
3. **GPU quota.** New AWS accounts usually have **0** GPU instances for SageMaker
   endpoints. Request some *before* deploying:
   - Open **Service Quotas → AWS services → Amazon SageMaker**.
   - Search for **`ml.g6e.xlarge for endpoint usage`** (or the instance of the preset
     you want) and request **1**.
   - Approval takes minutes to a couple of days. Check the region! Quotas are per region.
4. **(Gated models only)** A Hugging Face account, the model's licence accepted on its
   page, and a read token (https://huggingface.co/settings/tokens).

## Pick a model

```bash
make model-presets
```

```
preset                         instance            $/h  vision gated  model
qwen3-vl-8b                    ml.g6e.xlarge       2.61  yes           Qwen/Qwen3-VL-8B-Instruct-FP8
qwen3-vl-4b                    ml.g6.xlarge        1.13  yes           Qwen/Qwen3-VL-4B-Instruct
qwen3-8b                       ml.g6.xlarge        1.13                Qwen/Qwen3-8B-FP8
llama-3.1-8b                   ml.g5.xlarge        1.41         yes    meta-llama/Llama-3.1-8B-Instruct
...
```

Start with **`qwen3-vl-8b`**: chat + vision + OCR in one model. The details for every
preset are in [models.md](models.md).

## Deploy

```bash
make model-deploy PRESET=qwen3-vl-8b
# = python ml/sagemaker/deploy.py deploy qwen3-vl-8b
```

```
1/3  Model                  llmchat-qwen3-vl-8b-20260924-101500
2/3  Endpoint configuration llmchat-qwen3-vl-8b-20260924-101500
     ml.g6e.xlarge (1x NVIDIA L40S, 48 GB), ~$2.61/hour while running
3/3  Endpoint               llmchat-qwen3-vl-8b

Waiting for the endpoint (weights download + model load: usually 8-15 minutes) ...
  [ 0 min] Creating
  [11 min] InService
Ready.
```

While you wait: the container logs are in **CloudWatch → Log groups →
`/aws/sagemaker/Endpoints/llmchat-qwen3-vl-8b`**. You'll see vLLM download the weights,
load them on the GPU and start serving.

## Talk to it from the terminal

```bash
make model-chat PRESET=qwen3-vl-8b
python ml/sagemaker/deploy.py chat llmchat-qwen3-vl-8b "What's in this picture?" --image photo.jpg
```

This is the exact call the backend makes: `invoke_endpoint_with_response_stream` with
an OpenAI-style chat body. The answer streams back in pieces.

## Use it from the app

1. Create your model list from the example:

   ```bash
   cp config/models.sagemaker.example.json config/models.sagemaker.json
   # edit endpoint_name / region if you changed them
   ```

2. In `.env`: `LLM_MODELS_FILE=models.sagemaker.json`, plus `AWS_PROFILE` and
   `AWS_REGION`.

3. Start the app with AWS access (your `~/.aws` is mounted read-only into the api
   container):

   ```bash
   make up-aws
   ```

Now the model picker shows **Qwen3-VL 8B (SageMaker)**. Every message goes: browser →
local Django → `sagemaker-runtime` API → your GPU → streamed back.

> Using AWS SSO? Run `aws sso login` on your machine first; the container reuses the
> cached login.

## Stop paying

```bash
make model-stop PRESET=qwen3-vl-8b     # deletes the endpoint only: billing stops
make model-start PRESET=qwen3-vl-8b    # brings it back later (~10 min)
make model-delete PRESET=qwen3-vl-8b   # removes endpoint, config and model
```

Stopping keeps the model and configuration (free), so starting again needs no
settings. Want this to happen automatically? The full-stack deployment has a **GPU
controller** that starts the endpoint when someone sends a message and deletes it after
30 idle minutes. You can run it locally too: set `"scaling": "on_demand"` and an
`endpoint_config_name` in your model file, and `make up-aws` starts the controller.

## When it goes wrong

| Symptom | Cause |
|---|---|
| `ResourceLimitExceeded` | No GPU quota for that instance type in this region. See "Before you start" |
| Endpoint `Failed` after ~30 min, logs show `401` / `gated repo` | Gated model without `--hf-token`, or you didn't accept the licence on Hugging Face |
| Logs show `CUDA out of memory` | Model too big for that GPU, or `max_model_len` too high. Use `--max-model-len 8192` or a bigger instance |
| `AccessDenied ... sagemaker:InvokeEndpoint` in the app | Your AWS profile can't invoke endpoints; or the container can't see `~/.aws` |
| App says "model is starting" forever | Endpoint not `InService`: `python ml/sagemaker/deploy.py status llmchat-...` |

More in [troubleshooting.md](troubleshooting.md).

## Next

[4. Deploy the whole app on AWS →](04-deploy-the-full-stack-on-aws.md)
