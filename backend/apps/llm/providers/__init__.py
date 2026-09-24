"""Pick the right provider for a model row."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from .base import ChatRequest, Completion, Provider, ProviderError, Usage

if TYPE_CHECKING:
    from apps.llm.models import LLMModel

__all__ = ["ChatRequest", "Completion", "Provider", "ProviderError", "Usage", "provider_for"]


def resolve_secret(value: str) -> str:
    """`env:NAME` means "read environment variable NAME".

    Lets LLM_MODELS (which ends up in plain text in an ECS task definition)
    point at a secret that ECS injects from Secrets Manager, instead of
    containing the key itself.
    """
    if value.startswith("env:"):
        return os.environ.get(value[4:], "")
    return value


def provider_for(model: LLMModel) -> Provider:
    if model.provider == "sagemaker":
        from .sagemaker import SageMakerProvider

        return SageMakerProvider(model.endpoint_name, model.model_id, model.region or None)
    if model.provider == "openai":
        from .openai_compat import OpenAICompatibleProvider

        return OpenAICompatibleProvider(model.base_url, model.model_id, resolve_secret(model.api_key))
    if model.provider == "mock":
        from django.conf import settings

        from .mock import MockProvider

        return MockProvider(delay_seconds=settings.MOCK_LLM_DELAY)
    raise ProviderError(f"Unknown provider {model.provider!r}", "model_unavailable")
