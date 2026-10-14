from datetime import timedelta
from unittest.mock import patch

import pytest
from messaging.services import dispatch
from messaging.transports import MetaTransport, SendError
from responses.models import Issue
from responses.services import apply_reply, apply_status, mark_no_response, store_event


def test_late_confirmation_closes_no_response_issue(setup):
    s = setup
    message = dispatch(s["message"].pk)
    delivered = s["now"] - timedelta(hours=25)
    apply_status(store_event("simulated", message.provider_id, "delivered", int(delivered.timestamp()), {}))
    assert mark_no_response(s["now"]) == 1
    assert not Issue.objects.filter(category="no_response").exists()
    Issue.objects.create(
        unit=s["unit"], message=message, category="no_response", description="Pendência histórica"
    )
    apply_reply(
        store_event(
            "simulated",
            "late-reply",
            "reply",
            int(s["now"].timestamp()),
            {"sender": message.recipient, "text": "Sim", "context_id": message.provider_id},
        ),
        s["unit"],
    )
    issue = Issue.objects.get(category="no_response")
    assert issue.resolved_at is not None
    message.refresh_from_db()
    assert message.response_state == "confirmed"


def test_issue_filters_match_indicator_count(setup):
    s = setup
    Issue.objects.create(unit=s["unit"], message=s["message"], category="test", description="Test")
    for kind in ["consultation", "lab"]:
        count = s["client"].get(f"/api/v1/issues/?kind={kind}").json()["count"]
        indicator = s["client"].get(f"/api/v1/indicators/?kind={kind}").json()["issues"]
        assert count == indicator


def test_meta_transport_remains_disabled_even_with_credentials(setup, settings):
    settings.META_ACCESS_TOKEN = "test-token"
    settings.META_PHONE_NUMBER_ID = "separate-test-number"
    with patch("requests.post") as post, pytest.raises(SendError) as error:
        MetaTransport().send(setup["message"])
    assert error.value.code == "meta_sending_disabled"
    post.assert_not_called()


def test_unsent_message_is_not_waiting_for_patient(setup):
    assert setup["message"].response_state == "not_requested"
