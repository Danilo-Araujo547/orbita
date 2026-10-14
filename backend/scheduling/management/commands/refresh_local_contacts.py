from datetime import date

from core.models import Unit
from django.core.management.base import BaseCommand, CommandError
from scheduling.connectors import OracleSource
from scheduling.models import Appointment
from scheduling.services import upsert_appointment


class Command(BaseCommand):
    help = "Atualiza registros locais já importados, com leitura Oracle; não gera mensagens."

    def add_arguments(self, parser):
        parser.add_argument("--unit", required=True)

    def handle(self, *args, **options):
        unit = Unit.objects.get(slug=options["unit"])
        source = OracleSource(unit)
        rows = []
        # Read every batch before changing the local database.
        try:
            for kind in Appointment.Kind.values:
                ids = list(
                    Appointment.objects.filter(unit=unit, source="oracle", kind=kind).values_list(
                        "external_id", flat=True
                    )
                )
                for offset in range(0, len(ids), 500):
                    rows.extend(
                        source.fetch(
                            kind, date.today(), unit.timezone, external_ids=ids[offset : offset + 500]
                        )
                    )
        except Exception as error:
            raise CommandError(
                f"Leitura não concluída: {type(error).__name__}; dados locais preservados."
            ) from None
        from django.db import transaction

        with transaction.atomic():
            for row in rows:
                upsert_appointment(unit, row)
        self.stdout.write(
            f"Atualizados localmente: {len(rows)}. Mensagens criadas: 0. Nenhuma gravação Oracle."
        )
