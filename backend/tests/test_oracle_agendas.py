from copy import deepcopy
from datetime import datetime, timedelta
from threading import Event, Thread
from unittest.mock import Mock
from zoneinfo import ZoneInfo

import pytest
from django.db import close_old_connections, connections

from core.models import Membership, Unit
from messaging.models import Message, MetaConfiguration
from scheduling.models import Appointment, OracleAgenda
from scheduling.oracle_agendas import (
    DEFAULT_COLUMNS,
    fetch_day,
    sync_agenda,
    template_keys,
)

pytestmark = pytest.mark.send_regression


NOW = datetime(2026, 10, 19, 12, tzinfo=ZoneInfo("America/Sao_Paulo"))
COLUMNS = [
    {"name": value, "type": "VARCHAR"}
    for value in sorted(
        {v for v in DEFAULT_COLUMNS.values() if isinstance(v, str)} | {"CELULAR"}
    )
]
REMOTE = {
    "id": "remote-1",
    "name": "lembrete_sansaude",
    "language": "pt_BR",
    "status": "APPROVED",
    "category": "UTILITY",
    "parameter_format": "POSITIONAL",
    "components": [
        {
            "type": "BODY",
            "text": "Olá {{1}}, profissional {{2}}, dia {{3}}, hora {{4}}",
        },
        {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": "SIM"}]},
    ],
}


@pytest.fixture
def configured(setup, monkeypatch):
    MetaConfiguration.objects.create(
        unit=setup["unit"],
        validation_state="valid",
        waba_id="waba",
        phone_number_id="channel",
        templates=[deepcopy(REMOTE)],
    )
    monkeypatch.setattr("scheduling.agenda_api.describe", lambda *args: COLUMNS)
    payload = {
        "version": 0,
        "view_name": "DBASISTEMAS.VDIC_CONS_AGENDA_ENVIO_MSG_SAN",
        "template_id": "remote-1",
        "column_mapping": deepcopy(DEFAULT_COLUMNS),
        "parameter_mapping": {
            "1": {"column": "PACIENTE", "format": "text"},
            "2": {"column": "MEDICO", "format": "text"},
            "3": {"column": "DTA_AGENDA", "format": "date"},
            "4": {"column": "HORA_MARCADA", "format": "time"},
        },
        "horizon_days": 10,
        "days_before": 5,
        "send_time": "09:00",
        "enabled": True,
    }
    response = setup["client"].post(
        "/api/v1/oracle-agendas/configure/?unit=ame",
        payload,
        format="json",
        HTTP_IDEMPOTENCY_KEY="agenda-configure-1",
    )
    assert response.status_code == 200, response.data
    return setup, OracleAgenda.objects.get(unit=setup["unit"]), payload


def row(day, phone="17999990001"):
    return {
        "CD_AGENDA": day.strftime("%Y%m%d"),
        "CD_PACIENTE": "patient-1",
        "PACIENTE": "FICTICIO",
        "DTA_AGENDA": datetime.combine(day, datetime.min.time()),
        "HORA_MARCADA": "10:30",
        "HORA_CHEGADA": "10:15",
        "CELULAR": phone,
        "ESPECIALIDADE": "TESTE",
        "MEDICO": "MEDICO TESTE",
        "TIPO_CONSULTA": "CONSULTA",
    }


@pytest.mark.django_db
def test_ten_days_imports_once_and_rollover_adds_only_one_day(configured):
    _, agenda, _ = configured
    fetch = Mock(side_effect=lambda a, day: [row(day)])
    sync_agenda(agenda.pk, NOW, fetch)
    assert fetch.call_count == 10
    assert agenda.days.count() == 10
    appointments = Appointment.objects.filter(source="oracle-agenda:" + str(agenda.pk))
    assert appointments.count() == 10
    messages = Message.objects.filter(rule=agenda.rule)
    assert messages.count() == 10
    assert not messages.filter(
        state__in=["queued", "sending", "sent", "accepted"]
    ).exists()
    assert not messages.filter(attempt_count__gt=0).exists()
    assert messages.filter(body__contains="MEDICO TESTE").count() == 10
    sync_agenda(agenda.pk, NOW + timedelta(hours=1), fetch)
    assert fetch.call_count == 10
    sync_agenda(agenda.pk, NOW + timedelta(days=1), fetch)
    assert fetch.call_count == 11
    assert fetch.call_args.args[1] == NOW.date() + timedelta(days=11)
    assert appointments.count() == 11


@pytest.mark.django_db
def test_phone_rows_consolidate_single_appointment_two_messages(configured):
    _, agenda, _ = configured
    target = NOW.date() + timedelta(days=8)
    sync_agenda(
        agenda.pk,
        NOW,
        lambda a, day: (
            [row(day, "17999990001"), row(day, "17999990002")] if day == target else []
        ),
    )
    appointment = Appointment.objects.get(source="oracle-agenda:" + str(agenda.pk))
    assert not appointment.data_issue
    assert appointment.phone_numbers == ["5517999990001", "5517999990002"]
    assert appointment.messages.count() == 2
    assert appointment.sourceevent.cases.count() == 1
    assert agenda.days.count() == 10  # Includes successful empty days.


@pytest.mark.django_db
def test_refresh_updates_without_duplicate_appointments(configured):
    _, agenda, _ = configured
    target = NOW.date() + timedelta(days=8)
    sync_agenda(agenda.pk, NOW, lambda a, day: [row(day)] if day == target else [])
    first = Appointment.objects.get(source="oracle-agenda:" + str(agenda.pk))

    def changed(a, day):
        value = row(day)
        value["MEDICO"] = "OUTRO MEDICO"
        return [value] if day == target else []

    sync_agenda(agenda.pk, NOW, changed, refresh=True)
    first.refresh_from_db()
    assert first.professional == "OUTRO MEDICO" and first.revision == 2
    assert Appointment.objects.filter(source=first.source).count() == 1
    assert first.messages.filter(state="cancelled").count() == 1
    assert (
        first.messages.filter(state="preview", body__contains="OUTRO MEDICO").count()
        == 1
    )


@pytest.mark.django_db
def test_changed_configuration_during_fetch_is_not_committed(configured):
    _, agenda, _ = configured

    def changed(a, day):
        OracleAgenda.objects.filter(pk=a.pk).update(version=a.version + 1)
        return [row(day)]

    sync_agenda(agenda.pk, NOW, changed)
    assert not Appointment.objects.filter(
        source="oracle-agenda:" + str(agenda.pk)
    ).exists()


@pytest.mark.django_db
def test_stale_and_idempotent_configuration(configured):
    setup, agenda, payload = configured
    response = setup["client"].post(
        "/api/v1/oracle-agendas/configure/?unit=ame",
        payload,
        format="json",
        HTTP_IDEMPOTENCY_KEY="agenda-configure-1",
    )
    assert response.status_code == 200
    assert OracleAgenda.objects.get(pk=agenda.pk).version == 1
    response = setup["client"].post(
        "/api/v1/oracle-agendas/configure/?unit=ame",
        {**payload, "id": agenda.pk},
        format="json",
        HTTP_IDEMPOTENCY_KEY="agenda-configure-2",
    )
    assert response.status_code == 409


@pytest.mark.django_db
def test_scope_and_read_only_permissions(configured):
    setup, _, _ = configured
    Unit.objects.create(slug="other", name="Other")
    assert setup["client"].get("/api/v1/oracle-agendas/?unit=other").status_code == 403
    member = Membership.objects.get(user=setup["user"], unit=setup["unit"])
    member.permissions = {"settings": "read"}
    member.save()
    assert setup["client"].get("/api/v1/oracle-agendas/?unit=ame").status_code == 200
    assert (
        setup["client"]
        .post(
            "/api/v1/oracle-agendas/inspect/?unit=ame",
            {"view_name": "DBASISTEMAS.VIEW"},
            format="json",
        )
        .status_code
        == 403
    )


@pytest.mark.django_db
def test_unknown_or_foreign_template_and_columns_rejected(configured):
    setup, agenda, payload = configured
    payload = deepcopy(payload)
    payload["version"] = agenda.version
    payload["template_id"] = "foreign"
    assert (
        setup["client"]
        .post(
            "/api/v1/oracle-agendas/configure/?unit=ame",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="foreign-template",
        )
        .status_code
        == 400
    )
    payload["template_id"] = "remote-1"
    payload["parameter_mapping"]["1"]["column"] = "UNKNOWN"
    assert (
        setup["client"]
        .post(
            "/api/v1/oracle-agendas/configure/?unit=ame",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="unknown-column",
        )
        .status_code
        == 400
    )


@pytest.mark.django_db
def test_error_does_not_log_patient_data(configured):
    _, agenda, _ = configured

    def failed(*args):
        raise RuntimeError("patient-name credential secret")

    sync_agenda(agenda.pk, NOW, failed)
    agenda.refresh_from_db()
    assert agenda.last_error == "oracle_agenda_failed"
    assert agenda.last_state == "failed"


@pytest.mark.django_db
def test_catalog_channel_changed_stops_import(configured):
    setup, agenda, _ = configured
    MetaConfiguration.objects.filter(unit=setup["unit"]).update(
        phone_number_id="other-channel"
    )
    fetch = Mock()
    sync_agenda(agenda.pk, NOW, fetch)
    fetch.assert_not_called()
    agenda.refresh_from_db()
    assert agenda.last_error == "configuration_changed"


def test_template_contracts_and_nonsequential_appearance():
    t = deepcopy(REMOTE)
    t["components"][0]["text"] = "{{1}} {{3}} {{2}}"
    assert template_keys(t) == ["1", "2", "3"]
    t["components"][0]["text"] = "{{nome}} {{data}}"
    assert template_keys(t) == ["nome", "data"]
    t["components"].insert(0, {"type": "HEADER", "format": "DOCUMENT"})
    with pytest.raises(ValueError, match="template_component_not_supported"):
        template_keys(t)


@pytest.mark.django_db
def test_query_uses_bound_half_open_dates_and_read_only(configured, monkeypatch):
    _, agenda, _ = configured
    connection = Mock()
    connection.__enter__ = Mock(return_value=connection)
    connection.__exit__ = Mock(return_value=False)
    cursor = Mock()
    cursor.__enter__ = Mock(return_value=cursor)
    cursor.__exit__ = Mock(return_value=False)
    cursor.fetchmany.return_value = []
    connection.cursor.return_value = cursor
    monkeypatch.setattr(
        "scheduling.oracle_agendas.OracleSource.connect", lambda self: connection
    )
    fetch_day(agenda, NOW.date())
    assert cursor.execute.call_args_list[0].args == ("SET TRANSACTION READ ONLY",)
    sql = cursor.execute.call_args_list[1].args[0]
    assert ">= :start_day" in sql and "< :end_day" in sql
    assert "TBL_LOG" not in sql
    assert cursor.execute.call_args_list[1].kwargs[
        "end_day"
    ].date() == NOW.date() + timedelta(days=1)
    connection.rollback.assert_called_once()


@pytest.mark.django_db(transaction=True)
def test_concurrent_workers_only_one_reads(configured):
    _, agenda, _ = configured
    entered, release = Event(), Event()
    fetch = Mock()
    errors = []

    def slow(a, day):
        entered.set()
        assert release.wait(10)
        return []

    fetch.side_effect = slow

    def run():
        close_old_connections()
        try:
            sync_agenda(agenda.pk, NOW, fetch)
        except Exception as exc:  # noqa: BLE001 - capture thread failures for assertions
            errors.append(exc)
        finally:
            connections.close_all()

    thread = Thread(target=run)
    thread.start()
    assert entered.wait(10)
    other = Mock()
    sync_agenda(agenda.pk, NOW, other)
    other.assert_not_called()
    release.set()
    thread.join(15)
    assert not thread.is_alive() and not errors
    assert fetch.call_count == 10


@pytest.mark.django_db
def test_imported_messages_cannot_be_sent_even_if_group_released(configured):
    from messaging.services import send_guard

    _, agenda, _ = configured
    day = NOW.date() + timedelta(days=8)
    sync_agenda(agenda.pk, NOW, lambda a, d: [row(d)] if d == day else [])
    message = Message.objects.get(rule=agenda.rule)
    assert message.snapshot["source_view"] == agenda.view_name
    assert message.snapshot["meta_phone_number_id"] == "channel"
    assert send_guard(message) == "oracle_agenda_preview_only"


@pytest.mark.django_db
def test_long_source_appointment_description_is_preserved(configured):
    _, agenda, _ = configured
    day = NOW.date() + timedelta(days=8)
    value = row(day)
    value["TIPO_CONSULTA"] = "Descrição completa " * 20
    sync_agenda(agenda.pk, NOW, lambda a, d: [value] if d == day else [])
    appointment = Appointment.objects.get(source="oracle-agenda:" + str(agenda.pk))
    assert appointment.appointment_type == value["TIPO_CONSULTA"].strip()
    agenda.refresh_from_db()
    assert agenda.last_state == "completed"


@pytest.mark.django_db
def test_recoverable_exclusion_preserves_data_and_stops_import(configured):
    setup, agenda, _ = configured
    day = NOW.date() + timedelta(days=8)
    sync_agenda(agenda.pk, NOW, lambda a, d: [row(d)] if d == day else [])
    response = setup["client"].post(
        "/api/v1/oracle-agendas/remove/?unit=ame",
        {"version": agenda.version},
        format="json",
        HTTP_IDEMPOTENCY_KEY="delete-agenda-1",
    )
    assert response.status_code == 200, response.data
    assert response.data["configuration"] is None
    assert response.data["archived_configuration"]["id"] == agenda.pk
    agenda.refresh_from_db()
    assert agenda.deleted_at and not agenda.enabled
    assert (
        Appointment.objects.filter(source="oracle-agenda:" + str(agenda.pk)).count()
        == 1
    )
    assert Message.objects.filter(rule=agenda.rule, state="cancelled").count() == 1
    fetch = Mock()
    sync_agenda(agenda.pk, NOW, fetch)
    fetch.assert_not_called()
    repeat = setup["client"].post(
        "/api/v1/oracle-agendas/remove/?unit=ame",
        {"version": 1},
        format="json",
        HTTP_IDEMPOTENCY_KEY="delete-agenda-1",
    )
    assert repeat.status_code == 200
    assert (
        setup["client"]
        .post(
            "/api/v1/oracle-agendas/restore/?unit=ame",
            {"version": 1},
            format="json",
            HTTP_IDEMPOTENCY_KEY="stale-restore",
        )
        .status_code
        == 409
    )
    restored = setup["client"].post(
        "/api/v1/oracle-agendas/restore/?unit=ame",
        {"version": agenda.version},
        format="json",
        HTTP_IDEMPOTENCY_KEY="restore-agenda-1",
    )
    assert restored.status_code == 200
    assert restored.data["configuration"]["enabled"] is False
    assert restored.data["archived_configuration"] is None


@pytest.mark.django_db
def test_delete_during_fetch_prevents_commit(configured):
    setup, agenda, _ = configured

    def removed(a, day):
        response = setup["client"].post(
            "/api/v1/oracle-agendas/remove/?unit=ame",
            {"version": agenda.version},
            format="json",
            HTTP_IDEMPOTENCY_KEY="delete-mid-import",
        )
        assert response.status_code == 200
        return [row(day)]

    sync_agenda(agenda.pk, NOW, removed)
    assert not Appointment.objects.filter(
        source="oracle-agenda:" + str(agenda.pk)
    ).exists()


@pytest.mark.django_db
def test_delete_requires_admin_write_and_unit_access(configured):
    setup, agenda, _ = configured
    Unit.objects.create(slug="other", name="Other")
    assert (
        setup["client"]
        .post(
            "/api/v1/oracle-agendas/remove/?unit=other",
            {"version": agenda.version},
            format="json",
            HTTP_IDEMPOTENCY_KEY="other-delete",
        )
        .status_code
        == 403
    )
    member = Membership.objects.get(user=setup["user"], unit=setup["unit"])
    member.permissions = {"settings": "read"}
    member.save()
    assert (
        setup["client"]
        .post(
            "/api/v1/oracle-agendas/remove/?unit=ame",
            {"version": agenda.version},
            format="json",
            HTTP_IDEMPOTENCY_KEY="readonly-delete",
        )
        .status_code
        == 403
    )


@pytest.mark.django_db
def test_multiple_origins_keep_bindings_groups_and_history_independent(configured):
    setup, first, payload = configured
    second_payload = deepcopy(payload)
    second_payload.update(
        name="Exames", kind="exam", view_name="DBASISTEMAS.OUTRA_VIEW"
    )
    second_payload["parameter_mapping"]["1"]["column"] = "MEDICO"
    result = setup["client"].post(
        "/api/v1/oracle-agendas/configure/?unit=ame",
        second_payload,
        format="json",
        HTTP_IDEMPOTENCY_KEY="second-origin",
    )
    assert result.status_code == 200, result.data
    second = OracleAgenda.objects.exclude(pk=first.pk).get(unit=setup["unit"])
    assert len(result.data["configurations"]) == 2
    assert second.rule_id != first.rule_id
    assert second.rule.template_id == first.rule.template_id
    target = NOW.date() + timedelta(days=8)
    fetch = lambda agenda, day: [row(day)] if day == target else []
    # Render second first: a shared catalog template cannot change first's bindings.
    sync_agenda(second.pk, NOW, fetch)
    sync_agenda(first.pk, NOW, fetch)
    m1 = Message.objects.get(rule=first.rule)
    m2 = Message.objects.get(rule=second.rule)
    assert m1.parameters[0] == "FICTICIO"
    assert m2.parameters[0] == "MEDICO TESTE"
    assert m1.group_id != m2.group_id
    assert m2.appointment.kind == "exam"
    assert m1.snapshot["fields"][0] == "oracle:PACIENTE:text"
    assert m2.snapshot["fields"][0] == "oracle:MEDICO:text"
    assert first.days.count() == second.days.count() == 10
    response = setup["client"].post(
        "/api/v1/oracle-agendas/remove/?unit=ame",
        {"id": second.pk, "version": second.version},
        format="json",
        HTTP_IDEMPOTENCY_KEY="remove-second",
    )
    assert response.status_code == 200
    first.refresh_from_db()
    m1.refresh_from_db()
    assert first.deleted_at is None and first.enabled
    assert m1.state == "preview"
    assert len(response.data["configurations"]) == 1
    assert len(response.data["archived_configurations"]) == 1
    assert not Message.objects.filter(
        rule__in=[first.rule, second.rule], attempt_count__gt=0
    ).exists()


@pytest.mark.django_db
def test_multiple_origins_require_explicit_target_and_unit_scope(configured):
    setup, first, payload = configured
    result = setup["client"].post(
        "/api/v1/oracle-agendas/configure/?unit=ame",
        {**payload, "name": "Outra origem"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="add-origin",
    )
    assert result.status_code == 200
    client = setup["client"]
    assert (
        client.post(
            "/api/v1/oracle-agendas/remove/?unit=ame",
            {"version": 1},
            format="json",
            HTTP_IDEMPOTENCY_KEY="ambiguous-target",
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/oracle-agendas/remove/?unit=ame",
            {"id": first.pk + 99999, "version": 1},
            format="json",
            HTTP_IDEMPOTENCY_KEY="invalid-target",
        ).status_code
        == 400
    )
    edit = {**payload, "id": first.pk, "version": first.version, "name": "Renomeada"}
    result = client.post(
        "/api/v1/oracle-agendas/configure/?unit=ame",
        edit,
        format="json",
        HTTP_IDEMPOTENCY_KEY="edit-first",
    )
    assert result.status_code == 200
    first.refresh_from_db()
    assert first.name == "Renomeada" and first.version == 2
    assert OracleAgenda.objects.exclude(pk=first.pk).get().version == 1
    assert (
        client.post(
            "/api/v1/oracle-agendas/configure/?unit=ame",
            edit,
            format="json",
            HTTP_IDEMPOTENCY_KEY="stale-edit",
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "days,policy,expected",
    [
        ([0, 1, 2, 3, 4], {"5": "previous", "6": "next"}, [4, 4, 0, 0]),
        ([0, 1, 2, 3, 4], {"5": "previous", "6": "previous"}, [4, 4, 4, 0]),
        ([0, 1, 2, 3, 4], {"5": "next", "6": "next"}, [4, 0, 0, 0]),
        ([0, 1, 2, 3, 4, 5], {"6": "previous"}, [4, 5, 5, 0]),
    ],
)
@pytest.mark.django_db
def test_send_calendar_preserves_allowed_days_and_moves_each_blocked_day(
    configured, days, policy, expected
):
    from scheduling.oracle_agendas import planned_send

    _, agenda, _ = configured
    agenda.send_weekdays, agenda.blocked_day_policy = days, policy
    originals = [NOW.date() + timedelta(days=offset) for offset in (4, 5, 6, 7)]
    for original, target_weekday in zip(originals, expected):
        nominal, adjusted = planned_send(agenda, original + timedelta(days=5))
        assert nominal.date() == original
        assert adjusted.weekday() == target_weekday
        assert adjusted.hour == 9
        assert adjusted.tzinfo == ZoneInfo(agenda.unit.timezone)
        if original.weekday() in days:
            assert adjusted == nominal
        else:
            direction = policy[str(original.weekday())]
            assert (adjusted < nominal) == (direction == "previous")


@pytest.mark.django_db
def test_shifted_reminders_keep_friday_and_monday_groups_separate(configured):
    _, agenda, _ = configured
    agenda.send_weekdays = [0, 1, 2, 3, 4]
    agenda.blocked_day_policy = {"5": "previous", "6": "next"}
    agenda.horizon_days = 20
    agenda.save()
    targets = {NOW.date() + timedelta(days=offset + 5) for offset in (4, 5, 6, 7)}
    sync_agenda(agenda.pk, NOW, lambda a, day: [row(day)] if day in targets else [])
    messages = list(
        Message.objects.filter(rule=agenda.rule).order_by("appointment__scheduled_at")
    )
    assert len(messages) == 4
    assert len({m.group_id for m in messages}) == 4
    assert [
        m.scheduled_for.astimezone(ZoneInfo(agenda.unit.timezone)).date()
        for m in messages
    ] == [NOW.date() + timedelta(days=d) for d in (4, 4, 7, 7)]
    assert (
        messages[0].snapshot["send_calendar"]["original_send_at"]
        == messages[0].snapshot["send_calendar"]["adjusted_send_at"]
    )
    assert (
        messages[1].snapshot["send_calendar"]["original_send_at"]
        != messages[1].snapshot["send_calendar"]["adjusted_send_at"]
    )
    assert not any(m.attempt_count for m in messages)


@pytest.mark.django_db
def test_send_calendar_blocks_post_appointment_reminder(configured):
    from responses.models import Issue

    setup, agenda, payload = configured
    agenda.days_before = 0
    agenda.send_weekdays = [0, 1, 2, 3, 4]
    agenda.blocked_day_policy = {"6": "next"}
    agenda.save()
    sunday = NOW.date() + timedelta(days=6)
    sync_agenda(agenda.pk, NOW, lambda a, day: [row(day)] if day == sunday else [])
    message = Message.objects.get(rule=agenda.rule)
    assert message.state == "blocked"
    assert message.error_code == "send_calendar_after_appointment"
    assert (
        Issue.objects.filter(
            message=message, category="send_calendar_after_appointment"
        ).count()
        == 1
    )
    assert message.attempt_count == 0

    result = setup["client"].post(
        "/api/v1/oracle-agendas/configure/?unit=ame",
        {**payload, "id": agenda.pk, "version": agenda.version},
        format="json",
        HTTP_IDEMPOTENCY_KEY="correct-calendar",
    )
    assert result.status_code == 200
    assert not Issue.objects.filter(
        message=message,
        category="send_calendar_after_appointment",
        resolved_at__isnull=True,
    ).exists()
    message.refresh_from_db()
    assert message.state == "cancelled"


@pytest.mark.django_db
def test_calendar_validation_and_configuration_roundtrip(configured):
    setup, agenda, payload = configured
    base = {**payload, "id": agenda.pk, "version": agenda.version}
    url = "/api/v1/oracle-agendas/configure/?unit=ame"
    for i, invalid in enumerate(
        [
            {"send_weekdays": []},
            {"send_weekdays": [0, 0]},
            {"send_weekdays": [7]},
            {"blocked_day_policy": {"6": "invalid"}},
        ]
    ):
        response = setup["client"].post(
            url,
            {**base, **invalid},
            format="json",
            HTTP_IDEMPOTENCY_KEY="invalid-calendar-" + str(i),
        )
        assert response.status_code == 400
    response = setup["client"].post(
        url,
        {
            **base,
            "send_weekdays": [0, 1, 2, 3, 4],
            "blocked_day_policy": {"5": "previous", "6": "next"},
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="save-calendar",
    )
    assert response.status_code == 200, response.data
    config = response.data["configuration"]
    assert config["send_weekdays"] == [0, 1, 2, 3, 4]
    assert config["blocked_day_policy"] == {"5": "previous", "6": "next"}
    agenda.refresh_from_db()
    assert agenda.rule.weekdays == [0, 1, 2, 3, 4]
    assert not agenda.rule.enabled

    # Older clients that omit calendar fields must preserve the saved calendar.
    response = setup["client"].post(
        url,
        {**base, "version": agenda.version},
        format="json",
        HTTP_IDEMPOTENCY_KEY="keep-calendar",
    )
    assert response.status_code == 200
    assert response.data["configuration"]["send_weekdays"] == [0, 1, 2, 3, 4]
    assert response.data["configuration"]["blocked_day_policy"] == {
        "5": "previous",
        "6": "next",
    }
