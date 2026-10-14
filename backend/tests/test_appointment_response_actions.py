from datetime import timedelta
from uuid import uuid4

import pytest
from core.models import Membership, Unit
from messaging.models import Message, ProviderEvent
from operations.models import Case
from responses.models import Reply


def record(setup, **changes):
    case = Case.objects.get(event__appointment=setup["appointment"])
    data = {
        "action": "record_response",
        "version": case.version,
        "text": "Contato verificado pela equipe.",
        "outcome": "confirmed",
        "channel": "phone",
        "interlocutor": "Andressa Fictícia",
        "phone": setup["message"].recipient,
        "occurred_at": setup["now"].isoformat(),
        **changes,
    }
    return setup["client"].post(
        f"/api/v1/cases/{case.pk}/act/?unit=ame", data, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4())
    )


@pytest.mark.parametrize("channel,outcome", [("phone", "confirmed"), ("whatsapp", "declined")])
def test_manual_response_has_person_contact_time_channel_without_sending(setup, channel, outcome):
    message = setup["message"]
    message.snapshot = {**message.snapshot, "sender_phone": "551134260001"}
    message.save()
    result = record(setup, channel=channel, outcome=outcome)
    assert result.status_code == 200, result.data
    message.refresh_from_db()
    assert message.response_state == outcome
    assert Message.objects.count() == 1 and not message.attempts.exists()
    assert Reply.objects.count() == ProviderEvent.objects.count() == 0
    response = setup["client"].get(f"/api/v1/appointments/{setup['appointment'].pk}/communications/?unit=ame")
    assert response.status_code == 200
    sent = response.data["results"][0]
    assert sent["sender_phone"] == "551134260001" and sent["body"] == message.body
    assert sent["responses"] == []
    manual = response.data["manual_responses"][0]
    assert manual["interlocutor"] == "Andressa Fictícia"
    assert manual["actor_name"] == "admin" and manual["channel"] == channel
    assert manual["data"]["phone"] == message.recipient
    assert manual["data"]["message_id"] == str(message.pk)
    assert record(setup).status_code == 409


@pytest.mark.parametrize(
    "changes",
    [{"interlocutor": ""}, {"phone": "5511888880000"}, {"outcome": "wrong_person"}, {"channel": "panel"}],
)
def test_manual_response_requires_correct_contact_person_and_channel(setup, changes):
    assert record(setup, **changes).status_code == 400
    case = Case.objects.get(event__appointment=setup["appointment"])
    assert case.response_state == "pending" and not case.outcome


def test_future_response_rejected_and_viewer_cannot_record(setup):
    assert record(setup, occurred_at=(setup["now"] + timedelta(days=1)).isoformat()).status_code == 400
    Membership.objects.filter(user=setup["user"]).update(role="viewer")
    assert record(setup).status_code == 403


def test_communications_are_unit_scoped_and_channel_id_is_not_a_phone(setup):
    setup["message"].channel_id = "provider-resource-123"
    setup["message"].save()
    unit = Unit.objects.create(slug="other", name="Outra")
    Membership.objects.create(user=setup["user"], unit=unit, role="viewer")
    path = f"/api/v1/appointments/{setup['appointment'].pk}/communications/"
    assert setup["client"].get(path + "?unit=other").status_code == 404
    response = setup["client"].get(path + "?unit=ame")
    assert response.data["results"][0]["sender_phone"] == ""
