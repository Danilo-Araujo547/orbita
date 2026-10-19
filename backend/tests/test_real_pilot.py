from dataclasses import replace
from datetime import timedelta
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
import requests
from cryptography.fernet import Fernet
from django.utils import timezone
from messaging.meta_config import cipher
from messaging.models import Attempt, MetaConfiguration
from messaging.pilot import CONFIRMATION_FLOW_ID, prepare
from messaging.services import dispatch, send_guard
from messaging.tasks import dispatch_manual_due
from scheduling.services import queue_appointment, upsert_appointment


@pytest.fixture
def pilot(setup, settings):
    settings.SEND_MODE = "meta_test"
    settings.META_REAL_ENABLED = True
    settings.META_UNIT_SLUG = "ame"
    settings.META_PILOT_TEMPLATE = "pilot"
    settings.META_PILOT_DAILY_LIMIT = 30
    settings.META_CREDENTIALS_KEY = Fernet.generate_key().decode()
    MetaConfiguration.objects.create(
        unit=setup["unit"],
        waba_id="123",
        phone_number_id="456",
        token_ciphertext=cipher().encrypt(b"secret-token").decode(),
        validation_state="valid",
        checked_at=timezone.now(),
        templates=[
            {
                "id": "789",
                "name": "pilot",
                "language": "pt_BR",
                "status": "APPROVED",
                "components": [
                    {"type": "BODY", "text": "Teste de confirmação"},
                    {"type": "BUTTONS", "buttons": [{"type": "FLOW", "text": "Confirmar", "flow_id": 1234}]},
                ],
            }
        ],
    )
    return setup


def release(s):
    return s["client"].post(
        f"/api/v1/appointment-groups/{s['message'].group_id}/dispatch-now/?unit=ame",
        {"version": 1, "delay_seconds": 0},
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid4()),
    )


def result(status=200, data=None):
    response = Mock(status_code=status)
    response.json.return_value = data if data is not None else {"messages": [{"id": "wamid.real-test"}]}
    return response


def test_pilot_requires_release_and_uses_exact_template(pilot):
    s = pilot
    assert send_guard(s["message"]) == "group_release_required"
    with patch("messaging.transports.requests.post", return_value=result()) as post:
        dispatch_manual_due()
        post.assert_not_called()
        response = release(s)
        assert response.status_code == 200, response.data
        assert response.data["dispatch_mode"] == "real"
        s["rule"].enabled = False
        s["rule"].save()
        dispatch_manual_due()
        dispatch_manual_due()
    assert post.call_count == 1
    call = post.call_args
    assert call.args[0] == "https://graph.facebook.com/v24.0/456/messages"
    assert call.kwargs["json"]["to"] == s["message"].recipient
    template = call.kwargs["json"]["template"]
    assert template["name"] == "pilot" and template["language"]["code"] == "pt_BR"
    assert template["components"][0]["parameters"][0]["action"]["flow_token"] == str(s["message"].pk)
    assert call.kwargs["allow_redirects"] is False
    s["message"].refresh_from_db()
    assert s["message"].channel_id == "456" and s["message"].provider_id == "wamid.real-test"


def test_pilot_pause_recipient_real_data_and_configuration_changes(pilot):
    s = pilot
    s["unit"].paused = True
    s["unit"].save()
    assert release(s).status_code == 400
    s["unit"].paused = False
    s["unit"].save()
    s["message"].recipient = "5511999990002"
    s["message"].save()
    assert release(s).status_code == 400
    s["message"].recipient = s["row"].phone
    s["message"].save()
    assert release(s).status_code == 200
    MetaConfiguration.objects.filter(unit=s["unit"]).update(version=2)
    with patch("requests.post") as post:
        message = dispatch(s["message"].pk)
    assert message.error_code == "meta_configuration_changed"
    post.assert_not_called()
    assert not Attempt.objects.exists()


def test_confirmation_flow_receives_initial_screen_data_from_appointment(pilot):
    config = MetaConfiguration.objects.get(unit=pilot["unit"])
    config.templates[0]["components"][1]["buttons"][0]["flow_id"] = int(CONFIRMATION_FLOW_ID)
    config.save(update_fields=["templates"])
    appointment = pilot["appointment"]
    appointment.professional = "Profissional fictício"
    appointment.save(update_fields=["professional"])
    assert release(pilot).status_code == 200
    with patch("messaging.transports.requests.post", return_value=result()) as post:
        dispatch_manual_due()
    action = post.call_args.kwargs["json"]["template"]["components"][0]["parameters"][0]["action"]
    assert action == {
        "flow_token": str(pilot["message"].pk),
        "flow_action_data": {
            "medico": "Profissional fictício",
            "exame": appointment.procedure,
            "error_message": "",
        },
    }


def test_confirmation_flow_refuses_missing_initial_data(pilot):
    config = MetaConfiguration.objects.get(unit=pilot["unit"])
    config.templates[0]["components"][1]["buttons"][0]["flow_id"] = int(CONFIRMATION_FLOW_ID)
    config.save(update_fields=["templates"])
    assert release(pilot).status_code == 200
    message = pilot["message"]
    message.refresh_from_db()
    message.snapshot.pop("flow_action_data")
    message.save(update_fields=["snapshot"])
    with patch("messaging.transports.requests.post") as post:
        outcome = dispatch(message.pk)
    assert outcome.error_code == "flow_initial_data_missing"
    post.assert_not_called()


@pytest.mark.parametrize("response", [requests.Timeout(), result(503), result(200, {"messages": []})])
def test_uncertain_results_never_automatically_retry(pilot, response):
    assert release(pilot).status_code == 200
    with patch(
        "messaging.transports.requests.post",
        side_effect=response if isinstance(response, Exception) else None,
        return_value=response,
    ) as post:
        dispatch_manual_due()
        dispatch_manual_due()
    pilot["message"].refresh_from_db()
    assert pilot["message"].state == "uncertain" and post.call_count == 1


def test_rejected_request_is_failed_and_daily_limit_enforced(pilot, settings):
    settings.META_PILOT_DAILY_LIMIT = 1
    assert release(pilot).status_code == 200
    with patch(
        "messaging.transports.requests.post", return_value=result(400, {"error": {"code": 131009}})
    ) as post:
        message = dispatch(pilot["message"].pk)
    assert message.state == "failed" and message.error_code == "meta_131009" and post.call_count == 1
    second = upsert_appointment(pilot["unit"], replace(pilot["row"], external_id="SECOND"))
    next_message = queue_appointment(second, pilot["rule"], timezone.now())
    prepare(next_message)
    next_message.snapshot["manual_group_real"] = True
    next_message.save()
    assert send_guard(next_message) == "pilot_daily_limit"


def test_invalid_catalog_or_expired_validation_cannot_release(pilot):
    MetaConfiguration.objects.filter(unit=pilot["unit"]).update(checked_at=timezone.now() - timedelta(days=2))
    assert release(pilot).status_code == 400
    MetaConfiguration.objects.filter(unit=pilot["unit"]).update(checked_at=timezone.now(), templates=[])
    assert release(pilot).status_code == 400


@pytest.mark.django_db(transaction=True)
def test_daily_limit_with_two_postgres_workers(pilot, settings):
    from concurrent.futures import ThreadPoolExecutor

    from django.db import connection, connections

    if connection.vendor != "postgresql":
        pytest.skip("Requires PostgreSQL")
    settings.META_PILOT_DAILY_LIMIT = 1
    s = pilot
    second = upsert_appointment(s["unit"], replace(s["row"], external_id="SECOND"))
    m2 = queue_appointment(second, s["rule"], timezone.now())
    assert release(s).status_code == 200

    def run(pk):
        try:
            return dispatch(pk).state
        finally:
            connections.close_all()

    with patch("messaging.transports.requests.post", return_value=result()) as post:
        with ThreadPoolExecutor(max_workers=2) as pool:
            states = list(pool.map(run, [s["message"].pk, m2.pk]))
    assert post.call_count == 1 and sorted(states) == ["accepted", "blocked"]
