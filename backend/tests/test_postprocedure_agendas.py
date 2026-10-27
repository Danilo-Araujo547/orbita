from copy import deepcopy
from datetime import date, datetime, time, timedelta
from unittest.mock import Mock
from zoneinfo import ZoneInfo

import pytest

from messaging.models import Message, MetaConfiguration
from responses.models import Issue
from messaging.services import send_guard
from operations.services import apply_outcome, contextual_classify
from scheduling.models import Appointment, OracleAgenda, Rule
from scheduling.oracle_agendas import (
    fetch_day,
    normalized_rows,
    planned_send,
    source_date,
    sync_agenda,
    window_dates,
)

pytestmark = [pytest.mark.django_db, pytest.mark.send_regression]
NOW = datetime(2026, 10, 20, 8, tzinfo=ZoneInfo("America/Sao_Paulo"))
MAPPING = {
    "external_id": "CD_PRINCIPAL",
    "patient_external_id": "PRONTUARIO",
    "patient": "PACIENTE",
    "date": "DATA_REALIZADO",
    "time": "",
    "procedure": "CIRURGIA",
    "professional": "PRESTADOR",
    "appointment_type": "TP_CIRURGIA",
    "phone_columns": ["TELEFONE"],
}
COLUMNS = [
    {"name": c, "type": "VARCHAR"}
    for c in [
        "CD_PRINCIPAL",
        "PRONTUARIO",
        "PACIENTE",
        "DATA_REALIZADO",
        "CIRURGIA",
        "PRESTADOR",
        "TP_CIRURGIA",
        "TELEFONE",
        "MENSAGEM",
    ]
]
REMOTE = {
    "id": "post-1",
    "name": "pos_procedimento_teste",
    "status": "APPROVED",
    "language": "pt_BR",
    "components": [
        {"type": "BODY", "text": "{{1}}, como está após o procedimento de {{2}}?"}
    ],
}


@pytest.fixture
def post_agenda(setup):
    rule = Rule.objects.create(
        unit=setup["unit"],
        code="postprocedure-test",
        name="Pós procedimento",
        kind="postprocedure",
        template=setup["template"],
        send_time=time(9),
        enabled=False,
        refresh_interval_minutes=60,
    )
    return OracleAgenda.objects.create(
        unit=setup["unit"],
        name="Busca ativa - pós procedimento",
        kind="postprocedure",
        view_name="DBASISTEMAS.VDIC_BUSCA_ATIVA_ENVIO_MSG",
        columns=COLUMNS,
        column_mapping=deepcopy(MAPPING),
        template_id="",
        parameter_mapping={},
        rule=rule,
        horizon_days=30,
        days_after=10,
        date_format="br_date",
        send_time=time(9),
        enabled=False,
    )


def row(day, phone="17999990001"):
    return {
        "CD_PRINCIPAL": day.isoformat() + "|2",
        "PRONTUARIO": "FICTICIO-1",
        "PACIENTE": "PACIENTE FICTÍCIO",
        "TELEFONE": phone,
        "DATA_REALIZADO": day.strftime("%d/%m/%Y"),
        "CIRURGIA": "PROCEDIMENTO TESTE",
        "PRESTADOR": "PROFISSIONAL TESTE",
        "TP_CIRURGIA": "TESTE",
        "MENSAGEM": "TEXTO FICTÍCIO",
    }


@pytest.mark.parametrize(
    "performed,expected",
    [
        (date(2026, 10, 10), date(2026, 10, 20)),
        (date(2026, 12, 27), date(2027, 1, 6)),
        (date(2028, 2, 25), date(2028, 3, 6)),
    ],
)
def test_ten_days_after_not_before(post_agenda, performed, expected):
    original, effective = planned_send(post_agenda, performed)
    assert original.date() == effective.date() == expected
    assert effective.hour == 9


def test_window_is_past_in_unit_timezone(post_agenda):
    days = window_dates(post_agenda, NOW)
    assert len(days) == 30
    assert days[-1] == NOW.date() and days[0] == NOW.date() - timedelta(days=29)
    assert source_date("10/10/2026", "br_date") == date(2026, 10, 10)
    with pytest.raises(ValueError):
        source_date("2026/10/10", "br_date")


def test_postprocedure_weekend_shift_does_not_shift_weekdays(post_agenda):
    post_agenda.send_weekdays = [0, 1, 2, 3, 4]
    post_agenda.blocked_day_policy = {"5": "previous", "6": "next"}
    assert planned_send(post_agenda, date(2026, 10, 7))[1].date() == date(2026, 10, 16)
    assert planned_send(post_agenda, date(2026, 10, 8))[1].date() == date(2026, 10, 19)
    assert planned_send(post_agenda, date(2026, 10, 9))[1].date() == date(2026, 10, 19)


def test_no_hour_and_two_phones_one_procedure(post_agenda):
    day = NOW.date() - timedelta(days=10)
    data = normalized_rows(post_agenda, day, [row(day), row(day, "17999990002")])
    assert len(data) == 1 and len(data[0].phone_numbers) == 2
    assert data[0].scheduled_at.hour == 0
    assert data[0].scheduled_at.date() == day


def test_source_only_draft_creates_no_messages_or_notifications(post_agenda, setup):
    count = Message.objects.count()
    day = NOW.date() - timedelta(days=10)
    fetch = Mock(side_effect=lambda a, d: [row(d)] if d == day else [])
    sync_agenda(post_agenda.pk, NOW, fetch)
    app = Appointment.objects.get(source=f"oracle-agenda:{post_agenda.pk}")
    assert app.sourceevent.cases.get().purpose == "postoperative"
    assert app.messages.count() == 0 and Message.objects.count() == count
    assert post_agenda.days.count() == 30
    sync_agenda(post_agenda.pk, NOW, fetch, refresh=True)
    assert Appointment.objects.filter(source=app.source).count() == 1


def test_special_template_after_expiry_and_attention(post_agenda, setup):
    MetaConfiguration.objects.create(
        unit=setup["unit"],
        validation_state="valid",
        waba_id="waba",
        phone_number_id="phone",
        templates=[REMOTE],
    )
    post_agenda.template_id = "post-1"
    post_agenda.template_snapshot = {
        **REMOTE,
        "waba_id": "waba",
        "phone_number_id": "phone",
    }
    post_agenda.parameter_mapping = {
        "1": {"column": "PACIENTE", "format": "text"},
        "2": {"column": "DATA_REALIZADO", "format": "date"},
    }
    post_agenda.save()
    day = NOW.date() - timedelta(days=10)
    sync_agenda(
        post_agenda.pk,
        NOW,
        lambda a, d: [row(d), row(d, "17999990002")] if d == day else [],
    )
    messages = Message.objects.filter(rule=post_agenda.rule)
    assert messages.count() == 2
    message = messages.first()
    assert (
        message.state == "preview"
        and message.expires_at
        > message.scheduled_for
        > message.appointment.scheduled_at
    )
    assert message.parameters == ["PACIENTE FICTÍCIO", day.strftime("%d/%m/%Y")]
    assert (
        message.purpose == "postoperative"
        and message.notification.purpose == "postoperative"
    )
    assert message.snapshot["days_after"] == 10
    assert send_guard(message) == "oracle_agenda_preview_only"
    assert contextual_classify("SIM", "postoperative") == "well"
    assert contextual_classify("NÃO", "postoperative") == "needs_attention"
    apply_outcome(message.case, "needs_attention", text="NÃO", phone=message.recipient)
    message.case.refresh_from_db()
    assert message.case.priority == "high"
    assert Issue.objects.filter(
        case=message.case, category="postoperative_attention"
    ).exists()


def test_varchar_query_is_bound_read_only_and_rolls_back(post_agenda, monkeypatch):
    c = Mock()
    c.__enter__ = Mock(return_value=c)
    c.__exit__ = Mock(return_value=False)
    cursor = Mock()
    cursor.__enter__ = Mock(return_value=cursor)
    cursor.__exit__ = Mock(return_value=False)
    cursor.fetchmany.return_value = []
    c.cursor.return_value = cursor
    monkeypatch.setattr(
        "scheduling.oracle_agendas.OracleSource.connect", lambda self: c
    )
    fetch_day(post_agenda, date(2026, 10, 10))
    assert cursor.execute.call_args_list[0].args == ("SET TRANSACTION READ ONLY",)
    assert "DATA_REALIZADO = :source_day" in cursor.execute.call_args_list[1].args[0]
    assert cursor.execute.call_args_list[1].kwargs == {"source_day": "10/10/2026"}
    c.rollback.assert_called_once()


def test_draft_api_mapping_and_activation_require_template(
    post_agenda, setup, monkeypatch
):
    monkeypatch.setattr("scheduling.agenda_api.describe", lambda *a: COLUMNS)
    data = {
        "id": post_agenda.pk,
        "version": post_agenda.version,
        "name": post_agenda.name,
        "kind": "postprocedure",
        "view_name": post_agenda.view_name,
        "column_mapping": MAPPING,
        "parameter_mapping": {},
        "template_id": "",
        "horizon_days": 30,
        "days_after": 10,
        "date_format": "br_date",
        "enabled": False,
    }
    r = setup["client"].post(
        "/api/v1/oracle-agendas/configure/?unit=ame",
        data,
        format="json",
        HTTP_IDEMPOTENCY_KEY="post-draft-config",
    )
    assert r.status_code == 200, r.data
    assert r.data["configuration"]["days_after"] == 10
    data.update(version=2, enabled=True)
    assert (
        setup["client"]
        .post(
            "/api/v1/oracle-agendas/configure/?unit=ame",
            data,
            format="json",
            HTTP_IDEMPOTENCY_KEY="post-activate-empty",
        )
        .status_code
        == 400
    )
    data.update(enabled=False, horizon_days=10)
    assert (
        setup["client"]
        .post(
            "/api/v1/oracle-agendas/configure/?unit=ame",
            data,
            format="json",
            HTTP_IDEMPOTENCY_KEY="post-invalid-history",
        )
        .status_code
        == 400
    )


def test_scheduler_refreshes_covered_postprocedure_window(
    post_agenda, setup, monkeypatch, django_capture_on_commit_callbacks
):
    from scheduling.models import OracleAgendaDay
    from scheduling.tasks import tick
    from scheduling import tasks

    post_agenda.enabled = True
    post_agenda.last_completed_at = NOW - timedelta(minutes=61)
    post_agenda.last_state = "completed"
    post_agenda.save()
    for day in window_dates(post_agenda, NOW):
        OracleAgendaDay.objects.create(
            agenda=post_agenda, version=post_agenda.version, date=day
        )
    delay = Mock()
    monkeypatch.setattr(tasks.sync_oracle_agenda, "delay", delay)
    monkeypatch.setattr(tasks.timezone, "now", lambda: NOW)
    monkeypatch.setattr(
        tasks, "appointment_source", lambda u: Mock(credentials=lambda: ("", ""))
    )
    with django_capture_on_commit_callbacks(execute=True):
        tick()
    delay.assert_called_once_with(post_agenda.pk, refresh=True)


def test_postprocedure_group_schedule_allows_after_event(post_agenda, setup):
    from django.utils import timezone
    from scheduling.services import queue_appointment, upsert_appointment

    now = timezone.now()
    performed = (
        (now - timedelta(days=10)).astimezone(ZoneInfo(setup["unit"].timezone)).date()
    )
    app = upsert_appointment(
        setup["unit"], normalized_rows(post_agenda, performed, [row(performed)])[0]
    )
    # Exercise schedule validation independently of Meta: source-only configuration never calls this path.
    # Use the existing ordinary template for this isolated scheduling test.
    rule = Rule.objects.create(
        unit=setup["unit"],
        code="post-group-test",
        name="Pós",
        kind="postprocedure",
        send_time=time(9),
        template=setup["template"],
    )
    message = queue_appointment(app, rule, now + timedelta(hours=1), now)
    group = message.group
    stamp = now + timedelta(hours=2)
    response = setup["client"].post(
        f"/api/v1/appointment-groups/{group.pk}/schedule/?unit=ame",
        {
            "version": group.version,
            "scheduled_for": stamp.isoformat(),
            "delay_seconds": 5,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="post-group-schedule",
    )
    assert response.status_code == 200, response.data
    message.refresh_from_db()
    assert message.scheduled_for == stamp and message.expires_at > stamp
    assert message.state == "preview" and message.attempt_count == 0
