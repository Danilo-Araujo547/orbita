from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from messaging.models import Message
from scheduling.connectors import OracleSource
from scheduling.models import Rule
from scheduling.services import import_rule


class Command(BaseCommand):
    help = "Valida importação real sem persistir pacientes: Oracle somente leitura e rollback integral local."

    def add_arguments(self, parser):
        parser.add_argument("--rule", default="")

    def handle(self, *args, **options):
        now = timezone.now()
        failed = False
        with transaction.atomic():
            before = set(Message.objects.values_list("pk", flat=True))
            rules = Rule.objects.filter(unit__slug="ame", enabled=True).select_related("unit", "template")
            if options["rule"]:
                rules = rules.filter(code=options["rule"])
            for rule in rules:
                run = import_rule(rule, OracleSource(), now, retry=True)
                if run is None:
                    self.stdout.write(f"{rule.code}: fora do dia/horário; não executada")
                    continue
                self.stdout.write(
                    f"{rule.code}: {run.status}; registros={run.imported}; erro={run.error or 'nenhum'}"
                )
                failed |= run.status != "completed"
            unsafe = (
                Message.objects.exclude(pk__in=before)
                .exclude(state__in=["preview", "blocked", "expired", "cancelled"])
                .exists()
            )
            transaction.set_rollback(True)
        if unsafe:
            raise CommandError("Falha: importação real criou mensagem fora dos estados de análise.")
        self.stdout.write(
            "Rollback local concluído. Nenhum paciente ou lembrete desta validação foi persistido."
        )
        if failed:
            raise CommandError("Uma ou mais regras falharam na validação.")
