# Documentation

## Guides: follow them in order

1. [Run the app on your laptop](01-quickstart-local.md): 5 minutes, no GPU, mock model
2. [Run a real model locally](02-run-a-real-model-locally.md): Ollama, free
3. [Deploy a model to your own SageMaker GPU](03-deploy-a-model-on-sagemaker.md): the local app uses it
4. [Deploy the whole app on AWS](04-deploy-the-full-stack-on-aws.md): Terraform, HTTPS URL, GPU on demand
5. [Advanced topics](05-advanced.md): scale to zero, weights in S3, no-internet VPC, several models per GPU, big models, CI/CD

## Reference

- [Architecture](architecture.md): components, request flow, design decisions
- [Models](models.md): presets, GPU sizing, adding any Hugging Face model
- [Authentication](authentication.md): email, Google sign-in, 2FA, admins
- [Configuration](configuration.md): every environment variable
- [REST API](api.md): endpoints, objects, the streaming protocol
- [Cost](cost.md): what you pay for, and how to keep it low
- [Troubleshooting](troubleshooting.md)
- [Roadmap](roadmap.md)
