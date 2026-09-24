# Model presets for local development

`docker compose` mounts this folder into the api container and loads the file named by
`LLM_MODELS_FILE` (set it in `.env`):

| File | Use it when |
|---|---|
| `models.mock.json` (default) | First run. No GPU, no downloads: a fake model that streams canned answers |
| `models.ollama.json` | You run real models locally with Ollama (`make ollama`) |
| `models.sagemaker.example.json` | You deployed a model to SageMaker and want the local app to use it. Copy it to `models.sagemaker.json`, fix `endpoint_name`/`region`, and use `make up-aws` |

Each entry is documented in [docs/configuration.md](../docs/configuration.md#llm_models-entries).
After editing a file, restart the api: `docker compose restart api` (it re-syncs models on start).
