from django.core.management.base import BaseCommand, CommandError

from apps.llm.services import sync_models


class Command(BaseCommand):
    help = "Create/update LLM models from the LLM_MODELS environment variable."

    def handle(self, *args, **options):
        try:
            result = sync_models()
        except ValueError as exc:
            raise CommandError(f"LLM_MODELS is invalid: {exc}") from exc
        for key in ("created", "updated", "disabled"):
            if result[key]:
                self.stdout.write(f"{key}: {', '.join(result[key])}")
        if not any(result.values()):
            self.stdout.write("LLM_MODELS is empty: nothing to sync.")
