from django.contrib import admin, messages

from .controller import GpuController
from .models import LLMModel


@admin.register(LLMModel)
class LLMModelAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "provider", "scaling", "endpoint_status", "is_default", "enabled", "last_used_at")
    list_filter = ("provider", "scaling", "enabled")
    search_fields = ("name", "slug", "model_id", "endpoint_name")
    list_editable = ("scaling", "enabled")
    readonly_fields = (
        "managed_by_env",
        "endpoint_status",
        "endpoint_error",
        "status_checked_at",
        "last_used_at",
        "wake_requested_at",
        "last_started_at",
        "last_stopped_at",
        "last_error_at",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "name",
                    "slug",
                    "description",
                    "provider",
                    "model_id",
                    "enabled",
                    "is_default",
                    "sort",
                    "managed_by_env",
                )
            },
        ),
        ("OpenAI-compatible server", {"fields": ("base_url", "api_key"), "classes": ("collapse",)}),
        (
            "SageMaker endpoint",
            {
                "fields": (
                    "endpoint_name",
                    "endpoint_config_name",
                    "region",
                    "scaling",
                    "idle_minutes",
                    "hourly_cost_usd",
                )
            },
        ),
        ("Capabilities", {"fields": ("vision", "ocr", "context_window", "max_output_tokens", "temperature")}),
        (
            "GPU state (written by the controller)",
            {
                "fields": (
                    "endpoint_status",
                    "endpoint_error",
                    "status_checked_at",
                    "last_used_at",
                    "wake_requested_at",
                    "last_started_at",
                    "last_stopped_at",
                    "last_error_at",
                )
            },
        ),
    )
    actions = ["refresh_status", "wake_now", "stop_now"]

    @admin.action(description="Refresh endpoint status from AWS")
    def refresh_status(self, request, queryset):
        controller = GpuController()
        for model in queryset.filter(provider=LLMModel.Provider.SAGEMAKER):
            status, _, failure = controller.describe(model)
            LLMModel.objects.filter(pk=model.pk).update(endpoint_status=status)
            self.message_user(request, f"{model.name}: {status} {failure}".strip())

    @admin.action(description="Wake up now (on-demand models)")
    def wake_now(self, request, queryset):
        from .services import request_wake

        for model in queryset.filter(provider=LLMModel.Provider.SAGEMAKER):
            request_wake(model)
        self.message_user(request, "Requested. The GPU controller starts it within a minute.", messages.SUCCESS)

    @admin.action(description="Stop now (sets scaling to Off)")
    def stop_now(self, request, queryset):
        count = queryset.filter(provider=LLMModel.Provider.SAGEMAKER).update(scaling=LLMModel.Scaling.OFF)
        self.message_user(request, f"{count} model(s) set to Off. The controller deletes their endpoints next tick.")
