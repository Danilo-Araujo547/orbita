import json
import socket
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
from core.federation_network import RemoteUnavailable, inspect_remote, normalized_url, resolve_address
from core.models import Audit, InstanceAccessKey, Membership, RemoteInstance, Unit
from cryptography.fernet import Fernet
from django.utils import timezone
from messaging.models import Message, Notification
from operations.models import ActionReceipt, Case
from responses.models import Reply
from rest_framework.test import APIClient
from scheduling.models import Appointment, ImportRun

KEYS = "/api/v1/instance-keys/"
REMOTES = "/api/v1/remote-instances/"
MANIFEST = "/api/v1/federation/manifest/"


@pytest.fixture
def federation(setup, settings):
    settings.INSTANCE_CREDENTIALS_KEY = Fernet.generate_key().decode()
    settings.ORBITA_INSTANCE_ID = str(uuid4())
    response = setup["client"].post(
        KEYS,
        {"name": "Central", "role": "admin", "validity_days": 10},
        format="json",
        HTTP_IDEMPOTENCY_KEY="federation-key-001",
    )
    assert response.status_code == 201
    key = response.json()
    bearer = APIClient()
    bearer.credentials(HTTP_AUTHORIZATION="Bearer " + key["key"])
    return {**setup, "key": key, "bearer": bearer}


def manifest():
    return {
        "protocol": "orbita-federation/1",
        "instance_id": str(uuid4()),
        "role": "operator",
        "sending_enabled": False,
        "unit": {
            "slug": "remote-clinic",
            "name": "Clínica remota",
            "timezone": "America/Sao_Paulo",
            "paused": True,
            "response_hours": 24,
        },
    }


@pytest.fixture
def connected(federation):
    f = federation
    f["manifest"] = manifest()
    with patch("core.federation.inspect_remote", return_value=f["manifest"]):
        response = f["client"].post(
            REMOTES,
            {
                "version": 0,
                "name": "Servidor externo",
                "base_url": "http://192.168.20.10:8000",
                "key": f["key"]["key"],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="connect-peer-001",
        )
    assert response.status_code == 200
    f["connection"] = response.json()
    f["proxy"] = f"/api/v1/remote/{f['connection']['id']}/"
    return f


def test_key_is_shown_once_hash_only_and_idempotency_replay_not_reissued(federation):
    f = federation
    stored = InstanceAccessKey.objects.get()
    assert f["key"]["key"] not in stored.secret_hash and len(stored.secret_hash) == 64
    assert "secret_hash" not in f["client"].get(KEYS).content.decode()
    assert f["key"]["key"] not in f["client"].get(KEYS).content.decode()
    assert not ActionReceipt.objects.filter(result__has_key="key").exists()
    response = f["client"].post(
        KEYS, {"name": "Central", "role": "admin"}, format="json", HTTP_IDEMPOTENCY_KEY="federation-key-001"
    )
    assert response.status_code == 409 and InstanceAccessKey.objects.count() == 1
    assert f["key"]["key"] not in json.dumps(list(Audit.objects.values("details")))


def test_manifest_and_scoped_api_with_no_session(federation):
    f = federation
    response = f["bearer"].get(MANIFEST)
    assert response.status_code == 200 and response.json()["unit"]["slug"] == "ame"
    assert response.json()["role"] == "admin" and not response.json()["sending_enabled"]
    assert f["bearer"].get("/api/v1/appointments/").json()["count"] == 1
    assert f["bearer"].get("/api/v1/appointments/?unit=other").status_code == 403
    for path in [
        KEYS,
        REMOTES,
        "/api/v1/auth/session/",
        "/api/v1/units/",
        "/api/v1/members/",
        "/api/v1/tests/process/",
    ]:
        assert f["bearer"].get(path).status_code in {401, 403}
    assert f["client"].get(MANIFEST).status_code == 403


def test_role_limits_revocation_expiry_and_issuer_permissions(federation):
    f = federation
    assert (
        f["bearer"]
        .post("/api/v1/control/", {"paused": True}, format="json", HTTP_X_ORBITA_ROLE_LIMIT="viewer")
        .status_code
        == 403
    )
    Membership.objects.filter(unit=f["unit"], user=f["user"]).update(role="viewer")
    assert f["bearer"].get(MANIFEST).json()["role"] == "viewer"
    assert f["bearer"].post("/api/v1/control/", {"paused": True}, format="json").status_code == 403
    Membership.objects.filter(unit=f["unit"], user=f["user"]).update(role="admin")
    response = f["client"].post(
        KEYS + f["key"]["id"] + "/revoke/", {}, format="json", HTTP_IDEMPOTENCY_KEY="revoke-key-once"
    )
    assert response.status_code == 200
    assert f["bearer"].get(MANIFEST).status_code == 401
    InstanceAccessKey.objects.update(revoked_at=None, expires_at=timezone.now() - timedelta(seconds=1))
    assert f["bearer"].get(MANIFEST).status_code == 401
    InstanceAccessKey.objects.update(expires_at=timezone.now() + timedelta(days=1))
    f["user"].is_active = False
    f["user"].save()
    assert f["bearer"].get(MANIFEST).status_code == 401


def test_remote_audit_records_key_and_context_does_not_leak_to_local(federation):
    f = federation
    response = f["bearer"].post("/api/v1/control/", {"paused": True}, format="json")
    assert response.status_code == 200
    assert (
        Audit.objects.filter(action="unit.control").latest("id").details["instance_access_key"]
        == f["key"]["id"]
    )
    assert f["client"].post("/api/v1/control/", {"paused": True}, format="json").status_code == 200
    assert "instance_access_key" not in Audit.objects.filter(action="unit.control").latest("id").details


def test_connection_metadata_only_and_session_cloud_options(connected):
    f = connected
    connection = RemoteInstance.objects.get()
    assert connection.key_ciphertext != f["key"]["key"]
    assert "key_ciphertext" not in f["client"].get(REMOTES).content.decode()
    assert f["key"]["key"] not in f["client"].get(REMOTES).content.decode()
    assert Unit.objects.count() == 1 and not Unit.objects.filter(slug="remote-clinic").exists()
    assert Appointment.objects.count() == 1 and Message.objects.count() == 1
    session = f["client"].get("/api/v1/auth/session/").json()
    remote = next(u for u in session["units"] if u.get("remote"))
    assert remote["slug"] == "remote:" + str(connection.pk)
    assert remote["origin_unit"] == "remote-clinic" and session["roles"][remote["slug"]] == "operator"
    Membership.objects.filter(user=f["user"]).update(role="viewer")
    session = f["client"].get("/api/v1/auth/session/").json()
    assert session["roles"][remote["slug"]] == "viewer"


def test_proxy_reads_only_origin_and_does_not_save_remote_records(connected):
    f = connected
    models = [Unit, Appointment, Message, Reply, Case, Notification, ImportRun]
    before = [m.objects.count() for m in models]
    payload = {
        "count": 1,
        "next": "https://origin.example/api/v1/appointments/?page=2&unit=remote-clinic",
        "previous": None,
        "results": [{"id": 999, "patient": "FICTÍCIO REMOTO"}],
    }
    with patch(
        "core.federation.remote_http",
        return_value=(200, {"Content-Type": "application/json"}, json.dumps(payload).encode()),
    ) as network:
        response = f["client"].get(f["proxy"] + "appointments/?unit=ame&search=teste")
    assert response.status_code == 200 and response.json()["results"][0]["id"] == 999
    assert response["Cache-Control"] == "no-store"
    assert response.json()["next"].startswith(f["proxy"])
    assert network.call_args.kwargs["query"]["unit"] == "remote-clinic"
    assert network.call_args.kwargs["role"] == "operator"
    assert [m.objects.count() for m in models] == before


def test_proxy_posts_forward_idempotency_once_no_local_receipt_or_payload(connected):
    f = connected
    before = ActionReceipt.objects.count()
    with patch(
        "core.federation.remote_http",
        return_value=(200, {"Content-Type": "application/json"}, b'{"ok":true}'),
    ) as network:
        response = f["client"].post(
            f["proxy"] + "appointments/999/observe/",
            {"text": "OBSERVAÇÃO REMOTA"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="remote-action-001",
        )
    assert response.status_code == 200 and network.call_count == 1
    assert network.call_args.kwargs["idempotency"] == "remote-action-001"
    assert "OBSERVA" in network.call_args.kwargs["body"].decode()
    assert ActionReceipt.objects.count() == before
    assert not Audit.objects.filter(details__icontains="OBSERVAÇÃO REMOTA").exists()
    assert f["client"].post(f["proxy"] + "appointments/999/observe/", {}, format="json").status_code == 400


def test_proxy_cross_unit_nested_and_csrf_denied(connected):
    f = connected
    other = Unit.objects.create(slug="other", name="Outra")
    RemoteInstance.objects.filter(pk=f["connection"]["id"]).update(local_unit=other)
    with patch("core.federation.remote_http") as network:
        assert f["client"].get(f["proxy"] + "appointments/").status_code == 403
        network.assert_not_called()
    RemoteInstance.objects.filter(pk=f["connection"]["id"]).update(local_unit=f["unit"])
    with patch("core.federation.remote_http") as network:
        assert f["client"].get(f["proxy"] + "remote-instances/").status_code == 403
        assert f["client"].get(f["proxy"] + "instance-keys/").status_code == 403
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(f["user"])
        assert (
            client.post(
                f["proxy"] + "appointments/999/observe/",
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY="remote-csrf-check",
            ).status_code
            == 403
        )
        network.assert_not_called()


def test_unavailable_origin_no_local_fallback_and_uncertain_post(connected):
    f = connected
    with patch("core.federation.remote_http", side_effect=RemoteUnavailable("connection_failed")):
        response = f["client"].get(f["proxy"] + "appointments/")
    assert response.status_code == 502 and "results" not in response.json()
    with patch(
        "core.federation.remote_http", side_effect=RemoteUnavailable("connection_failed", uncertain=True)
    ):
        response = f["client"].post(
            f["proxy"] + "appointments/999/observe/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="remote-uncertain-001",
        )
    assert response.status_code == 502 and "incerto" in response.json()["detail"]


def test_disconnect_version_and_duplicate_connection(connected):
    f = connected
    with patch("core.federation.inspect_remote", return_value=f["manifest"]):
        duplicate = f["client"].post(
            REMOTES,
            {
                "version": 0,
                "name": "Duplicada",
                "base_url": "http://192.168.20.10:8000",
                "key": f["key"]["key"],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="duplicate-peer-001",
        )
    assert duplicate.status_code == 400
    path = REMOTES + f["connection"]["id"] + "/disconnect/"
    assert (
        f["client"]
        .post(path, {"version": 7}, format="json", HTTP_IDEMPOTENCY_KEY="disconnect-stale")
        .status_code
        == 409
    )
    assert (
        f["client"]
        .post(path, {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="disconnect-valid")
        .status_code
        == 200
    )
    assert not any(u.get("remote") for u in f["client"].get("/api/v1/auth/session/").json()["units"])
    assert f["client"].get(f["proxy"] + "appointments/").status_code == 404


@pytest.mark.parametrize(
    "url",
    [
        "http://user:secret@localhost",
        "file:///etc/passwd",
        "http://localhost/?token=x",
        "http://localhost/#x",
        "http://localhost/../api",
        "http://localhost/%2fapi",
    ],
)
def test_unsafe_urls_rejected(url):
    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        normalized_url(url)


@pytest.mark.parametrize(
    "address,scheme",
    [("169.254.169.254", "https"), ("0.0.0.0", "http"), ("224.0.0.1", "https"), ("8.8.8.8", "http")],
)
def test_unsafe_network_targets_rejected(address, scheme):
    from rest_framework.exceptions import ValidationError

    with (
        patch(
            "core.federation_network.socket.getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 8000))],
        ),
        pytest.raises(ValidationError),
    ):
        resolve_address(urlsplit(f"{scheme}://example.test:8000"))


def test_manifest_rejects_self_wrong_protocol_and_credentials(federation, settings):
    data = manifest()
    data["instance_id"] = settings.ORBITA_INSTANCE_ID
    from rest_framework.exceptions import ValidationError

    with (
        patch("core.federation_network.remote_http", return_value=(200, {}, json.dumps(data).encode())),
        pytest.raises(ValidationError),
    ):
        inspect_remote("http://localhost:8001", federation["key"]["key"])
    data["instance_id"] = str(uuid4())
    data["protocol"] = "unknown"
    with (
        patch("core.federation_network.remote_http", return_value=(200, {}, json.dumps(data).encode())),
        pytest.raises(RemoteUnavailable),
    ):
        inspect_remote("http://localhost:8001", federation["key"]["key"])
    with (
        patch("core.federation_network.remote_http", return_value=(401, {}, b"SECRET SHOULD NOT APPEAR")),
        pytest.raises(ValidationError) as error,
    ):
        inspect_remote("http://localhost:8001", federation["key"]["key"])
    assert "SECRET" not in str(error.value)


def test_binary_export_is_no_store_and_not_saved(connected):
    f = connected
    with patch(
        "core.federation.remote_http",
        return_value=(200, {"Content-Type": "text/csv"}, b"coluna\r\nremoto\r\n"),
    ):
        response = f["client"].get(f["proxy"] + "appointments/export/")
    assert response.status_code == 200 and b"remoto" in response.content
    assert response["Cache-Control"] == "no-store" and "attachment" in response["Content-Disposition"]


def test_real_http_handshake_and_relay_without_replication(federation):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread

    f = federation
    info = manifest()
    observed = []

    class Origin(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Test keys and response bodies never reach HTTP logs.

        def do_GET(self):
            observed.append(
                {
                    "path": self.path,
                    "authorization": self.headers.get("Authorization"),
                    "role": self.headers.get("X-Orbita-Role-Limit"),
                }
            )
            if self.path.startswith(MANIFEST):
                payload = info
            else:
                payload = {
                    "count": 1,
                    "next": None,
                    "previous": None,
                    "results": [{"id": 555, "patient": "FICTÍCIO DO SERVIDOR REMOTO"}],
                }
            content = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Origin)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    counts = (Unit.objects.count(), Appointment.objects.count(), Message.objects.count())
    try:
        response = f["client"].post(
            REMOTES,
            {
                "version": 0,
                "name": "HTTP integração",
                "base_url": f"http://127.0.0.1:{server.server_port}",
                "key": f["key"]["key"],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="http-real-connect",
        )
        assert response.status_code == 200
        connection_id = response.json()["id"]
        response = f["client"].get(f"/api/v1/remote/{connection_id}/appointments/?page=1")
        assert response.status_code == 200 and response.json()["results"][0]["id"] == 555
        assert observed[0]["path"] == MANIFEST
        assert "unit=remote-clinic" in observed[1]["path"]
        assert all(item["authorization"] == "Bearer " + f["key"]["key"] for item in observed)
        assert observed[1]["role"] == "operator"
        assert counts == (Unit.objects.count(), Appointment.objects.count(), Message.objects.count())
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_existing_connection_cannot_be_rebound_to_another_namespace(connected):
    f = connected
    replacement = manifest()
    with patch("core.federation.inspect_remote", return_value=replacement):
        response = f["client"].post(
            REMOTES + f["connection"]["id"] + "/configure/",
            {
                "version": 1,
                "name": "Outro destino",
                "base_url": f["connection"]["base_url"],
                "key": f["key"]["key"],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="rebind-not-allowed",
        )
    assert response.status_code == 400
    assert str(RemoteInstance.objects.get().remote_instance_id) == f["manifest"]["instance_id"]
