from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from messaging.models import Attempt
from responses.models import Issue
from responses.services import apply_reply, apply_status, store_event
from scheduling.connectors import AppointmentData
from scheduling.models import Rule
from scheduling.services import queue_appointment, upsert_appointment

from core.models import Unit

NAMES = [
    "Ana Exemplo",
    "Bruno Exemplo",
    "Carla Exemplo",
    "Daniel Exemplo",
    "Elisa Exemplo",
    "Felipe Exemplo",
    "Gabriela Exemplo",
    "Hugo Exemplo",
    "Isabela Exemplo",
    "João Exemplo",
    "Lívia Exemplo",
    "Miguel Exemplo",
]


class Command(BaseCommand):
    help = "Cria somente dados fictícios e eventos simulados locais; nunca chama Oracle ou Meta."

    def handle(self, *args, **options):
        unit = Unit.objects.filter(slug="ame").first()
        if not unit:
            raise CommandError("Execute bootstrap primeiro.")
        now = timezone.now()
        kinds = ["consultation", "exam", "lab"]
        procedures = ["Consulta de cardiologia", "Ultrassonografia", "Coleta de laboratório"]
        states = [
            "read",
            "delivered",
            "accepted",
            "queued",
            "failed",
            "blocked",
            "read",
            "delivered",
            "queued",
            "read",
            "preview",
            "uncertain",
        ]
        for i, name in enumerate(NAMES):
            kind = kinds[i % 3]
            rule = Rule.objects.filter(unit=unit, kind=kind).select_related("unit", "template").first()
            data = AppointmentData(
                external_id=f"DEMO-{i + 1:04d}",
                kind=kind,
                patient=name + " · fictício",
                phone=f"551199990{i:04d}",
                procedure=procedures[i % 3],
                appointment_type="DO SEU AGENDAMENTO",
                scheduled_at=(now + timedelta(days=(i % 7) + 2)).replace(
                    hour=13, minute=30, second=0, microsecond=0
                ),
                arrival_time="10:15",
                source="synthetic",
                synthetic=True,
            )
            appointment = upsert_appointment(unit, data)
            message = queue_appointment(appointment, rule, now, now)
            if message.provider_id or message.attempt_count:
                continue
            state = states[i]
            message.state = "accepted" if state in ["read", "delivered"] else state
            message.response_state = (
                "pending" if state in ["read", "delivered", "accepted"] else "not_requested"
            )
            message.provider_id = f"sim.demo.{message.pk}"
            message.channel_id = "simulated"
            message.created_at = now - timedelta(days=i % 7)
            if state not in ["queued", "preview", "blocked"]:
                message.attempt_count = 1
                Attempt.objects.create(
                    message=message,
                    number=1,
                    outcome="accepted" if state in ["read", "delivered", "accepted"] else state,
                    completed_at=now,
                )
            if state in ["failed", "blocked", "uncertain"]:
                message.error_code = {
                    "failed": "meta_131026",
                    "blocked": "invalid_phone_format",
                    "uncertain": "network_result_unknown",
                }[state]
                Issue.objects.get_or_create(
                    unit=unit,
                    message=message,
                    category=message.error_code,
                    defaults={"description": "Exemplo fictício de pendência para validação do painel."},
                )
            message.save()
            if state in ["read", "delivered"]:
                stamp = int((now - timedelta(hours=30 if i == 7 else 1)).timestamp())
                apply_status(store_event("simulated", message.provider_id, state, stamp, {}))
            if i in [0, 6, 9]:
                apply_reply(
                    store_event(
                        "simulated",
                        f"sim.demo.reply.{message.pk}",
                        "reply",
                        int(now.timestamp()),
                        {
                            "sender": message.recipient,
                            "text": "Sim" if i != 6 else "Não",
                            "context_id": message.provider_id,
                        },
                    ),
                    unit,
                )
        from responses.services import mark_no_response

        mark_no_response(now)
        self.stdout.write(
            self.style.SUCCESS("Demonstração criada: somente dados fictícios. Nenhuma chamada externa.")
        )
