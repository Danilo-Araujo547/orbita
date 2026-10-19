from datetime import date

from core.models import Unit
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from scheduling.simulated import create_source, import_simulated


class Command(BaseCommand):
    help = "Create and import 30 fictitious appointments from a local SQLite view."

    def add_arguments(self, parser):
        parser.add_argument("--start-month", default="2026-10")

    def handle(self, *args, **options):
        if not settings.SIMULATED_SQLITE_PATH:
            raise CommandError("Configure SIMULATED_SQLITE_PATH first.")
        unit = Unit.objects.get(slug=settings.SIMULATED_SQLITE_UNIT)
        path = create_source(
            settings.SIMULATED_SQLITE_PATH, unit, date.fromisoformat(options["start_month"] + "-01")
        )
        result = import_simulated(unit)
        self.stdout.write(f"SQLite: {path}; atendimentos: {result['imported']}")
