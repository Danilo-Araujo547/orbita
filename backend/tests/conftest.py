from datetime import time, timedelta

import pytest
from core.management.commands.bootstrap import BODY
from core.models import Membership, Unit
from django.contrib.auth import get_user_model
from django.utils import timezone
from messaging.models import Template
from rest_framework.test import APIClient
from scheduling.connectors import AppointmentData
from scheduling.models import Rule
from scheduling.services import queue_appointment, upsert_appointment


@pytest.fixture(autouse=True)
def fast_test_passwords(settings):
    settings.SIMULATED_SQLITE_PATH = ""
    settings.META_REAL_ENABLED = False
    settings.REPORT_BAILEYS_ALLOW_SENDS = False
    settings.SEND_MODE = "simulated"
    settings.META_INBOX_SSH_HOST = ""
    # Only test databases use this hasher; application password storage is unchanged.
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


@pytest.fixture
def setup(db, settings):
    settings.TEST_RECIPIENTS = ("5511999990001",)
    settings.SEND_MODE = "simulated"
    now = timezone.now()
    unit = Unit.objects.create(slug="ame", name="AME", paused=False)
    template = Template.objects.create(
        unit=unit,
        name="lembrete_paciente",
        body=BODY,
        fields=["patient", "appointment_type", "procedure", "date", "arrival_time"],
        approved_for_test=True,
    )
    rule = Rule.objects.create(
        unit=unit,
        code="test",
        name="D-7",
        kind="consultation",
        days_before=7,
        send_time=time(7, 15),
        weekdays=[0, 1, 2, 3, 4, 5],
        template=template,
    )
    row = AppointmentData(
        external_id="TEST-1",
        kind="consultation",
        patient="PACIENTE FICTÍCIO",
        phone="5511999990001",
        procedure="CONSULTA TESTE",
        appointment_type="DA SUA CONSULTA",
        scheduled_at=now + timedelta(days=7),
        arrival_time="09:00",
        source="synthetic",
        synthetic=True,
    )
    appointment = upsert_appointment(unit, row)
    message = queue_appointment(appointment, rule, now, now)
    user = get_user_model().objects.create_user("admin", password="Test-Password-2026!")
    Membership.objects.create(user=user, unit=unit, role="admin")
    client = APIClient()
    client.force_authenticate(user)
    return {
        "unit": unit,
        "rule": rule,
        "template": template,
        "row": row,
        "appointment": appointment,
        "message": message,
        "now": now,
        "user": user,
        "client": client,
    }
