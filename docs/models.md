# Choosing and adding models

## Presets that are ready to go

All run on AWS's vLLM container for SageMaker (`vllm:0.30-...-sagemaker`) and are
defined in [`ml/models/catalog.json`](../ml/models/catalog.json).

| Preset | Model | Instance (GPU) | ~$/hour | Vision / OCR | Notes |
|---|---|---|---|---|---|
| `qwen3-vl-8b` ⭐ | Qwen/Qwen3-VL-8B-Instruct-FP8 | ml.g6e.xlarge (L40S 48 GB) | 2.2 | ✅ | The default. Chat, photos, screenshots, scans, charts |
| `qwen3-vl-4b` | Qwen/Qwen3-VL-4B-Instruct | ml.g6.xlarge (L4 24 GB) | 1.0 | ✅ | Cheapest vision model |
| `qwen3-8b` | Qwen/Qwen3-8B-FP8 | ml.g6.xlarge (L4 24 GB) | 1.0 | | Text; shows its reasoning |
| `llama-3.1-8b` | meta-llama/Llama-3.1-8B-Instruct | ml.g5.xlarge (A10G 24 GB) | 1.41 | | Gated |
| `deepseek-r1-distill-qwen-7b` | deepseek-ai/DeepSeek-R1-Distill-Qwen-7B | ml.g5.xlarge (A10G 24 GB) | 1.41 | | Reasoning |
| `gemma-3-12b` | google/gemma-3-12b-it | ml.g6e.xlarge (L40S 48 GB) | 2.2 | ✅ | Gated |
| `qwen3-32b` | Qwen/Qwen3-32B-FP8 | ml.g6e.2xlarge (L40S 48 GB) | 2.7 | | Much stronger text model |
| `llama-3.3-70b` | meta-llama/Llama-3.3-70B-Instruct | ml.g6e.12xlarge (4× L40S) | 13.1 | | 4-GPU tensor parallelism. Gated. Expensive |

Prices are approximate us-east-1 on-demand rates; check the
[SageMaker pricing page](https://aws.amazon.com/sagemaker/pricing/) for your region.
"Gated" means you must accept the licence on Hugging Face and deploy with a token.

## Will this model fit on that GPU?

A rough rule for the GPU memory a model needs:

```
weights  = parameters × bytes per parameter
           bf16/fp16: 2 bytes   FP8: 1 byte   4-bit (AWQ/GPTQ): ~0.5 byte
KV cache = what's left; more cache = longer context and more users at once
```

| Model | bf16 weights | FP8 weights | Fits on |
|---|---|---|---|
| 3–4B | 6–8 GB | 3–4 GB | anything (L4 24 GB) |
| 7–8B | 14–16 GB | 7–8 GB | L4 / A10G 24 GB (short context); L40S 48 GB comfortably |
| 12–14B | 24–28 GB | 12–14 GB | L40S 48 GB |
| 32B | 64 GB | 32 GB | L40S 48 GB with FP8; otherwise 2+ GPUs |
| 70B | 140 GB | 70 GB | 4× L40S (ml.g6e.12xlarge) or 8× A100 |

vLLM takes `gpu_memory_utilization` (we use 0.90) of the GPU, loads the weights, and
uses the rest for the KV cache. If the logs say the KV cache can't hold
`max_model_len` tokens, lower `max_model_len` or pick a bigger GPU.

GPU generations: **A10G** (g5, Ampere), **L4** (g6, Ada, cheap, supports FP8),
**L40S** (g6e, Ada, 48 GB, the sweet spot for 7–32B models), **H100** (p5, expensive).

## Add any Hugging Face model

vLLM supports most popular architectures
([list](https://docs.vllm.ai/en/latest/models/supported_models.html)).

**With the script:** add an entry to `ml/models/catalog.json` (copy an existing one),
then `python ml/sagemaker/deploy.py deploy <your-key>`.

**With Terraform:** add it to `models` in `infra/terraform/terraform.tfvars`:

```hcl
models = {
  "mistral-small" = {
    name          = "Mistral Small 3.2 24B"
    hf_model_id   = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    instance_type = "ml.g6e.2xlarge"
    max_model_len = 16384
    vision        = true
    scaling       = "on_demand"
  }
}
```

then `terraform apply`. The model appears in the app's picker. Its endpoint starts the
first time someone chats with it.

**Extra vLLM flags** go in `extra_env` as `SM_VLLM_<FLAG_NAME>`, which the container
turns into `--flag-name`. For example:

| Need | Variable |
|---|---|
| Show reasoning separately (Qwen3, DeepSeek-R1) | `SM_VLLM_REASONING_PARSER = "qwen3"` / `"deepseek_r1"` |
| Tool calling | `SM_VLLM_ENABLE_AUTO_TOOL_CHOICE`, `SM_VLLM_TOOL_CALL_PARSER` |
| Quantized weights | `SM_VLLM_QUANTIZATION = "awq"` |
| Split across GPUs | `tensor_parallel_size = 4` (on a 4-GPU instance) |

## Models that aren't on SageMaker

The app talks to anything with an OpenAI-compatible API: `provider: "openai"` with a
`base_url`. See [configuration.md](configuration.md#llm_models-entries).

- **Ollama / LM Studio** on your machine: [guide 2](02-run-a-real-model-locally.md).
- **Your own vLLM** on an EC2 GPU or on-prem: `base_url: "http://your-box:8000/v1"`.
- **OpenAI / other hosted APIs**: `base_url: "https://api.openai.com/v1"`, `api_key`.
  (The data then leaves your account, which defeats the point, but it's handy for
  comparing quality.)

With Terraform, add those in `extra_llm_models` and they're merged into the list.

## Changing models later

- **Terraform-managed models**: change `terraform.tfvars`, `terraform apply`. A new
  endpoint configuration is created; the controller swaps the running endpoint to it
  once the model has been idle for 5 minutes (delete, then create, because blue/green
  updates need quota for two instances).
- **Admin**: `/admin/` → LLM models. Change scaling mode, enable/disable, set the
  default, or add an OpenAI-compatible model by hand. Models defined in `LLM_MODELS` are
  overwritten from it on every restart. Change those at the source.
