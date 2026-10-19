import json
from unittest.mock import MagicMock, patch

import pytest
from core.models import Audit, Membership, OracleConfiguration, Unit
from core.oracle_credentials import _memory, access, decrypt, derive, lease
from cryptography.fernet import Fernet
from operations.models import ActionReceipt
from scheduling.connectors import OracleSource

URL = "/api/v1/oracle-configuration/"
ADMIN_PASSWORD = "Test-Password-2026!"


@pytest.fixture
def oracle(setup, settings):
    settings.ASYNC_TASKS = False
    settings.ORACLE_CREDENTIALS_KEY = Fernet.generate_key().decode()
    _memory.clear()
    yield setup
    _memory.clear()


def payload(**changes):
    return {
        "version": 0,
        "host": "192.0.2.51",
        "port": 1521,
        "identifier_type": "service",
        "identifier": "TEST_SERVICE",
        "username": "TEST_READ_ONLY",
        "password": "oracle-private-test-secret",
        "timeout_ms": 15000,
        "admin_password": ADMIN_PASSWORD,
        **changes,
    }


def post(oracle, action, body, key=None, unit="ame"):
    return oracle["client"].post(
        URL + action + "/?unit=" + unit,
        body,
        format="json",
        HTTP_IDEMPOTENCY_KEY=key or "oracle-test-" + action,
    )


def save(oracle):
    result = post(oracle, "configure", payload())
    assert result.status_code == 200, result.data
    return OracleConfiguration.objects.select_related("owner").get(unit=oracle["unit"])


def test_password_encryption_and_no_secrets_in_api_audit_or_receipt(oracle):
    config = save(oracle)
    stored = json.dumps(OracleConfiguration.objects.values().get(pk=config.pk), default=str)
    for secret in [
        ADMIN_PASSWORD,
        "oracle-private-test-secret",
        "TEST_READ_ONLY",
        "TEST_SERVICE",
        "192.0.2.51",
    ]:
        assert secret not in stored
    decoded = decrypt(config, derive(ADMIN_PASSWORD, config.salt))
    assert decoded["password"] == payload()["password"]
    with pytest.raises(ValueError, match="oracle_locked"):
        decrypt(config, derive("wrong-password", config.salt))
    result = oracle["client"].get(URL).json()
    assert result["unlocked"] is True
    assert result["details"]["username"] == "TEST_READ_ONLY"
    assert "password" not in result["details"]
    metadata = json.dumps([list(Audit.objects.values()), list(ActionReceipt.objects.values())], default=str)
    for secret in [ADMIN_PASSWORD, payload()["password"], "TEST_READ_ONLY", "192.0.2.51"]:
        assert secret not in metadata


def test_verify_admin_password_and_unit_permissions(oracle):
    assert post(oracle, "configure", payload(admin_password="invalid")).status_code == 400
    assert not OracleConfiguration.objects.exists()
    other = Unit.objects.create(slug="other", name="Other")
    assert post(oracle, "configure", payload(), unit=other.slug).status_code == 403
    Membership.objects.filter(user=oracle["user"]).update(role="operator")
    assert post(oracle, "configure", payload()).status_code == 403
    assert oracle["client"].get(URL).status_code == 403


def test_locked_never_falls_back_and_unlock_idempotency(oracle, settings):
    config = save(oracle)
    settings.ORACLE_DSN = "legacy-should-not-be-used"
    settings.ORACLE_USER = "legacy"
    settings.ORACLE_PASSWORD = "legacy-secret"
    assert post(oracle, "lock", {"version": 1}).status_code == 200
    with pytest.raises(ValueError, match="oracle_locked"):
        OracleSource(oracle["unit"]).credentials()
    assert oracle["client"].get(URL).json()["details"] is None
    assert post(oracle, "test", {"version": 1}).status_code == 400
    assert post(oracle, "unlock", {"version": 1, "admin_password": ADMIN_PASSWORD}).status_code == 200
    config.refresh_from_db()
    expiry = access(config)[1]
    assert post(oracle, "unlock", {"version": 1, "admin_password": ADMIN_PASSWORD}).status_code == 200
    assert access(config)[1] == expiry is None
    assert OracleSource(oracle["unit"]).credentials()[1:] == (payload()["username"], payload()["password"])


def test_continuous_access_survives_restart_and_admin_password_change(oracle):
    config = save(oracle)
    _memory.clear()
    assert oracle["client"].get(URL).json()["unlocked"]
    assert post(oracle, "unlock", {"version": 1, "admin_password": ADMIN_PASSWORD}).status_code == 200
    oracle["user"].set_password("Changed-Password-2026!")
    oracle["user"].save()
    config.refresh_from_db()
    assert oracle["client"].get(URL).json()["unlocked"]
    assert post(oracle, "lock", {"version": 1}).status_code == 200
    assert (
        post(
            oracle,
            "unlock",
            {"version": 1, "admin_password": "Changed-Password-2026!"},
            key="oracle-changed-password",
        ).status_code
        == 200
    )
    assert OracleSource(oracle["unit"]).credentials()[2] == payload()["password"]


def test_version_idempotency_salt_and_connection_parameters(oracle):
    config = save(oracle)
    first_salt = config.salt
    assert post(oracle, "configure", payload(), key="oracle-stale-write").status_code == 409
    assert post(oracle, "configure", payload()).json()["version"] == 1
    assert post(oracle, "configure", payload(version=1), key="oracle-update-config").status_code == 200
    config.refresh_from_db()
    assert config.salt != first_salt and config.version == 2
    with patch("oracledb.connect") as connect:
        OracleSource(oracle["unit"]).connect()
        assert connect.call_args.kwargs["user"] == payload()["username"]
        assert connect.return_value.call_timeout == 15000


def test_connection_test_is_readonly_and_redacts_errors(oracle):
    save(oracle)
    connection = MagicMock()
    connection.__enter__.return_value = connection
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (1,)
    with patch("core.oracle_config.connect", return_value=connection):
        result = post(oracle, "test", {"version": 1})
    assert result.json()["validation_state"] == "connected"
    assert [call.args[0] for call in cursor.execute.call_args_list] == [
        "SET TRANSACTION READ ONLY",
        "SELECT 1 FROM DUAL",
    ]
    connection.rollback.assert_called_once()
    with patch("core.oracle_config.connect", side_effect=Exception("SECRET-DSN-PASSWORD")):
        result = post(oracle, "test", {"version": 1}, key="oracle-second-test")
    assert result.json()["validation_state"] == "connection_failed"
    assert "SECRET-DSN-PASSWORD" not in json.dumps(result.json())


def test_environment_kept_only_without_panel_configuration(oracle, settings):
    settings.ORACLE_DSN, settings.ORACLE_USER, settings.ORACLE_PASSWORD = "env-dsn", "env-user", "env-pass"
    state = oracle["client"].get(URL).json()
    assert state["legacy_configured"] is True and state["configured"] is False
    assert "env-pass" not in json.dumps(state)
    assert OracleSource(oracle["unit"]).credentials() == ("env-dsn", "env-user", "env-pass")
    second = Unit.objects.create(slug="second", name="Second")
    assert OracleSource(second).credentials() == ("", "", "")
    save(oracle)
    assert oracle["client"].get(URL).json()["legacy_configured"] is False
    assert OracleSource().credentials()[1] == payload()["username"]


def test_permanent_access_does_not_expire_and_control_works(oracle):
    save(oracle)
    with patch("core.oracle_credentials.time.time", return_value=10**12):
        result = oracle["client"].get(URL).json()
        assert result["unlocked"] and result["persistent_access"] and result["unlocked_until"] is None
    result = oracle["client"].get("/api/v1/control/?unit=ame")
    assert result.status_code == 200 and result.json()["oracle_configured"] is True


def test_shared_worker_lease_is_encrypted_and_cache_failure_blocks(oracle, settings):
    config = save(oracle)
    # Compatibility for configurations not yet migrated from the old temporary lease.
    config.service_key_ciphertext = ""
    config.save(update_fields=["service_key_ciphertext"])
    key = derive(ADMIN_PASSWORD, config.salt)
    settings.ASYNC_TASKS = True
    settings.INSTANCE_CREDENTIALS_KEY = Fernet.generate_key().decode()
    cache = MagicMock()
    with patch("core.oracle_credentials.redis_client", return_value=cache):
        lease(config, key)
        name, ttl, encrypted = cache.setex.call_args.args
        assert ttl == 43200 and key not in encrypted
        assert Fernet(settings.INSTANCE_CREDENTIALS_KEY.encode()).decrypt(encrypted) == key
        cache.get.return_value = encrypted
        cache.ttl.return_value = 300
        _memory.clear()
        assert lease(config)[0] == key
        lease(config, remove=True)
        cache.delete.assert_called_once_with(name)
    with patch("core.oracle_credentials.redis_client", side_effect=Exception("secret redis URL")):
        with pytest.raises(ValueError, match="oracle_unlock_cache_unavailable"):
            OracleSource(oracle["unit"]).credentials()


def test_unlock_receipt_does_not_allow_plain_hash_dictionary_attack(oracle, settings):
    from core.oracle_config import receipt_payload

    values = {"version": 1, "admin_password": ADMIN_PASSWORD}
    protected = receipt_payload(values)
    assert protected["admin_password"] != ADMIN_PASSWORD
    settings.SECRET_KEY = "different-server-key"
    assert protected != receipt_payload(values)


def test_server_key_is_required_and_tampering_never_falls_back(oracle, settings):
    save(oracle)
    settings.ORACLE_DSN, settings.ORACLE_USER, settings.ORACLE_PASSWORD = "env", "env", "env-secret"
    settings.ORACLE_CREDENTIALS_KEY = Fernet.generate_key().decode()
    _memory.clear()
    assert not oracle["client"].get(URL).json()["unlocked"]
    with pytest.raises(ValueError, match="oracle_service_key_unavailable"):
        OracleSource(oracle["unit"]).credentials()
    settings.ORACLE_CREDENTIALS_KEY = ""
    with pytest.raises(ValueError, match="oracle_service_key_unavailable"):
        OracleSource(oracle["unit"]).credentials()


def test_workers_need_no_redis_and_manual_disable_survives_restart(oracle, settings):
    save(oracle)
    settings.ASYNC_TASKS = True
    with patch("core.oracle_credentials.redis_client", side_effect=Exception("cache unavailable")):
        _memory.clear()
        assert OracleSource(oracle["unit"]).credentials()[2] == payload()["password"]
        assert post(oracle, "lock", {"version": 1}).status_code == 200
        _memory.clear()
        with pytest.raises(ValueError, match="oracle_locked"):
            OracleSource(oracle["unit"]).credentials()


def test_legacy_configuration_gets_persistent_key_on_unlock(oracle):
    config = save(oracle)
    config.service_key_ciphertext = ""
    config.save(update_fields=["service_key_ciphertext"])
    _memory.clear()
    assert not oracle["client"].get(URL).json()["unlocked"]
    assert post(oracle, "unlock", {"version": 1, "admin_password": ADMIN_PASSWORD}).status_code == 200
    _memory.clear()
    config.refresh_from_db()
    assert config.service_key_ciphertext and access(config)[1] is None
