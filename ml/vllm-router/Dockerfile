# syntax=docker/dockerfile:1.7
#
# Multi-model vLLM router for SageMaker (advanced; see README.md here).
# Always linux/amd64: NVIDIA's CUDA images have no ARM build.
#
#   docker build --platform linux/amd64 -t vllm-router ml/vllm-router
#
# Pin the vLLM version for reproducible deploys, e.g.
#   --build-arg VLLM_IMAGE=vllm/vllm-openai:v0.30.0
ARG VLLM_IMAGE=vllm/vllm-openai:latest
FROM ${VLLM_IMAGE}

WORKDIR /app
# The vLLM image already ships FastAPI, uvicorn and httpx (its own server uses
# them), so nothing is installed here: no version clash with vLLM's pins.
COPY server.py entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh

# SageMaker copies S3 model data to /opt/ml/model. Caches go to /tmp, the
# only writable place on a SageMaker instance besides /opt/ml.
ENV MODEL_DIR=/opt/ml/model \
    HF_HOME=/tmp/hf \
    XDG_CACHE_HOME=/tmp/cache \
    VLLM_CACHE_ROOT=/tmp/vllm \
    PYTHONUNBUFFERED=1

EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
