import base64
import hashlib
import hmac
import json
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from django.utils import timezone
from messaging.inbox import pull_once
from messaging.meta_config import cipher
from messaging.models import MetaConfiguration, MetaInboxCursor, ProviderEvent
from messaging.pilot import CONFIRMATION_TEMPLATE_V2
from operations.models import Interaction
from responses.models import Reply
from responses.services import ingest_webhook


@pytest.fixture
def completion(setup, settings):
    settings.META_CREDENTIALS_KEY = Fernet.generate_key().decode()
    s = setup
    message = s["message"]
    message.provider_id = "wamid.flow-outgoing"
    message.channel_id = "456"
    message.state = "accepted"
    message.template_name = CONFIRMATION_TEMPLATE_V2
    message.save()
    MetaConfiguration.objects.create(
        unit=s["unit"],
        waba_id="123",
        phone_number_id="456",
        app_secret_ciphertext=cipher().encrypt(b"test-app-secret").decode(),
        validation_state="valid",
        checked_at=timezone.now(),
    )
    return s


def payload(s, decision="sim", **values):
    flow = {
        "flow_token": str(s["message"].pk),
        "formulario": "orbita_confirmacao_v2",
        "decisao": decision,
        "observacao": "Observação fictícia",
        **values,
    }
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "123",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "metadata": {"phone_number_id": "456"},
                            "contacts": [
                                {"wa_id": s["message"].recipient, "profile": {"name": "Pessoa fictícia"}}
                            ],
                            "messages": [
                                {
                                    "id": "wamid.flow-incoming",
                                    "from": s["message"].recipient,
                                    "timestamp": str(int(s["now"].timestamp())),
                                    "type": "interactive",
                                    "interactive": {
                                        "type": "nfm_reply",
                                        "nfm_reply": {"response_json": json.dumps(flow)},
                                    },
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }


@pytest.mark.parametrize("decision,outcome", [("sim", "confirmed"), ("nao", "declined")])
def test_completion_links_and_records_observation_idempotently(completion, decision, outcome):
    s = completion
    data = payload(s, decision)
    for _ in range(2):
        ingest_webhook(data, unit=s["unit"], channel_id="456", waba_id="123")
    assert Reply.objects.count() == 1
    reply = Reply.objects.get()
    assert reply.message_id == s["message"].pk and reply.classification == outcome
    assert "Observação fictícia" in reply.text
    assert reply.event.data["flow_response"]["flow_token"] == str(s["message"].pk)
    assert Interaction.objects.filter(case=s["message"].case, kind="observation").count() == 1
    s["message"].case.refresh_from_db()
    assert s["message"].case.outcome == outcome


@pytest.mark.parametrize(
    "change", ["wrong_sender", "unknown_token", "conflicting_context", "long_observation", "other_waba"]
)
def test_invalid_flow_never_confirms_another_appointment(completion, change):
    s = completion
    data = payload(s, flow_token=str(uuid4())) if change == "unknown_token" else payload(s)
    message = data["entry"][0]["changes"][0]["value"]["messages"][0]
    if change == "wrong_sender":
        message["from"] = "5511999990002"
    if change == "conflicting_context":
        message["context"] = {"id": "wamid.other"}
    if change == "long_observation":
        message["interactive"]["nfm_reply"]["response_json"] = json.dumps(
            {
                "flow_token": str(s["message"].pk),
                "formulario": "orbita_confirmacao_v2",
                "decisao": "sim",
                "observacao": "x" * 601,
            }
        )
    if change == "other_waba":
        data["entry"][0]["id"] = "999"
    ingest_webhook(data, unit=s["unit"], channel_id="456", waba_id="123")
    assert not Reply.objects.filter(message=s["message"]).exists()
    s["message"].case.refresh_from_db()
    assert not s["message"].case.outcome


def batch(data):
    raw = json.dumps(data).encode()
    return {
        "position": 12,
        "events": [
            {
                "id": 12,
                "signature": "sha256=" + hmac.new(b"test-app-secret", raw, hashlib.sha256).hexdigest(),
                "raw": base64.b64encode(raw).decode(),
            }
        ],
    }


def test_inbox_authenticates_filters_and_advances_cursor(completion):
    s = completion
    data = payload(s)
    value = data["entry"][0]["changes"][0]["value"]
    value["messages"].append(
        {
            "id": "unrelated",
            "from": "5511999999999",
            "timestamp": str(int(s["now"].timestamp())),
            "type": "text",
            "text": {"body": "Não importar esta mensagem"},
        }
    )
    value["statuses"] = [
        {"id": s["message"].provider_id, "status": "delivered", "timestamp": str(int(s["now"].timestamp()))}
    ]

    def reader(query):
        return batch(data) if query["after"] == 0 else {"position": 12, "events": []}

    assert pull_once(s["unit"], reader=reader) == 1
    assert pull_once(s["unit"], reader=reader) == 0
    assert Reply.objects.count() == 1 and not ProviderEvent.objects.filter(provider_id="unrelated").exists()
    assert MetaInboxCursor.objects.get(unit=s["unit"]).position == 12
    s["message"].refresh_from_db()
    assert s["message"].state == "delivered" and s["message"].response_state == "confirmed"


def test_inbox_invalid_signature_rolls_back_and_keeps_cursor(completion):
    data = batch(payload(completion))
    data["events"][0]["signature"] = "sha256=invalid"
    with pytest.raises(ValueError, match="meta_inbox_invalid_signature"):
        pull_once(completion["unit"], reader=lambda query: data)
    assert not Reply.objects.exists()
    assert MetaInboxCursor.objects.get(unit=completion["unit"]).position == 0
