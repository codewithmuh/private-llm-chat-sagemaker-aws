"""The model registry: which LLMs this deployment offers, and where they run.

Each row is one model people can pick in the UI. Rows come from the
`LLM_MODELS` environment variable (`manage.py sync_models`) or are added by
hand in /admin/.

For SageMaker models the row also carries the GPU endpoint's state, which the
GPU controller (apps/llm/controller.py) keeps up to date.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone


class LLMModel(models.Model):
    class Provider(models.TextChoices):
        SAGEMAKER = "sagemaker", "AWS SageMaker endpoint"
        OPENAI = "openai", "OpenAI-compatible server (vLLM, Ollama, LM Studio, ...)"
        MOCK = "mock", "Mock (fake answers, for development)"

    class Scaling(models.TextChoices):
        ON_DEMAND = "on_demand", "On demand: start when used, delete when idle"
        ALWAYS_ON = "always_on", "Always on"
        OFF = "off", "Off: keep the endpoint deleted"
        MANUAL = "manual", "Manual: the controller never touches it"

    slug = models.SlugField(max_length=100, unique=True, help_text="Id used by the API and UI.")
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300, blank=True)
    provider = models.CharField(max_length=20, choices=Provider.choices)
    model_id = models.CharField(
        max_length=200,
        blank=True,
        help_text='Sent as "model" in each request, e.g. Qwen/Qwen3-VL-8B-Instruct-FP8 or llama3.2:3b.',
    )

    # provider = openai
    base_url = models.CharField(max_length=300, blank=True, help_text="e.g. http://ollama:11434/v1")
    api_key = models.CharField(max_length=300, blank=True)

    # provider = sagemaker
    endpoint_name = models.CharField(max_length=63, blank=True)
    endpoint_config_name = models.CharField(
        max_length=63,
        blank=True,
        help_text="The controller creates the endpoint from this configuration.",
    )
    region = models.CharField(max_length=30, blank=True, help_text="Defaults to AWS_REGION.")
    scaling = models.CharField(max_length=20, choices=Scaling.choices, default=Scaling.MANUAL)
    idle_minutes = models.PositiveIntegerField(default=30)
    hourly_cost_usd = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    # Capabilities and limits
    vision = models.BooleanField(default=False, help_text="Accepts images directly.")
    ocr = models.BooleanField(default=False, help_text="Preferred model for the OCR tool.")
    context_window = models.PositiveIntegerField(default=8192)
    max_output_tokens = models.PositiveIntegerField(default=2048)
    temperature = models.FloatField(default=0.7)

    is_default = models.BooleanField(default=False)
    enabled = models.BooleanField(default=True)
    sort = models.IntegerField(default=100)
    managed_by_env = models.BooleanField(
        default=False,
        editable=False,
        help_text="Created from LLM_MODELS. sync_models overwrites its settings.",
    )

    # Runtime state (SageMaker), written by the GPU controller
    endpoint_status = models.CharField(max_length=30, blank=True)
    endpoint_error = models.TextField(blank=True)
    status_checked_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    wake_requested_at = models.DateTimeField(null=True, blank=True)
    last_started_at = models.DateTimeField(null=True, blank=True)
    last_stopped_at = models.DateTimeField(null=True, blank=True)
    last_error_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort", "name"]
        verbose_name = "LLM model"

    def __str__(self) -> str:
        return self.name

    # ------------------------------------------------------------ status ----

    @property
    def is_sagemaker(self) -> bool:
        return self.provider == self.Provider.SAGEMAKER

    def public_status(self) -> tuple[str, str]:
        """(status, detail) as shown in the UI. See docs/api.md."""
        if not self.is_sagemaker:
            return "ready", ""
        s = self.endpoint_status
        if s == "InService":
            return "ready", ""
        if s in ("Creating", "Updating", "SystemUpdating"):
            return "starting", "Starting the GPU. This usually takes 5 to 15 minutes."
        if s in ("Failed",):
            return "failed", "The GPU endpoint failed to start. An admin can see why in /admin/."
        if s in ("Deleting", "NotFound", "OutOfService"):
            if self.scaling == self.Scaling.ON_DEMAND:
                if self.wake_requested_at or self._recently_used():
                    return "starting", "Waking up the GPU. This usually takes 5 to 15 minutes."
                return "stopped", "Asleep to save money. Send a message to wake it up (5 to 15 minutes)."
            return "stopped", "This model's GPU is switched off."
        # Not observed yet (no controller running, or first tick pending).
        return "unknown", ""

    def _recently_used(self) -> bool:
        if not self.last_used_at:
            return False
        return (timezone.now() - self.last_used_at).total_seconds() < 120

    def touch(self) -> None:
        """Record use. The GPU controller keeps on-demand endpoints running
        while this is recent."""
        now = timezone.now()
        LLMModel.objects.filter(pk=self.pk).update(last_used_at=now)
        self.last_used_at = now

    def as_api(self) -> dict:
        status, detail = self.public_status()
        return {
            "id": self.slug,
            "name": self.name,
            "description": self.description,
            "provider": self.provider,
            "vision": self.vision,
            "ocr": self.ocr,
            "context_window": self.context_window,
            "is_default": self.is_default,
            "status": status,
            "status_detail": detail,
        }

    @classmethod
    def default_for(cls, user=None) -> LLMModel | None:
        enabled = cls.objects.filter(enabled=True)
        if user is not None and getattr(user, "default_model", ""):
            chosen = enabled.filter(slug=user.default_model).first()
            if chosen:
                return chosen
        return enabled.filter(is_default=True).first() or enabled.first()
