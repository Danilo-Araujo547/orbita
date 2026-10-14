"""One-time local demo reset requested by the workspace owner. No network calls."""
import json
import os
from pathlib import Path
import sqlite3
import sys
from datetime import timedelta

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from core.models import Audit, Unit
from messaging.models import Attempt, Message
from operations.models import FlowRule, ReportSchedule
from operations.services import log
from responses.services import apply_reply, apply_status, mark_no_response, store_event
from scheduling.connectors import AppointmentData
from scheduling.models import Appointment, Rule
from scheduling.services import queue_appointment, upsert_appointment

assert settings.DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3"
database = Path(settings.DATABASES["default"]["NAME"]).resolve()
assert database == (ROOT / "backend/local.sqlite3").resolve()
now = timezone.now()
backup_dir = ROOT / "artifacts" / ("reset-five-" + now.strftime("%Y%m%d-%H%M%S"))
backup_dir.mkdir(parents=True, exist_ok=False)
with sqlite3.connect(database) as source, sqlite3.connect(backup_dir / "before.sqlite3") as dest:
    source.backup(dest)
    assert dest.execute("PRAGMA integrity_check").fetchone()[0] == "ok"

models = [
    "operations.ReportRequest", "responses.Issue", "responses.Reply", "messaging.Attempt",
    "messaging.Message", "messaging.ProviderEvent", "messaging.Notification",
    "operations.Movement", "operations.Interaction", "operations.Contact", "operations.Campaign",
    "operations.ActionReceipt", "operations.Case", "operations.SourceEvent",
    "scheduling.Appointment", "scheduling.PatientPhone", "scheduling.Patient",
    "operations.FlowRun", "operations.SheetImport", "scheduling.ImportRun", "core.Audit",
]
before = {name: apps.get_model(name).objects.count() for name in models}
examples = [
    ("Ana Exemplo", "consultation", "Consulta de cardiologia", 2, "SIM", "Ana Exemplo", 5),
    ("Bruno Exemplo", "exam", "Ultrassonografia abdominal", 1, "NAO", "Bruno Exemplo", 8),
    ("Carla Exemplo", "lab", "Hemograma completo", 1, None, "", 3),
    ("Daniel Exemplo", "consultation", "Consulta de ortopedia", 1, None, "", 30),
    ("Elisa Exemplo", "exam", "Radiografia de torax", 1, "NAO CONHECO ESSA PESSOA", "Sil Exemplo", 2),
]
with transaction.atomic():
    unit = Unit.objects.get(slug="ame")
    unit.paused = True
    unit.save(update_fields=["paused"])
    # Keep the configured sources, but prevent scheduled imports replacing the demo.
    Rule.objects.update(enabled=False)
    FlowRule.objects.update(enabled=False)
    ReportSchedule.objects.update(enabled=False)
    for name in models:
        apps.get_model(name).objects.all().delete()
    actor = get_user_model().objects.filter(username="admin").first()
    for index, (name, kind, procedure, contact_count, response, person, hours) in enumerate(examples, 1):
        phones = tuple(f"551199990{index * 10 + offset:04d}" for offset in range(contact_count))
        rule = Rule.objects.filter(unit=unit, kind=kind).select_related("unit", "template").first()
        assert rule, f"Missing configured template for {kind}"
        row = AppointmentData(
            external_id=f"DEMO-{index:04d}", patient_external_id=f"DEMO-P-{index:04d}",
            patient=name + " · fictício", kind=kind, phone=phones[0], phone_numbers=phones,
            procedure=procedure, appointment_type="DO SEU AGENDAMENTO",
            scheduled_at=(now + timedelta(days=index + 1)).replace(hour=13, minute=30, second=0, microsecond=0),
            arrival_time="10:15", source="synthetic", synthetic=True,
            professional="Equipe de demonstração", city="Votuporanga",
        )
        appointment = upsert_appointment(unit, row)
        queue_appointment(appointment, rule, now, now)
        deliveries = list(appointment.messages.order_by("recipient"))
        for message in deliveries:
            delivered_at = now - timedelta(hours=hours, minutes=10)
            message.provider_id = f"sim.reset-five.{message.pk}"
            message.channel_id = "simulated"
            message.state = "accepted"
            message.response_state = "pending"
            message.attempt_count = 1
            message.created_at = delivered_at - timedelta(minutes=1)
            message.last_attempt_at = delivered_at - timedelta(seconds=10)
            message.snapshot = {**message.snapshot, "simulation": True}
            message.save()
            attempt = Attempt.objects.create(message=message, number=1, outcome="accepted", completed_at=delivered_at - timedelta(seconds=10))
            Attempt.objects.filter(pk=attempt.pk).update(started_at=delivered_at - timedelta(seconds=15))
            apply_status(store_event("simulated", message.provider_id, "delivered", int(delivered_at.timestamp()), {"simulation": True}))
        if response:
            message = deliveries[0]
            apply_reply(store_event("simulated", f"sim.reset-five.reply.{message.pk}", "reply",
                int((now - timedelta(hours=max(0, hours - 1))).timestamp()),
                {"sender": message.recipient, "text": response, "sender_name": person,
                 "context_id": message.provider_id, "simulation": True}), unit)
        if index == 1:
            log(deliveries[0].case, "note", "Demonstração: dois contatos vinculados ao mesmo paciente; confirmação recebida em um deles.", actor=actor)
        if index == 5:
            log(deliveries[0].case, "note", "Demonstração: destinatário informou não conhecer a paciente. Contato precisa de correção.", actor=actor)
    mark_no_response(now)
    assert Appointment.objects.count() == 5
    assert not Appointment.objects.filter(synthetic=False).exists()
    assert Message.objects.count() == 6
    assert not Message.objects.exclude(channel_id="simulated").exists()
    Audit.objects.create(unit=unit, actor=actor, action="demo.reset_five", details={
        "backup": str(backup_dir / "before.sqlite3"), "previous_counts": before,
        "appointments": 5, "messages": 6, "external_send": False,
        "scheduled_imports_disabled": True,
    })
    summary = [
        {"patient": a.patient, "tracking": __import__("core.serializers", fromlist=["AppointmentSerializer"]).AppointmentSerializer(a).data["tracking"]}
        for a in Appointment.objects.order_by("external_id")
    ]
(backup_dir / "result.json").write_text(json.dumps({"backup": str(backup_dir / "before.sqlite3"), "before": before, "examples": summary}, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"backup": str(backup_dir / "before.sqlite3"), "appointments": 5, "messages": 6, "examples": summary}, ensure_ascii=True))
