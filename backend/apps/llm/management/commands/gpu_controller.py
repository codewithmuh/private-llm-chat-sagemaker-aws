from django.conf import settings
from django.core.management.base import BaseCommand

from apps.llm.controller import GpuController


class Command(BaseCommand):
    help = "Start/stop SageMaker endpoints according to each model's scaling mode (runs forever)."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Run a single tick and print the decisions.")
        parser.add_argument("--interval", type=int, default=settings.GPU_CONTROLLER_INTERVAL)

    def handle(self, *args, once=False, interval=30, **options):
        controller = GpuController()
        if once:
            for slug, decision in controller.tick().items():
                self.stdout.write(f"{slug}: {decision.action or 'no action'} ({decision.reason})")
            return
        controller.run_forever(interval)
