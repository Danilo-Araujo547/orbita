"""Regression of the Oracle-to-reminder pipeline. No external I/O is permitted."""

from copy import deepcopy
from datetime import datetime, timedelta
from threading import Barrier, Event, Thread
from types import SimpleNamespace
from unittest.mock import Mock
from zoneinfo import ZoneInfo

import pytest
from django.db import close_old_connections, connection, connections
from rest_framework.test import APIClient

from messaging.models import AppointmentGroup, Attempt, Message, MetaConfiguration
from messaging.services import dispatch, retry_individual, send_guard
from messaging.transports import MetaTransport, SendError
from scheduling.connectors import OracleSource
from scheduling.models import Appointment, OracleAgenda
from scheduling.oracle_agendas import DEFAULT_COLUMNS, planned_send, sync_agenda

pytestmark = pytest.mark.send_regression


NOW = datetime(2026, 10, 19, 12, tzinfo=ZoneInfo("America/Sao_Paulo"))
URL = "/api/v1/oracle-agendas/configure/?unit=ame"
COLUMNS = [
    {"name": v, "type": "VARCHAR"}
    for v in sorted(
        {v for v in DEFAULT_COLUMNS.values() if isinstance(v, str)} | {"CELULAR"}
    )
]
REMOTE = {
    "id": "regression-template",
    "name": "regression_only",
    "language": "pt_BR",
    "status": "APPROVED",
    "category": "UTILITY",
    "components": [{"type": "BODY", "text": "Olá {{1}}, {{2}}, {{3}} às {{4}}"}],
}


def source_row(day, phone="11999990001", **changes):
    return {
        "CD_AGENDA": day.isoformat(),
        "CD_PACIENTE": "FICTIONAL-1",
        "PACIENTE": "PACIENTE FICTÍCIO",
        "DTA_AGENDA": datetime.combine(day, datetime.min.time()),
        "HORA_MARCADA": "10:30",
        "HORA_CHEGADA": "10:15",
        "CELULAR": phone,
        "ESPECIALIDADE": "REGRESSÃO",
        "MEDICO": "PROFISSIONAL FICTÍCIO",
        "TIPO_CONSULTA": "CONSULTA",
        **changes,
    }


@pytest.fixture(autouse=True)
def no_external_sends(monkeypatch, settings):
    settings.SEND_MODE = "simulated"
    settings.META_REAL_ENABLED = False
    settings.META_INBOX_SSH_HOST = ""
    settings.CELERY_TASK_ALWAYS_EAGER = True
    denied = Mock(
        side_effect=AssertionError(
            "External communication is forbidden in this regression"
        )
    )
    monkeypatch.setattr("requests.sessions.Session.request", denied)
    monkeypatch.setattr(MetaTransport, "send", denied)
    monkeypatch.setattr(OracleSource, "connect", denied)
    yield denied
    denied.assert_not_called()


class OracleReadDouble:
    """Exercise the real SQL builder without opening a hospital connection."""

    def __init__(self, rows):
        self.rows, self.sessions = rows, []

    def connect(self):
        connection_double, cursor = Mock(), Mock()
        connection_double.__enter__ = Mock(return_value=connection_double)
        connection_double.__exit__ = Mock(return_value=False)
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        connection_double.cursor.return_value = cursor
        state = {}

        def execute(sql, **params):
            if sql == "SET TRANSACTION READ ONLY":
                return
            assert (
                sql.startswith("SELECT ")
                and "FROM DBASISTEMAS.REGRESSION_VIEW WHERE " in sql
            )
            assert ">= :start_day" in sql and "< :end_day" in sql
            assert params["end_day"] - params["start_day"] == timedelta(days=1)
            state["day"] = params["start_day"].date()
            state["columns"] = (
                sql.partition("SELECT ")[2].partition(" FROM ")[0].split(", ")
            )

        cursor.execute.side_effect = execute
        cursor.fetchmany.side_effect = lambda limit: [
            [row.get(c) for c in state["columns"]]
            for row in self.rows.get(state["day"], [])
        ][:limit]
        self.sessions.append((connection_double, cursor))
        return connection_double


@pytest.fixture
def oracle_case(setup, monkeypatch, no_external_sends):
    assert connection.vendor == "postgresql", (
        "Concurrency regression requires PostgreSQL"
    )
    assert connection.settings_dict["NAME"].startswith("test_"), (
        "Refusing to use the application database"
    )
    MetaConfiguration.objects.create(
        unit=setup["unit"],
        validation_state="valid",
        waba_id="fake-waba",
        phone_number_id="fake-channel",
        templates=[deepcopy(REMOTE)],
    )
    monkeypatch.setattr("scheduling.agenda_api.describe", lambda *args: COLUMNS)
    payload = {
        "version": 0,
        "name": "Regressão",
        "view_name": "DBASISTEMAS.REGRESSION_VIEW",
        "template_id": REMOTE["id"],
        "column_mapping": deepcopy(DEFAULT_COLUMNS),
        "parameter_mapping": {
            "1": {"column": "PACIENTE", "format": "text"},
            "2": {"column": "MEDICO", "format": "text"},
            "3": {"column": "DTA_AGENDA", "format": "date"},
            "4": {"column": "HORA_MARCADA", "format": "time"},
        },
        "horizon_days": 20,
        "days_before": 5,
        "send_time": "09:00",
        "enabled": True,
    }
    response = setup["client"].post(
        URL, payload, format="json", HTTP_IDEMPOTENCY_KEY="regression-create"
    )
    assert response.status_code == 200, response.data
    agenda = OracleAgenda.objects.get(unit=setup["unit"])
    fake = OracleReadDouble({})
    monkeypatch.setattr(OracleSource, "connect", lambda _source: fake.connect())
    return {**setup, "agenda": agenda, "payload": payload, "origin": fake}


@pytest.mark.django_db
def test_database_query_generates_one_appointment_two_contacts_and_no_duplicates(
    oracle_case,
):
    case = oracle_case
    agenda = case["agenda"]
    fake = case["origin"]
    day = NOW.date() + timedelta(days=10)
    fake.rows[day] = [source_row(day), source_row(day, "11999990002"), source_row(day)]
    sync_agenda(agenda.pk, NOW)
    appointment = Appointment.objects.get(source="oracle-agenda:" + str(agenda.pk))
    assert appointment.phone_numbers == ["5511999990001", "5511999990002"]
    assert appointment.messages.count() == 2
    assert AppointmentGroup.objects.filter(rule=agenda.rule).count() == 1
    for message in appointment.messages.all():
        assert message.parameters == [
            "PACIENTE FICTÍCIO",
            "PROFISSIONAL FICTÍCIO",
            day.strftime("%d/%m/%Y"),
            "10:30",
        ]
        assert send_guard(message) == "oracle_agenda_preview_only"
    assert len(fake.sessions) == 20
    for db, cursor in fake.sessions:
        assert cursor.execute.call_args_list[0].args[0] == "SET TRANSACTION READ ONLY"
        db.rollback.assert_called_once()
        db.commit.assert_not_called()
    sync_agenda(agenda.pk, NOW + timedelta(hours=1))
    assert len(fake.sessions) == 20
    sync_agenda(agenda.pk, NOW + timedelta(days=1))
    assert len(fake.sessions) == 21
    sync_agenda(agenda.pk, NOW + timedelta(days=1), refresh=True)
    assert Appointment.objects.filter(source=appointment.source).count() == 1
    assert appointment.messages.count() == 2
    assert not Attempt.objects.filter(message__rule=agenda.rule).exists()


@pytest.mark.parametrize(
    "days,policy,offsets",
    [
        ([0, 1, 2, 3, 4], {"5": "previous", "6": "next"}, [4, 4, 7, 7]),
        ([0, 1, 2, 3, 4], {"5": "previous", "6": "previous"}, [4, 4, 4, 7]),
        ([0, 1, 2, 3, 4], {"5": "next", "6": "next"}, [4, 7, 7, 7]),
        ([0, 1, 2, 3, 4, 5], {"6": "previous"}, [4, 5, 5, 7]),
    ],
)
@pytest.mark.django_db
def test_calendar_pipeline_preserves_native_groups_when_dates_coincide(
    oracle_case, days, policy, offsets
):
    case = oracle_case
    agenda = case["agenda"]
    agenda.send_weekdays, agenda.blocked_day_policy = days, policy
    agenda.save()
    for offset in [4, 5, 6, 7]:
        day = NOW.date() + timedelta(days=offset + 5)
        case["origin"].rows[day] = [source_row(day), source_row(day, "11999990002")]
    sync_agenda(agenda.pk, NOW)
    messages = Message.objects.filter(rule=agenda.rule).order_by(
        "appointment__scheduled_at", "recipient"
    )
    assert messages.count() == 8
    assert (
        Appointment.objects.filter(source="oracle-agenda:" + str(agenda.pk)).count()
        == 4
    )
    assert messages.values("group_id").distinct().count() == 4
    expected = [
        NOW.date() + timedelta(days=d) for d in offsets for _contact in range(2)
    ]
    assert [m.scheduled_for.astimezone(NOW.tzinfo).date() for m in messages] == expected
    assert all(m.scheduled_for.astimezone(NOW.tzinfo).hour == 9 for m in messages)
    sync_agenda(agenda.pk, NOW, refresh=True)
    assert messages.count() == 8
    assert not Attempt.objects.filter(message__rule=agenda.rule).exists()


@pytest.mark.django_db
def test_conflicting_source_rows_block_instead_of_picking_a_patient_record(oracle_case):
    agenda = oracle_case["agenda"]
    day = NOW.date() + timedelta(days=10)
    oracle_case["origin"].rows[day] = [
        source_row(day),
        source_row(day, MEDICO="OUTRO PROFISSIONAL FICTÍCIO"),
    ]
    sync_agenda(agenda.pk, NOW)
    appointment = Appointment.objects.get(source="oracle-agenda:" + str(agenda.pk))
    assert appointment.data_issue == "ambiguous_source_record"
    assert appointment.messages.count() == 1
    message = appointment.messages.get()
    assert (
        message.state == "blocked" and message.error_code == "ambiguous_source_record"
    )
    assert message.attempt_count == 0


@pytest.mark.django_db
def test_failed_day_can_be_retried_without_reimporting_completed_days(oracle_case):
    agenda = oracle_case["agenda"]
    first = NOW.date() + timedelta(days=9)
    bad = first + timedelta(days=1)
    fake = oracle_case["origin"]
    fake.rows[first] = [source_row(first)]
    fake.rows[bad] = [source_row(bad, HORA_MARCADA="INVALID")]
    sync_agenda(agenda.pk, NOW)
    agenda.refresh_from_db()
    assert agenda.last_state == "failed"
    assert not agenda.days.filter(date=bad).exists()
    assert (
        Appointment.objects.filter(source="oracle-agenda:" + str(agenda.pk)).count()
        == 1
    )
    fake.rows[bad] = [source_row(bad)]
    sync_agenda(agenda.pk, NOW)
    agenda.refresh_from_db()
    assert agenda.last_state == "completed" and agenda.days.count() == 20
    assert (
        Appointment.objects.filter(source="oracle-agenda:" + str(agenda.pk)).count()
        == 2
    )
    assert Message.objects.filter(rule=agenda.rule).count() == 2
    assert fake.sessions[-1][0].rollback.call_count == 1


@pytest.mark.django_db
def test_calendar_edit_cancels_old_previews_and_rebuilds_only_one_active_revision(
    oracle_case,
):
    case = oracle_case
    agenda = case["agenda"]
    day = NOW.date() + timedelta(days=10)
    case["origin"].rows[day] = [source_row(day)]
    sync_agenda(agenda.pk, NOW)
    previous = Message.objects.get(rule=agenda.rule)
    response = case["client"].post(
        URL,
        {
            **case["payload"],
            "id": agenda.pk,
            "version": agenda.version,
            "send_weekdays": [0, 1, 2, 3, 4],
            "blocked_day_policy": {"5": "previous", "6": "next"},
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="calendar-revision",
    )
    assert response.status_code == 200, response.data
    previous.refresh_from_db()
    assert previous.state == "cancelled"
    sync_agenda(agenda.pk, NOW)
    sync_agenda(agenda.pk, NOW, refresh=True)
    agenda.refresh_from_db()
    messages = Message.objects.filter(rule=agenda.rule)
    assert messages.count() == 2
    active = messages.exclude(state="cancelled").get()
    assert active.rule_version != previous.rule_version
    assert active.group_id != previous.group_id
    assert active.scheduled_for.astimezone(NOW.tzinfo).date() == NOW.date() + timedelta(
        days=4
    )
    assert previous.scheduled_for.astimezone(
        NOW.tzinfo
    ).date() == NOW.date() + timedelta(days=5)
    assert (
        Appointment.objects.filter(source="oracle-agenda:" + str(agenda.pk)).count()
        == 1
    )
    assert active.snapshot["send_calendar"]["blocked_day_policy"] == {
        "5": "previous",
        "6": "next",
    }
    assert not Attempt.objects.filter(message__rule=agenda.rule).exists()


@pytest.mark.parametrize("request_real_mode", [False, True])
@pytest.mark.django_db
def test_dispatch_cannot_send_an_oracle_preview_even_if_forced_into_queue(
    oracle_case, settings, request_real_mode, no_external_sends
):
    case = oracle_case
    agenda = case["agenda"]
    day = NOW.date() + timedelta(days=10)
    case["origin"].rows[day] = [source_row(day)]
    sync_agenda(agenda.pk, NOW)
    message = Message.objects.get(rule=agenda.rule)
    message.state = "queued"
    message.save(update_fields=["state"])
    if request_real_mode:
        settings.SEND_MODE = "meta_test"
        settings.META_REAL_ENABLED = True
    transport = MetaTransport() if request_real_mode else Mock()
    now = message.scheduled_for + timedelta(minutes=1)
    result = dispatch(message.pk, transport=transport, now=now)
    assert (
        result.state == "blocked" and result.error_code == "oracle_agenda_preview_only"
    )
    assert result.attempt_count == 0
    assert not Attempt.objects.filter(message__rule=agenda.rule).exists()
    no_external_sends.assert_not_called()
    if not request_real_mode:
        transport.send.assert_not_called()


def in_thread(action, results, errors):
    close_old_connections()
    try:
        results.append(action())
    except Exception as exc:  # noqa: BLE001 - propagate thread failures to the test
        errors.append(exc)
    finally:
        connections.close_all()


@pytest.mark.django_db(transaction=True)
def test_two_operators_edit_same_version_one_gets_conflict(oracle_case):
    case = oracle_case
    agenda = case["agenda"]
    start = Barrier(2)
    results = []
    errors = []

    def edit(number):
        client = APIClient()
        client.force_authenticate(case["user"])
        start.wait(timeout=30)
        response = client.post(
            URL,
            {
                **case["payload"],
                "id": agenda.pk,
                "version": agenda.version,
                "name": "Operador " + str(number),
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="operator-" + str(number),
        )
        return response.status_code

    threads = [
        Thread(
            target=in_thread,
            args=(lambda number=n: edit(number), results, errors),
            daemon=True,
        )
        for n in (1, 2)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(40)
    assert not any(t.is_alive() for t in threads) and not errors, errors
    assert sorted(results) == [200, 409]
    agenda.refresh_from_db()
    assert agenda.version == 2


@pytest.mark.django_db(transaction=True)
def test_calendar_change_during_query_does_not_commit_old_schedule(oracle_case):
    case = oracle_case
    agenda = case["agenda"]
    entered = Event()
    release = Event()
    results = []
    errors = []
    day = NOW.date() + timedelta(days=10)

    def delayed_fetch(_agenda, target):
        if target == day:
            entered.set()
            assert release.wait(30)
            return [source_row(target)]
        return []

    thread = Thread(
        target=in_thread,
        args=(lambda: sync_agenda(agenda.pk, NOW, delayed_fetch), results, errors),
        daemon=True,
    )
    thread.start()
    try:
        assert entered.wait(30)
        response = case["client"].post(
            URL,
            {
                **case["payload"],
                "id": agenda.pk,
                "version": agenda.version,
                "send_weekdays": [0, 1, 2, 3, 4],
                "blocked_day_policy": {"5": "previous", "6": "next"},
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="edit-during-query",
        )
        assert response.status_code == 200, response.data
    finally:
        release.set()
        thread.join(40)
    assert not thread.is_alive() and not errors, errors
    assert not Message.objects.filter(rule=agenda.rule).exists()
    case["origin"].rows[day] = [source_row(day)]
    sync_agenda(agenda.pk, NOW)
    message = Message.objects.get(rule=agenda.rule)
    assert message.snapshot["oracle_agenda_version"] == 2
    assert message.scheduled_for.astimezone(
        NOW.tzinfo
    ).date() == NOW.date() + timedelta(days=4)


@pytest.mark.django_db(transaction=True)
def test_two_workers_cannot_duplicate_attempts_for_the_same_oracle_message(oracle_case):
    case = oracle_case
    agenda = case["agenda"]
    day = NOW.date() + timedelta(days=10)
    case["origin"].rows[day] = [source_row(day)]
    sync_agenda(agenda.pk, NOW)
    message = Message.objects.get(rule=agenda.rule)
    message.state = "queued"
    message.save(update_fields=["state"])
    start = Barrier(2)
    results = []
    errors = []
    transport = Mock()

    def work():
        start.wait(timeout=30)
        return dispatch(
            message.pk,
            transport=transport,
            now=message.scheduled_for + timedelta(minutes=1),
        ).state

    threads = [
        Thread(target=in_thread, args=(work, results, errors), daemon=True)
        for _worker in range(2)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(40)
    assert not any(t.is_alive() for t in threads) and not errors, errors
    assert results == ["blocked", "blocked"]
    transport.send.assert_not_called()
    assert not Attempt.objects.filter(message__rule=agenda.rule).exists()


@pytest.mark.parametrize(
    "appointment_day,days,policy,expected",
    [
        ("2023-01-06", [0, 1, 2, 3, 4], {"6": "previous"}, "2022-12-30"),
        ("2026-03-05", [0, 1, 2, 3, 4], {"5": "next"}, "2026-03-02"),
        ("2027-01-03", [4], {"1": "next"}, "2027-01-01"),
    ],
)
def test_calendar_crosses_month_and_year_boundaries(
    appointment_day, days, policy, expected
):
    agenda = SimpleNamespace(
        days_before=5,
        send_weekdays=days,
        blocked_day_policy=policy,
        send_time=NOW.time(),
        unit=SimpleNamespace(timezone="America/Sao_Paulo"),
    )
    day = datetime.fromisoformat(appointment_day).date()
    original, adjusted = planned_send(agenda, day)
    assert original.date() + timedelta(days=5) == day
    assert adjusted.date().isoformat() == expected
    assert adjusted.hour == 12 and adjusted.weekday() in days


@pytest.mark.django_db(transaction=True)
def test_two_workers_send_synthetic_message_only_once_to_local_transport(oracle_case):
    case = oracle_case
    message = case["message"]
    rule = case["rule"]
    rule.enabled = True
    rule.save(update_fields=["enabled"])
    start = Barrier(2)
    results = []
    errors = []
    transport = Mock(
        channel_id="simulated", send=Mock(return_value="sim.regression-once")
    )

    def work():
        start.wait(timeout=30)
        return dispatch(
            message.pk, transport=transport, now=case["now"] + timedelta(seconds=1)
        ).state

    threads = [
        Thread(target=in_thread, args=(work, results, errors), daemon=True)
        for _worker in range(2)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(40)
    assert not any(t.is_alive() for t in threads) and not errors, errors
    message.refresh_from_db()
    assert message.state == "accepted" and message.provider_id == "sim.regression-once"
    assert message.attempt_count == 1
    transport.send.assert_called_once()
    assert Attempt.objects.filter(message=message).count() == 1


@pytest.mark.parametrize(
    "failure,expected",
    [
        (SendError("fake_invalid_number"), "failed"),
        (SendError("fake_timeout_unknown", uncertain=True), "uncertain"),
        (SendError("fake_provider_unavailable", transient=True), "queued"),
    ],
)
@pytest.mark.django_db
def test_simulated_transport_failure_retry_and_uncertain_result(
    oracle_case, failure, expected
):
    case = oracle_case
    message = case["message"]
    rule = case["rule"]
    rule.enabled = True
    rule.save(update_fields=["enabled"])
    now = case["now"] + timedelta(seconds=1)
    transport = Mock(channel_id="simulated", send=Mock(side_effect=failure))
    result = dispatch(message.pk, transport=transport, now=now)
    assert result.state == expected and result.attempt_count == 1
    assert Attempt.objects.filter(message=message).count() == 1
    if expected == "uncertain":
        with pytest.raises(ValueError):
            retry_individual(result, case["user"], now=now)
        dispatch(message.pk, transport=transport, now=now + timedelta(seconds=2))
        transport.send.assert_called_once()
    elif expected == "queued":
        dispatch(message.pk, transport=transport, now=now + timedelta(seconds=30))
        transport.send.assert_called_once()
        transport.send.side_effect = None
        transport.send.return_value = "sim.regression-retry"
        result = dispatch(
            message.pk, transport=transport, now=now + timedelta(seconds=61)
        )
        assert result.state == "accepted" and result.attempt_count == 2
        assert Attempt.objects.filter(message=message).count() == 2
    else:
        dispatch(message.pk, transport=transport, now=now + timedelta(seconds=2))
        transport.send.assert_called_once()
