from datetime import timedelta

import pytest
from messaging.models import Message
from responses.models import Issue
from responses.services import mark_no_response


@pytest.mark.parametrize("kind", ["consultation", "exam", "lab"])
def test_complete_simulated_workflow(setup, kind):
    from scheduling.models import Rule

    s = setup
    if kind != "consultation":
        Rule.objects.create(
            unit=s["unit"],
            code=kind,
            name=kind,
            kind=kind,
            days_before=7,
            send_time=s["rule"].send_time,
            weekdays=s["rule"].weekdays,
            template=s["template"],
        )
    create = s["client"].post(
        "/api/v1/tests/appointments/", {"phone": "5511999990001", "kind": kind}, format="json"
    )
    assert create.status_code == 201
    message_id = create.json()["id"]
    sent = s["client"].post("/api/v1/tests/process/", {"message_id": message_id}, format="json")
    assert sent.status_code == 200 and sent.json()["state"] == "accepted"
    for event in ["delivered", "read", "confirmed"]:
        result = s["client"].post(f"/api/v1/messages/{message_id}/simulate/", {"event": event}, format="json")
        assert result.status_code == 200
    message = Message.objects.get(pk=message_id)
    assert message.state == "read" and message.response_state == "confirmed"
    assert s["client"].get("/api/v1/indicators/").json()["confirmed"] == 1


def test_free_response_can_be_manually_resolved_and_audited(setup):
    from core.models import Audit
    from messaging.services import dispatch

    s = setup
    dispatch(s["message"].pk)
    result = s["client"].post(
        f"/api/v1/messages/{s['message'].pk}/simulate/", {"event": "review"}, format="json"
    )
    assert result.status_code == 200
    issue = Issue.objects.get(category="reply_review")
    result = s["client"].post(
        f"/api/v1/issues/{issue.pk}/resolve/",
        {"resolution": "Contato conferido pela equipe.", "classification": "confirmed"},
        format="json",
    )
    assert result.status_code == 200
    s["message"].refresh_from_db()
    assert s["message"].response_state == "confirmed"
    assert Audit.objects.filter(actor=s["user"], action="issue.resolved").exists()


def test_no_response_is_not_created_after_appointment(setup):
    s = setup
    message = s["message"]
    message.state = "delivered"
    message.response_state = "pending"
    message.delivered_at = s["now"] - timedelta(days=9)
    message.save()
    assert mark_no_response(s["now"] + timedelta(days=8)) == 0


def test_dashboard_delivery_card_matches_filtered_list(setup):
    from messaging.services import dispatch
    from responses.services import apply_status, store_event

    s = setup
    message = dispatch(s["message"].pk)
    apply_status(store_event("simulated", message.provider_id, "read", int(s["now"].timestamp()), {}))
    count = s["client"].get("/api/v1/messages/?state=delivered_or_read").json()["count"]
    assert count == s["client"].get("/api/v1/indicators/").json()["delivered"] == 1


def test_repeated_webhook_cannot_resolve_another_unit(setup, settings):
    from core.models import Unit
    from messaging.services import dispatch
    from responses.services import apply_reply, store_event

    s = setup
    message = dispatch(s["message"].pk)
    other = Unit.objects.create(slug="other", name="Other")
    event = store_event(
        "simulated",
        "reply.other-unit",
        "reply",
        int(s["now"].timestamp()),
        {"sender": message.recipient, "text": "Sim", "context_id": message.provider_id},
    )
    apply_reply(event, other)
    message.refresh_from_db()
    assert message.response_state == "pending"


def test_unvalidated_template_does_not_send(setup):
    from messaging.services import dispatch

    s = setup
    s["template"].approved_for_test = False
    s["template"].save()
    result = dispatch(s["message"].pk)
    assert result.state == "blocked" and result.error_code == "template_not_validated"
