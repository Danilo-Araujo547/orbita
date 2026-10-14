from dataclasses import replace
from datetime import datetime, timedelta
from unittest.mock import Mock
from zoneinfo import ZoneInfo

import pytest
from core.models import Audit
from django.db import connection
from messaging.models import Message
from messaging.services import dispatch, retry_individual
from messaging.transports import SendError, SimulatedTransport
from responses.models import Issue, Reply
from responses.services import apply_reply, apply_status, classify, mark_no_response, store_event
from scheduling.connectors import normalize_phone, normalize_row
from scheduling.models import Appointment, ImportRun
from scheduling.services import import_rule, queue_appointment, upsert_appointment


def test_import_and_queue_are_idempotent(setup):
    s = setup
    first = upsert_appointment(s["unit"], s["row"])
    queue_appointment(first, s["rule"], s["now"])
    assert Appointment.objects.count() == Message.objects.count() == 1
    assert first.revision == 1


@pytest.mark.parametrize("kind", ["consultation", "exam", "lab"])
def test_three_kinds_normalize_separate_fields(kind):
    row = {
        "CD_AGENDA": 123,
        "DTA_AGENDA": datetime(2026, 10, 19),
        "PACIENTE": "FICTÍCIO",
        "CROSS": "FICTÍCIO (01/01/2000)",
        "CELULAR": "17999990001",
        "HORA_MARCADA": "10:30",
        "HORA_CHEGADA": "10:15",
        "ESPECIALIDADE": "TESTE",
        "TIPO_CONSULTA": "DA SUA CONSULTA",
        "MENSAGEM": "ignore",
    }
    data = normalize_row(row, kind, "America/Sao_Paulo")
    assert data.patient == row["CROSS"]
    assert data.scheduled_at.utcoffset() == timedelta(hours=-3)
    assert not data.synthetic


@pytest.mark.parametrize("phone", ["", "123", "00000000000", "55119999999999999"])
def test_bad_phone_rejected(phone):
    with pytest.raises(ValueError):
        normalize_phone(phone)


def test_phone_normalization():
    assert normalize_phone("(17) 99999-0001") == "5517999990001"


def test_template_parameters_have_correct_order(setup):
    message = setup["message"]
    assert message.parameters[:3] == ["PACIENTE FICTÍCIO", "DA SUA CONSULTA", "CONSULTA TESTE"]
    assert message.parameters[4] == "09:00"
    assert "{{" not in message.body


@pytest.mark.parametrize("change", ["phone", "procedure", "scheduled_at", "arrival_time"])
def test_changed_appointment_invalidates_pending_message(setup, change):
    s = setup
    value = s["row"].scheduled_at + timedelta(days=1) if change == "scheduled_at" else "ALTERADO"
    changed = upsert_appointment(s["unit"], replace(s["row"], **{change: value}))
    s["message"].refresh_from_db()
    assert changed.revision == 2
    assert s["message"].state == "cancelled"


def test_import_window_weekdays_and_duplicate_run(setup):
    s = setup
    monday = datetime(2026, 10, 12, 7, 15, tzinfo=ZoneInfo("America/Sao_Paulo"))
    row = replace(s["row"], scheduled_at=monday + timedelta(days=7))
    source = Mock()
    source.fetch.return_value = [row]
    assert import_rule(s["rule"], source, monday - timedelta(minutes=1)) is None
    run = import_rule(s["rule"], source, monday)
    assert run.status == "completed"
    import_rule(s["rule"], source, monday + timedelta(hours=1))
    assert source.fetch.call_count == 1
    assert import_rule(s["rule"], source, monday - timedelta(days=1)) is None


def test_failed_import_is_visible_without_sensitive_exception(setup):
    s = setup
    source = Mock()
    source.fetch.side_effect = RuntimeError("secret=password; patient=real")
    monday = datetime(2026, 10, 12, 8, tzinfo=ZoneInfo("America/Sao_Paulo"))
    run = import_rule(s["rule"], source, monday)
    assert run.status == "failed" and run.error == "RuntimeError"


def test_real_import_never_enters_send_queue(setup):
    s = setup
    row = replace(s["row"], source="oracle", synthetic=False)
    appointment = upsert_appointment(s["unit"], row)
    message = queue_appointment(appointment, s["rule"], s["now"])
    assert message.state == "preview"
    Message.objects.filter(pk=message.pk).update(state="queued")
    sent = dispatch(message.pk)
    assert sent.state == "blocked" and sent.error_code == "real_appointment_blocked"


def test_dispatch_does_not_duplicate(setup):
    transport = Mock(channel_id="simulated")
    transport.send.return_value = "sim.unique"
    dispatch(setup["message"].pk, transport=transport)
    dispatch(setup["message"].pk, transport=transport)
    assert transport.send.call_count == 1
    assert setup["message"].attempts.count() == 1


def test_pause_keeps_queue_without_sending(setup):
    s = setup
    s["unit"].paused = True
    s["unit"].save()
    transport = Mock(channel_id="simulated")
    assert dispatch(s["message"].pk, transport=transport).state == "queued"
    transport.send.assert_not_called()


def test_non_allowlisted_recipient_blocked(setup, settings):
    settings.TEST_RECIPIENTS = ()
    message = dispatch(setup["message"].pk)
    assert message.error_code == "recipient_not_allowed" and message.attempt_count == 0


def test_expired_message_never_sends(setup):
    message = dispatch(setup["message"].pk, now=setup["message"].expires_at)
    assert message.state == "expired" and message.attempt_count == 0


def test_unknown_result_never_retried(setup):
    transport = Mock(channel_id="simulated")
    transport.send.side_effect = SendError("timeout", uncertain=True)
    message = dispatch(setup["message"].pk, transport=transport)
    assert message.state == "uncertain"
    dispatch(message.pk, transport=transport)
    assert transport.send.call_count == 1
    with pytest.raises(ValueError):
        retry_individual(message, setup["user"])


def test_known_transient_failure_uses_bounded_backoff(setup):
    transport = Mock(channel_id="simulated")
    transport.send.side_effect = SendError("rate_limit", transient=True)
    now = setup["now"]
    first = dispatch(setup["message"].pk, transport=transport, now=now)
    assert first.state == "queued" and first.scheduled_for == now + timedelta(minutes=1)
    second = dispatch(first.pk, transport=transport, now=now + timedelta(minutes=1))
    assert second.scheduled_for == now + timedelta(minutes=6)
    third = dispatch(first.pk, transport=transport, now=now + timedelta(minutes=6))
    assert third.state == "failed" and third.attempt_count == 3


def test_claim_survives_worker_crash(setup):
    transport = Mock(channel_id="simulated")
    transport.send.side_effect = KeyboardInterrupt()
    with pytest.raises(KeyboardInterrupt):
        dispatch(setup["message"].pk, transport=transport)
    setup["message"].refresh_from_db()
    assert setup["message"].state == "sending"
    assert setup["message"].attempts.count() == 1


def test_stale_send_is_quarantined(setup):
    from scheduling.tasks import tick

    s = setup
    Message.objects.filter(pk=s["message"].pk).update(
        state="sending", last_attempt_at=s["now"] - timedelta(minutes=3)
    )
    tick()
    s["message"].refresh_from_db()
    assert s["message"].state == "uncertain"


def test_duplicate_out_of_order_status_never_regresses(setup):
    s = setup
    message = dispatch(s["message"].pk)
    stamp = int(s["now"].timestamp())
    read = store_event("simulated", message.provider_id, "read", stamp, {})
    apply_status(read)
    apply_status(read)
    apply_status(store_event("simulated", message.provider_id, "sent", stamp - 60, {}))
    apply_status(store_event("simulated", message.provider_id, "failed", stamp + 1, {"code": 131026}))
    message.refresh_from_db()
    assert message.state == "read"
    assert message.delivered_at is not None


def test_status_before_send_commit_is_reconciled(setup):
    s = setup
    event = store_event("simulated", "sim.race", "delivered", int(s["now"].timestamp()), {})
    apply_status(event)
    transport = Mock(channel_id="simulated")
    transport.send.return_value = "sim.race"
    dispatch(s["message"].pk, transport=transport)
    s["message"].refresh_from_db()
    assert s["message"].state == "delivered"


@pytest.mark.parametrize(
    "text,expected",
    [("SIM", "confirmed"), ("NÃO", "declined"), ("Não sei se posso", "review"), ("Talvez", "review")],
)
def test_only_unambiguous_responses_classified(text, expected):
    assert classify(text) == expected


def test_explicit_reply_links_and_deduplicates(setup):
    s = setup
    message = dispatch(s["message"].pk)
    event = store_event(
        "simulated",
        "reply.1",
        "reply",
        int(s["now"].timestamp()),
        {"sender": message.recipient, "text": "Sim", "context_id": message.provider_id},
    )
    apply_reply(event, s["unit"])
    apply_reply(event, s["unit"])
    message.refresh_from_db()
    assert Reply.objects.count() == 1 and message.response_state == "confirmed"


def test_shared_number_is_not_auto_assigned(setup):
    s = setup
    # This test needs both reminders already sent; pacing is tested separately.
    s["message"].group.delay_seconds = 0
    s["message"].group.save(update_fields=["delay_seconds"])
    first = dispatch(s["message"].pk)
    second = upsert_appointment(s["unit"], replace(s["row"], external_id="TEST-2"))
    second_message = queue_appointment(second, s["rule"], s["now"])
    dispatch(second_message.pk)
    event = store_event(
        "simulated",
        "reply.ambiguous",
        "reply",
        int(s["now"].timestamp()),
        {"sender": first.recipient, "text": "Sim"},
    )
    apply_reply(event, s["unit"])
    assert Reply.objects.get().message is None
    assert Issue.objects.filter(category="unlinked_reply").exists()


def test_unknown_context_does_not_fallback(setup):
    s = setup
    first = dispatch(s["message"].pk)
    event = store_event(
        "simulated",
        "reply.unknown",
        "reply",
        int(s["now"].timestamp()),
        {"sender": first.recipient, "text": "Sim", "context_id": "wrong"},
    )
    apply_reply(event, s["unit"])
    assert Reply.objects.get().message is None


def test_no_response_requires_delivery_and_unexpired_appointment(setup):
    s = setup
    message = dispatch(s["message"].pk)
    assert mark_no_response(s["now"] + timedelta(hours=25)) == 0
    apply_status(store_event("simulated", message.provider_id, "delivered", int(s["now"].timestamp()), {}))
    assert mark_no_response(s["now"] + timedelta(hours=23)) == 0
    assert mark_no_response(s["now"] + timedelta(hours=25)) == 1
    assert mark_no_response(s["now"] + timedelta(hours=26)) == 0
    message.refresh_from_db()
    assert message.response_state == "no_response"


def test_viewer_cannot_pause_or_send(setup):
    s = setup
    from core.models import Membership

    Membership.objects.filter(user=s["user"]).update(role="viewer")
    assert s["client"].post("/api/v1/control/", {"paused": True}, format="json").status_code == 403
    assert (
        s["client"]
        .post("/api/v1/tests/process/", {"message_id": str(s["message"].pk)}, format="json")
        .status_code
        == 403
    )


def test_membership_isolates_units(setup):
    from core.models import Unit

    Unit.objects.create(slug="other", name="Other")
    assert setup["client"].get("/api/v1/messages/?unit=other").status_code == 403


def test_indicators_match_lists(setup):
    s = setup
    result = s["client"].get("/api/v1/indicators/").json()
    assert result["appointments"] == s["client"].get("/api/v1/appointments/").json()["count"]
    assert result["messages"] == s["client"].get("/api/v1/messages/").json()["count"]


def test_rule_change_versions_and_invalidates(setup):
    s = setup
    result = s["client"].post(f"/api/v1/rules/{s['rule'].pk}/configure/", {"days_before": 4}, format="json")
    assert result.status_code == 200 and result.json()["version"] == 2
    s["message"].refresh_from_db()
    assert s["message"].state == "cancelled"
    assert Audit.objects.filter(action="rule.changed").exists()


def test_invalid_rule_and_template_rejected(setup):
    s = setup
    assert (
        s["client"]
        .post(f"/api/v1/rules/{s['rule'].pk}/configure/", {"weekdays": [7]}, format="json")
        .status_code
        == 400
    )
    assert (
        s["client"]
        .post(f"/api/v1/templates/{s['template'].pk}/configure/", {"fields": ["password"]}, format="json")
        .status_code
        == 400
    )


def test_manual_action_respects_allowlist(setup, settings):
    settings.TEST_RECIPIENTS = ()
    result = setup["client"].post("/api/v1/tests/appointments/", {"phone": "5511999990001"}, format="json")
    assert result.status_code == 400


def test_oracle_failure_does_not_cancel_existing_appointments(setup):
    s = setup
    source = Mock()
    source.fetch.return_value = []
    monday = datetime(2026, 10, 12, 8, tzinfo=ZoneInfo("America/Sao_Paulo"))
    import_rule(s["rule"], source, monday)
    s["appointment"].refresh_from_db()
    assert s["appointment"].status == "scheduled"


def test_no_backfill_of_previous_days(setup):
    source = Mock()
    source.fetch.return_value = []
    monday = datetime(2026, 10, 12, 8, tzinfo=ZoneInfo("America/Sao_Paulo"))
    import_rule(setup["rule"], source, monday)
    assert ImportRun.objects.get().run_date == monday.date()


@pytest.mark.skipif(connection.vendor != "postgresql", reason="Requires PostgreSQL; execute in Docker")
@pytest.mark.django_db(transaction=True)
def test_postgres_concurrent_dispatch_reserves_once(setup):
    from concurrent.futures import ThreadPoolExecutor

    from django.db import close_old_connections, connections

    def work():
        close_old_connections()
        try:
            result = dispatch(setup["message"].pk, transport=SimulatedTransport())
            return result.pk
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: work(), range(2)))
    assert setup["message"].attempts.count() == 1
