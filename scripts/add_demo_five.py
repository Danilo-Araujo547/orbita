"""Append five local fictitious appointments without sending messages."""
import os
from pathlib import Path
import sys
from datetime import timedelta

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from core.models import Audit, Unit
from messaging.models import Attempt, Message
from messaging.services import issue_once
from responses.services import apply_reply, apply_status, store_event
from scheduling.connectors import AppointmentData
from scheduling.models import Appointment, Rule
from scheduling.services import queue_appointment, upsert_appointment

assert settings.DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3"
assert Path(settings.DATABASES["default"]["NAME"]).resolve() == (ROOT / "backend/local.sqlite3").resolve()
examples = [
    (6, "Felipe Exemplo", "consultation", "Consulta de neurologia", "failed", []),
    (7, "Gabriela Exemplo", "exam", "Mamografia", "uncertain", []),
    (8, "Hugo Exemplo", "lab", "Glicemia em jejum", "delivered", ["Preciso saber qual preparo devo fazer"]),
    (9, "Isabela Exemplo", "consultation", "Consulta de oftalmologia", "delivered", ["PARAR"]),
    (10, "João Exemplo", "exam", "Ecocardiograma", "delivered", ["SIM", "NAO"]),
]
now = timezone.now()
created = []
with transaction.atomic():
    unit = Unit.objects.get(slug="ame")
    assert unit.paused
    for index, name, kind, procedure, state, answers in examples:
        external_id = f"DEMO-{index:04d}"
        if Appointment.objects.filter(unit=unit, source="synthetic", external_id=external_id).exists():
            continue
        phones = tuple(f"551199990{index * 10 + offset:04d}" for offset in range(2 if index == 10 else 1))
        rule = Rule.objects.filter(unit=unit, kind=kind).select_related("unit", "template").first()
        assert rule
        row = AppointmentData(
            external_id=external_id, patient_external_id=f"DEMO-P-{index:04d}",
            patient=name + " · fictício", kind=kind, phone=phones[0], phone_numbers=phones,
            procedure=procedure, appointment_type="DO SEU AGENDAMENTO",
            scheduled_at=(now + timedelta(days=index - 3)).replace(hour=13, minute=30, second=0, microsecond=0),
            arrival_time="10:15", source="synthetic", synthetic=True,
            professional="Equipe de demonstração", city="Votuporanga",
        )
        appointment = upsert_appointment(unit, row)
        queue_appointment(appointment, rule, now, now)
        deliveries = list(appointment.messages.order_by("recipient"))
        for offset, message in enumerate(deliveries):
            attempted = now - timedelta(hours=2, minutes=10)
            message.provider_id = f"sim.additional-five.{message.pk}"
            message.channel_id = "simulated"
            message.state = "uncertain" if state == "uncertain" else "accepted"
            message.response_state = "pending"
            message.attempt_count = 1
            message.created_at = attempted - timedelta(minutes=1)
            message.last_attempt_at = attempted
            message.snapshot = {**message.snapshot, "simulation": True}
            if state == "uncertain":
                message.error_code = "network_result_unknown"
            message.save()
            attempt = Attempt.objects.create(message=message, number=1,
                outcome="uncertain" if state == "uncertain" else "accepted", completed_at=attempted)
            Attempt.objects.filter(pk=attempt.pk).update(started_at=attempted - timedelta(seconds=5))
            if state == "uncertain":
                issue_once(message, "network_result_unknown", "Demonstração: retorno do provedor incerto; requer verificação antes de reenviar.")
            else:
                apply_status(store_event("simulated", message.provider_id, state,
                    int((attempted + timedelta(seconds=10)).timestamp()), {"simulation": True, "code": "131026"}))
            if answers:
                apply_reply(store_event("simulated", f"sim.additional-five.reply.{message.pk}", "reply",
                    int((now - timedelta(hours=1) + timedelta(seconds=offset)).timestamp()),
                    {"sender": message.recipient, "text": answers[offset],
                     "sender_name": name if offset == 0 else "Familiar Exemplo",
                     "context_id": message.provider_id, "simulation": True}), unit)
        created.append(external_id)
    Audit.objects.create(unit=unit, action="demo.add_five", details={"appointments": created, "external_send": False})
print({"created": created, "appointments_total": Appointment.objects.count(), "messages_total": Message.objects.count()})
