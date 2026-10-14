import hashlib
import hmac
import json
from unittest.mock import MagicMock, patch

from django.test import Client
from messaging.services import dispatch
from responses.models import Reply
from scheduling.connectors import OracleSource


def test_webhook_signature_and_actual_payload(setup, settings):
    s = setup
    settings.META_APP_SECRET = "test-secret"
    settings.META_PHONE_NUMBER_ID = "phone-test"
    message = dispatch(s["message"].pk)
    message.channel_id = "phone-test"
    message.save()
    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {
                                "phone_number_id": "phone-test",
                                "display_phone_number": "551134260001",
                            },
                            "contacts": [
                                {"wa_id": message.recipient, "profile": {"name": "Andressa Fictícia"}}
                            ],
                            "messages": [
                                {
                                    "id": "incoming-1",
                                    "from": message.recipient,
                                    "timestamp": str(int(s["now"].timestamp())),
                                    "type": "text",
                                    "text": {"body": "Sim"},
                                    "context": {"id": message.provider_id},
                                }
                            ],
                        }
                    }
                ]
            }
        ],
    }
    body = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()
    client = Client()
    assert client.post("/webhooks/whatsapp/", body, content_type="application/json").status_code == 403
    for _ in range(2):
        assert (
            client.post(
                "/webhooks/whatsapp/",
                body,
                content_type="application/json",
                HTTP_X_HUB_SIGNATURE_256=signature,
            ).status_code
            == 200
        )
    assert Reply.objects.count() == 1
    message.refresh_from_db()
    assert message.response_state == "confirmed"
    assert message.snapshot["sender_phone"] == "551134260001"
    result = s["client"].get(f"/api/v1/appointments/{s['appointment'].pk}/communications/?unit=ame")
    received = result.data["results"][0]["responses"][0]
    assert received["responded_by"] == "Andressa Fictícia"
    assert received["sender"] == message.recipient
    assert received["text"] == "Sim"


def test_webhook_challenge_requires_secret(settings):
    settings.META_VERIFY_TOKEN = "verify-test"
    client = Client()
    assert (
        client.get(
            "/webhooks/whatsapp/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123"
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/webhooks/whatsapp/?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=123"
        ).content
        == b"123"
    )


def test_login_requires_csrf(setup):
    client = Client(enforce_csrf_checks=True)
    assert (
        client.post(
            "/api/v1/auth/login/", {"username": "admin", "password": "Test-Password-2026!"}
        ).status_code
        == 403
    )
    token = client.get("/api/v1/auth/csrf/").json()["csrfToken"]
    assert (
        client.post(
            "/api/v1/auth/login/",
            {"username": "admin", "password": "Test-Password-2026!"},
            HTTP_X_CSRFTOKEN=token,
        ).status_code
        == 200
    )


def test_oracle_connector_enforces_readonly_and_rollback(settings, db):
    from datetime import date

    settings.ORACLE_DSN, settings.ORACLE_USER, settings.ORACLE_PASSWORD = "dsn", "readonly", "secret"
    connection = MagicMock()
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.description = [("CD_AGENDA",)]
    cursor.__iter__.return_value = iter([])
    with patch("oracledb.connect") as connect:
        connect.return_value.__enter__.return_value = connection
        assert OracleSource().fetch("consultation", date(2026, 10, 19), "America/Sao_Paulo") == []
    calls = cursor.execute.call_args_list
    assert calls[0].args == ("SET TRANSACTION READ ONLY",)
    assert "WHERE 1=0" in calls[1].args[0]
    assert "TBL_LOG_MEGA_MSG" in calls[2].args[0]
    assert calls[2].args[1]["target_date"].date() == date(2026, 10, 19)
    connection.rollback.assert_called_once()
