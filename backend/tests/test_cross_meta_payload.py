"""Validate the Meta request body locally; no HTTP request leaves this test."""

import pytest
from django.utils import timezone
from test_cross_controls import messages, sample

from messaging.meta_config import cipher
from messaging.models import Attempt, MetaConfiguration
from messaging.transports import MetaTransport
from operations.cross_controls import set_batch_enabled


@pytest.mark.django_db
def test_cross_body_parameters_are_in_meta_request(setup, settings, monkeypatch):
    batch = sample(setup, phones=False)
    set_batch_enabled(batch, True, batch.version, setup["user"])
    message = messages(batch).first()
    settings.SEND_MODE = "meta_test"
    settings.META_REAL_ENABLED = True
    settings.META_UNIT_SLUG = "ame"
    MetaConfiguration.objects.create(
        unit=setup["unit"],
        phone_number_id="100000000000000",
        validation_state="valid",
        checked_at=timezone.now(),
        token_ciphertext=cipher().encrypt(b"FAKE-TEST-TOKEN").decode(),
        templates=[
            {
                "name": message.template_name,
                "language": "pt_BR",
                "status": "APPROVED",
                "components": [{"type": "BODY", "text": message.template.body}],
            }
        ],
    )
    message.snapshot["components"] = [{"type": "BODY", "text": message.template.body}]
    message.save(update_fields=["snapshot"])
    message.state, message.attempt_count = "sending", 1
    message.save()
    Attempt.objects.create(message=message, number=1)
    captured = {}

    class Result:
        status_code = 200

        def json(self):
            return {"messages": [{"id": "wamid.fake-test-result"}]}

    def fake_post(*args, **kwargs):
        captured.update(kwargs["json"])
        return Result()

    def denied(*args, **kwargs):
        pytest.fail("A real HTTP request must never be made")

    monkeypatch.setattr("requests.sessions.Session.request", denied)
    monkeypatch.setattr("requests.post", fake_post)
    assert MetaTransport().send(message) == "wamid.fake-test-result"
    assert captured["template"]["components"] == [
        {
            "type": "body",
            "parameters": [
                {"type": "text", "text": "PACIENTE FICTÍCIO"},
                {"type": "text", "text": "PROCEDIMENTO TESTE"},
            ],
        }
    ]
