import os
from datetime import time

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from messaging.models import Template
from scheduling.models import Rule

from core.models import Membership, Unit

RULES = [
    ("consultation-d7", "Consultas · 7 dias antes", "consultation", 7, "07:15", [0, 1, 2, 3, 4, 5], 77, 393),
    ("exam-d7", "Exames · 7 dias antes", "exam", 7, "07:30", [0, 1, 2, 3, 4, 5], 78, 394),
    ("lab-d7", "Laboratório · 7 dias antes", "lab", 7, "07:35", [0, 1, 2, 3, 4, 5], 79, 395),
    ("exam-d3", "Exames · 3 dias antes", "exam", 3, "07:20", [0, 1, 2], 88, 563),
    ("exam-d4", "Exames · 4 dias antes", "exam", 4, "07:25", [3, 4, 5], 48, 586),
]
BODY = (
    "Olá, {{1}}! Gostaríamos de lembrar {{2}} {{3}}, no dia {{4}}. "
    "Horário de chegada: {{5}}. Você confirma sua presença? "
    "Responda SIM para confirmar ou NÃO se não puder comparecer."
)


class Command(BaseCommand):
    help = (
        "Configura AME, template de demonstração e as cinco regras ativas documentadas; não envia mensagens."
    )

    def add_arguments(self, parser):
        parser.add_argument("--username", default="admin")

    @transaction.atomic
    def handle(self, *args, **options):
        unit, _ = Unit.objects.get_or_create(slug="ame", defaults={"name": "AME Votuporanga"})
        template, _ = Template.objects.get_or_create(
            unit=unit,
            name="lembrete_paciente",
            language="pt_BR",
            defaults={
                "body": BODY,
                "fields": ["patient", "appointment_type", "procedure", "date", "arrival_time"],
            },
        )
        for code, name, kind, days, hour, weekdays, report, scheduler in RULES:
            Rule.objects.get_or_create(
                unit=unit,
                code=code,
                defaults={
                    "name": name,
                    "kind": kind,
                    "days_before": days,
                    "send_time": time.fromisoformat(hour),
                    "weekdays": weekdays,
                    "template": template,
                    "legacy_report_id": report,
                    "legacy_scheduler_id": scheduler,
                },
            )
        username = options["username"]
        user = get_user_model().objects.filter(username=username).first()
        if user is None:
            password = os.getenv("BOOTSTRAP_PASSWORD", "")
            if len(password) < 12:
                raise CommandError(
                    "Defina BOOTSTRAP_PASSWORD com pelo menos 12 caracteres; não há senha padrão."
                )
            user = get_user_model().objects.create_user(username=username, password=password)
        Membership.objects.get_or_create(unit=unit, user=user, defaults={"role": "admin"})
        self.stdout.write(
            self.style.SUCCESS("AME configurada. Envios pausados por padrão. Nenhuma mensagem enviada.")
        )
