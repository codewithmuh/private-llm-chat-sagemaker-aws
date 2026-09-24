"""Run on container start (RUN_BOOTSTRAP=true): migrate, then sync models.

With two api tasks starting at once, both would run migrations at the same
time. A Postgres advisory lock makes the second one wait for the first.
"""

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connection

_LOCK_KEY = 8_301_442_108


class Command(BaseCommand):
    help = "Apply database migrations and sync LLM_MODELS (safe to run from several containers)."

    def handle(self, *args, **options):
        postgres = connection.vendor == "postgresql"
        if postgres:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_lock(%s)", [_LOCK_KEY])
        try:
            call_command("migrate", interactive=False, verbosity=1)
            call_command("sync_models")
        finally:
            if postgres:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_unlock(%s)", [_LOCK_KEY])
