"""Model lookups and the "is this model ready?" check done before each chat."""

from __future__ import annotations

import json
import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.common.errors import ApiError

from .controller import NOT_FOUND, UNKNOWN, GpuController
from .models import LLMModel

log = logging.getLogger(__name__)

# How old the controller's last observation may be before the API checks the
# endpoint itself (e.g. no controller is running, as in local development
# against a manually created endpoint).
STATUS_STALE_AFTER = timedelta(minutes=2)


def get_model(slug: str | None, user=None) -> LLMModel:
    if slug:
        model = LLMModel.objects.filter(slug=slug, enabled=True).first()
        if model is None:
            raise ApiError(
                "That model is not available.",
                code="unknown_model",
                status_code=400,
                fields={"model": "Unknown model."},
            )
        return model
    model = LLMModel.default_for(user)
    if model is None:
        raise ApiError(
            "No models are configured yet. Add one with LLM_MODELS or in /admin/.",
            code="no_models",
            status_code=503,
        )
    return model


def refresh_status_if_stale(model: LLMModel) -> None:
    if not model.is_sagemaker or not model.endpoint_name:
        return
    checked = model.status_checked_at
    if checked and timezone.now() - checked < STATUS_STALE_AFTER:
        return
    status, _config, _failure = GpuController().describe(model)
    model.endpoint_status = status
    model.status_checked_at = timezone.now()
    LLMModel.objects.filter(pk=model.pk).update(endpoint_status=status, status_checked_at=model.status_checked_at)


def request_wake(model: LLMModel) -> None:
    now = timezone.now()
    LLMModel.objects.filter(pk=model.pk).update(wake_requested_at=now, last_used_at=now)
    model.wake_requested_at = now
    model.last_used_at = now


def ensure_ready(model: LLMModel) -> None:
    """Raise a 503 the UI understands if the model's GPU is not up.

    Non-SageMaker models are always "ready": if the server is down, the call
    itself fails with a clear message.
    """
    model.touch()
    if not model.is_sagemaker:
        return
    refresh_status_if_stale(model)
    status = model.endpoint_status
    if status == "InService" or status in ("", UNKNOWN):
        return  # ready, or unknown: just try
    if model.scaling == LLMModel.Scaling.MANUAL:
        if status == NOT_FOUND:
            raise ApiError(
                "This model's SageMaker endpoint does not exist. Deploy it first (see docs).",
                code="model_unavailable",
                status_code=503,
            )
        return
    if model.scaling == LLMModel.Scaling.OFF:
        raise ApiError("This model is switched off by an administrator.", code="model_unavailable", status_code=503)
    if model.scaling == LLMModel.Scaling.ON_DEMAND:
        request_wake(model)
    _, detail = model.public_status()
    raise ApiError(
        detail or "The model is starting. Try again in a few minutes.",
        code="model_starting",
        status_code=503,
        extra={"retry_after": 60},
    )


# ------------------------------------------------------------------ syncing --

_FIELDS = {
    # json key          -> (model field, default)
    "name": ("name", None),
    "description": ("description", ""),
    "provider": ("provider", None),
    "model_id": ("model_id", ""),
    "base_url": ("base_url", ""),
    "api_key": ("api_key", ""),
    "endpoint_name": ("endpoint_name", ""),
    "endpoint_config_name": ("endpoint_config_name", ""),
    "region": ("region", ""),
    "scaling": ("scaling", LLMModel.Scaling.MANUAL),
    "idle_minutes": ("idle_minutes", 30),
    "hourly_cost_usd": ("hourly_cost_usd", None),
    "vision": ("vision", False),
    "ocr": ("ocr", False),
    "context_window": ("context_window", 8192),
    "max_output_tokens": ("max_output_tokens", 2048),
    "temperature": ("temperature", 0.7),
    "default": ("is_default", False),
    "sort": ("sort", 100),
    "enabled": ("enabled", True),
}


def parse_models_config(raw: str | list) -> list[dict]:
    entries = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(entries, list):
        raise ValueError("LLM_MODELS must be a JSON list")
    cleaned = []
    seen = set()
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict) or not entry.get("id"):
            raise ValueError(f"LLM_MODELS[{i}] needs an 'id'")
        slug = str(entry["id"])
        if slug in seen:
            raise ValueError(f"LLM_MODELS has two models with id {slug!r}")
        seen.add(slug)
        provider = entry.get("provider")
        if provider not in LLMModel.Provider.values:
            raise ValueError(f"LLM_MODELS[{slug}]: provider must be one of {LLMModel.Provider.values}")
        if provider == "openai" and not entry.get("base_url"):
            raise ValueError(f"LLM_MODELS[{slug}]: an 'openai' provider needs 'base_url'")
        if provider == "sagemaker" and not entry.get("endpoint_name"):
            raise ValueError(f"LLM_MODELS[{slug}]: a 'sagemaker' provider needs 'endpoint_name'")
        if entry.get("scaling", "manual") not in LLMModel.Scaling.values:
            raise ValueError(f"LLM_MODELS[{slug}]: scaling must be one of {LLMModel.Scaling.values}")
        cleaned.append(entry)
    return cleaned


@transaction.atomic
def sync_models(raw: str | list | None = None) -> dict[str, list[str]]:
    """Make the database match LLM_MODELS.

    Models from LLM_MODELS are created or updated. Env-managed models that
    disappeared from the list are disabled (not deleted: old conversations
    still name them). Models created in /admin/ are left alone.
    """
    entries = parse_models_config(settings.LLM_MODELS if raw is None else raw)
    result = {"created": [], "updated": [], "disabled": []}
    for entry in entries:
        defaults = {"managed_by_env": True}
        for key, (field, default) in _FIELDS.items():
            if key in entry:
                defaults[field] = entry[key]
            elif default is not None:
                defaults[field] = default
        defaults.setdefault("name", entry["id"])
        _, created = LLMModel.objects.update_or_create(slug=entry["id"], defaults=defaults)
        result["created" if created else "updated"].append(entry["id"])

    listed = {e["id"] for e in entries}
    stale = LLMModel.objects.filter(managed_by_env=True, enabled=True).exclude(slug__in=listed)
    result["disabled"] = list(stale.values_list("slug", flat=True))
    stale.update(enabled=False, is_default=False)

    # Exactly one default among enabled models, if any claims it.
    defaults = LLMModel.objects.filter(enabled=True, is_default=True).order_by("sort", "name")
    if defaults.count() > 1:
        keep = defaults.first()
        defaults.exclude(pk=keep.pk).update(is_default=False)
    return result
