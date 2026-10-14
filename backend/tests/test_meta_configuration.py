import json
from unittest.mock import Mock, patch

import pytest
from core.models import Audit, Membership, Unit
from cryptography.fernet import Fernet
from django.conf import settings as django_settings
from messaging.meta_config import MetaReader, MetaReadError
from messaging.models import Attempt, MetaConfiguration
from messaging.services import dispatch
from operations.models import ActionReceipt

URL = "/api/v1/meta-configuration/"


@pytest.fixture
def configured(setup, settings):
    settings.META_CREDENTIALS_KEY = Fernet.generate_key().decode()
    response = setup["client"].post(
        URL + "configure/",
        {
            "version": 0,
            "waba_id": "12345",
            "phone_number_id": "67890",
            "api_version": "v24.0",
            "access_token": "private-test-token",
            "app_secret": "private-app-secret",
            "verify_token": "private-verify",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="meta-create-config",
    )
    assert response.status_code == 200
    return setup, response.json()


def graph_response(data):
    result = Mock(status_code=200, content=json.dumps(data).encode())
    result.json.return_value = data
    return result


def graph_pages():
    return [
        graph_response({"id": "12345", "name": "Conta da unidade"}),
        graph_response(
            {
                "data": [
                    {"id": "67890", "display_phone_number": "+55 17 0000 0000", "verified_name": "Unidade"}
                ]
            }
        ),
        graph_response(
            {
                "data": [
                    {
                        "id": "111",
                        "name": "lembrete_paciente",
                        "language": "pt_BR",
                        "status": "APPROVED",
                        "category": "UTILITY",
                        "components": [
                            {
                                "type": "BODY",
                                "text": "Olá {{1}}",
                                "example": {"body_text": [["PATIENT-NOT-TO-STORE"]]},
                            }
                        ],
                    }
                ]
            }
        ),
    ]


def test_credentials_encrypted_write_only_and_audit_redacted(configured):
    setup, result = configured
    config = MetaConfiguration.objects.get(unit=setup["unit"])
    assert config.token_ciphertext != "private-test-token"
    assert (
        Fernet(django_settings.META_CREDENTIALS_KEY.encode()).decrypt(config.token_ciphertext.encode())
        == b"private-test-token"
    )
    assert result["has_access_token"] and not result["sending_enabled"]
    response = setup["client"].get(URL)
    stored = json.dumps(list(Audit.objects.values("details"))) + json.dumps(
        list(ActionReceipt.objects.values("result"))
    )
    for secret in ("private-test-token", "private-app-secret", "private-verify", config.token_ciphertext):
        assert secret not in response.content.decode()
        assert secret not in stored


def test_default_is_unsaved_and_scoped(setup):
    response = setup["client"].get(URL)
    assert response.status_code == 200 and response.json()["version"] == 0
    assert not MetaConfiguration.objects.exists()
    Unit.objects.create(slug="other", name="Other")
    assert setup["client"].get(URL + "?unit=other").status_code == 403
    assert (
        setup["client"].post(URL + "validate/?unit=other", {"version": 1}, format="json").status_code == 403
    )
    Membership.objects.filter(user=setup["user"]).update(role="operator")
    assert setup["client"].get(URL).status_code == 403
    assert setup["client"].post(URL + "configure/", {}, format="json").status_code == 403


def test_validate_is_get_only_no_queue_or_template_changes(configured):
    setup, _ = configured
    local = setup["template"]
    before = setup["unit"].paused
    with (
        patch("messaging.meta_config.requests.get", side_effect=graph_pages()) as get,
        patch("requests.post") as post,
    ):
        response = setup["client"].post(
            URL + "validate/", {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="meta-validate-once"
        )
        again = setup["client"].post(
            URL + "validate/", {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="meta-validate-once"
        )
    assert response.status_code == again.status_code == 200
    assert get.call_count == 3
    post.assert_not_called()
    result = response.json()
    assert result["validation_state"] == "valid" and result["version"] == 2
    assert result["templates"][0]["parameters"] == ["1"]
    assert result["templates"][0]["checks"]
    assert "PATIENT-NOT-TO-STORE" not in response.content.decode()
    assert not result["sending_enabled"]
    local.refresh_from_db()
    setup["unit"].refresh_from_db()
    assert local.approved_for_test and local.version == 1
    assert setup["unit"].paused == before
    assert setup["appointment"].messages.count() == 1 and not Attempt.objects.exists()
    for call in get.call_args_list:
        assert call.kwargs["allow_redirects"] is False
        assert "private-test-token" not in call.args[0]
        assert "access_token" not in call.kwargs["params"]


def test_provider_errors_are_redacted(configured):
    setup, _ = configured
    response = graph_response(
        {"error": {"code": 190, "message": "Echo private-test-token private-app-secret"}}
    )
    response.status_code = 401
    with patch("messaging.meta_config.requests.get", return_value=response):
        result = setup["client"].post(
            URL + "validate/", {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="meta-invalid-token"
        )
    assert result.json()["validation_code"] == "meta_190"
    assert "Echo" not in result.content.decode() and "private-test-token" not in result.content.decode()
    assert result.json()["validation_state"] == "error"


def test_number_must_belong_to_waba(configured):
    setup, _ = configured
    pages = graph_pages()
    pages[1] = graph_response({"data": [{"id": "99999"}]})
    with patch("messaging.meta_config.requests.get", side_effect=pages) as get:
        result = setup["client"].post(
            URL + "validate/", {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="meta-wrong-number"
        )
    assert result.json()["validation_code"] == "phone_not_in_waba"
    assert get.call_count == 2


def test_save_versions_idempotency_and_blank_preserves_token(configured):
    setup, _ = configured
    original = MetaConfiguration.objects.get().token_ciphertext
    body = {
        "version": 1,
        "waba_id": "12345",
        "phone_number_id": "67890",
        "api_version": "v24.0",
        "access_token": "",
    }
    first = setup["client"].post(
        URL + "configure/", body, format="json", HTTP_IDEMPOTENCY_KEY="meta-keep-existing"
    )
    again = setup["client"].post(
        URL + "configure/", body, format="json", HTTP_IDEMPOTENCY_KEY="meta-keep-existing"
    )
    assert first.json() == again.json() and first.json()["version"] == 2
    assert MetaConfiguration.objects.get().token_ciphertext == original
    assert (
        setup["client"]
        .post(URL + "configure/", body, format="json", HTTP_IDEMPOTENCY_KEY="meta-stale-version")
        .status_code
        == 409
    )
    body.update(version=2, clear_secrets=["access_token"])
    cleared = setup["client"].post(
        URL + "configure/", body, format="json", HTTP_IDEMPOTENCY_KEY="meta-clear-secret"
    )
    assert not cleared.json()["has_access_token"] and not MetaConfiguration.objects.get().token_ciphertext
    assert (
        setup["client"]
        .post(URL + "validate/", {"version": 3}, format="json", HTTP_IDEMPOTENCY_KEY="meta-missing-token")
        .status_code
        == 400
    )


def test_pagination_never_follows_next_url(configured):
    first = graph_response(
        {
            "data": [{"id": "1"}],
            "paging": {
                "next": "https://evil.invalid/?access_token=secret",
                "cursors": {"after": "safe-cursor"},
            },
        }
    )
    second = graph_response({"data": [{"id": "2"}]})
    with patch("messaging.meta_config.requests.get", side_effect=[first, second]) as get:
        rows = MetaReader(MetaConfiguration.objects.get()).collection("message_templates", "id")
    assert len(rows) == 2
    assert all(c.args[0].startswith("https://graph.facebook.com/v24.0/12345/") for c in get.call_args_list)
    assert get.call_args_list[1].kwargs["params"]["after"] == "safe-cursor"


def test_failed_validation_preserves_previous_catalog(configured):
    setup, _ = configured
    with patch("messaging.meta_config.requests.get", side_effect=graph_pages()):
        setup["client"].post(
            URL + "validate/", {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="meta-first-success"
        )
    with patch("messaging.meta_config.MetaReader.validate", side_effect=MetaReadError("connection_failed")):
        response = setup["client"].post(
            URL + "validate/", {"version": 2}, format="json", HTTP_IDEMPOTENCY_KEY="meta-later-failure"
        )
    assert response.json()["validation_state"] == "error" and response.json()["templates_synced_at"]
    assert len(response.json()["templates"]) == 1


def test_send_blocked_before_attempt_even_in_meta_test_mode(configured, settings):
    setup, _ = configured
    settings.SEND_MODE = "meta_test"
    with patch("requests.post") as post:
        message = dispatch(setup["message"].pk)
    post.assert_not_called()
    assert message.state == "blocked" and message.error_code == "meta_sending_disabled"
    assert not Attempt.objects.exists()


def test_authorized_second_unit_has_independent_configuration(configured):
    setup, _ = configured
    other = Unit.objects.create(slug="second", name="Segunda unidade")
    Membership.objects.create(user=setup["user"], unit=other, role="admin")
    response = setup["client"].get(URL + "?unit=second")
    assert response.json()["version"] == 0 and not response.json()["has_access_token"]
    response = setup["client"].post(
        URL + "configure/?unit=second",
        {
            "version": 0,
            "waba_id": "777",
            "phone_number_id": "888",
            "api_version": "v24.0",
            "access_token": "different-private-token",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="meta-create-config",
    )
    assert response.status_code == 200 and response.json()["waba_id"] == "777"
    assert setup["client"].get(URL).json()["waba_id"] == "12345"
    assert MetaConfiguration.objects.count() == 2


def test_invalid_key_and_missing_idempotency_do_not_persist(setup, settings):
    settings.META_CREDENTIALS_KEY = ""
    body = {
        "version": 0,
        "waba_id": "123",
        "phone_number_id": "456",
        "api_version": "v24.0",
        "access_token": "private-token",
    }
    response = setup["client"].post(
        URL + "configure/", body, format="json", HTTP_IDEMPOTENCY_KEY="meta-invalid-key"
    )
    assert response.status_code == 400 and not MetaConfiguration.objects.exists()
    assert "private-token" not in response.content.decode()
    body.pop("access_token")
    assert setup["client"].post(URL + "configure/", body, format="json").status_code == 400
    assert not MetaConfiguration.objects.exists()


def test_catalog_comparison_detects_matching_template(configured):
    setup, _ = configured
    pages = graph_pages()
    template = pages[2].json.return_value["data"][0]
    template["components"][0]["text"] = setup["template"].body
    pages[2] = graph_response({"data": [template]})
    with patch("messaging.meta_config.requests.get", side_effect=pages):
        response = setup["client"].post(
            URL + "validate/", {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="meta-matching-template"
        )
    assert response.status_code == 200
    assert response.json()["templates"][0]["checks"] == []
