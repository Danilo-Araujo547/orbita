"""Bounded, non-redirecting HTTP client with DNS pinning and normal TLS validation."""

import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
from urllib.parse import urlencode, urlsplit, urlunsplit

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from rest_framework.exceptions import APIException, ValidationError

MAX_BYTES = 12 * 1024 * 1024


class RemoteUnavailable(APIException):
    status_code = 502
    default_detail = "Instância remota indisponível. Nenhum registro local foi criado."

    def __init__(self, code="unavailable", uncertain=False):
        self.code = code
        message = self.default_detail
        if uncertain:
            message = "Resultado remoto incerto. Verifique a origem antes de repetir a ação; reutilize a mesma chave de idempotência."
        super().__init__({"detail": message, "code": code, "uncertain": uncertain})


def credential_cipher():
    try:
        return Fernet(settings.INSTANCE_CREDENTIALS_KEY.encode())
    except (AttributeError, TypeError, ValueError):
        raise ValidationError("Chave de proteção de instâncias não configurada no servidor.") from None


def encrypt_key(value):
    return credential_cipher().encrypt(value.encode()).decode()


def decrypt_key(value):
    try:
        return credential_cipher().decrypt(value.encode()).decode()
    except (InvalidToken, UnicodeError):
        raise RemoteUnavailable("credentials_unreadable") from None


def normalized_url(value):
    try:
        parts = urlsplit(value.strip())
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or not 1 <= (parts.port or 443) <= 65535
        ):
            raise ValueError
        if parts.username or parts.password or parts.query or parts.fragment:
            raise ValueError
        if ".." in parts.path or "//" in parts.path or not re.fullmatch(r"[a-zA-Z0-9_/-]*", parts.path):
            raise ValueError
        hostname = parts.hostname.encode("idna").decode()
        if ":" in hostname:
            hostname = f"[{hostname}]"
        authority = hostname + (f":{parts.port}" if parts.port else "")
        return urlunsplit((parts.scheme, authority, parts.path.rstrip("/"), "", ""))
    except (ValueError, UnicodeError):
        raise ValidationError(
            "Informe a URL base HTTP/HTTPS do Órbita, sem credenciais, parâmetros ou fragmentos."
        ) from None


def resolve_address(parts):
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        addresses = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
    except OSError:
        raise RemoteUnavailable("dns_failed") from None
    for item in addresses:
        address = ipaddress.ip_address(item[4][0])
        address = getattr(address, "ipv4_mapped", None) or address
        if (
            address.is_link_local
            or address.is_multicast
            or address.is_unspecified
            or (address.is_reserved and not address.is_loopback)
        ):
            raise ValidationError("Endereço de rede não permitido para uma instância Órbita.")
        if parts.scheme == "http" and not (address.is_private or address.is_loopback):
            raise ValidationError("Instâncias em endereços públicos exigem HTTPS.")
    if not addresses:
        raise RemoteUnavailable("dns_failed")
    return addresses[0][4][0], port


class PinnedConnection(http.client.HTTPConnection):
    def __init__(self, host, port, address, secure):
        super().__init__(host, port, timeout=15)
        self.address, self.secure = address, secure

    def connect(self):
        self.sock = socket.create_connection((self.address, self.port), timeout=5)
        if self.secure:
            try:
                self.sock = ssl.create_default_context().wrap_socket(self.sock, server_hostname=self.host)
            except Exception:
                self.sock.close()
                raise
        self.sock.settimeout(15)


def remote_http(
    base_url,
    key,
    path,
    method="GET",
    query=None,
    body=b"",
    role="viewer",
    idempotency="",
    content_type="application/json",
):
    parts = urlsplit(normalized_url(base_url))
    address, port = resolve_address(parts)
    conn = PinnedConnection(parts.hostname, port, address, parts.scheme == "https")
    target = parts.path + "/api/v1/" + path
    if query:
        target += "?" + urlencode(query, doseq=True)
    headers = {
        "Authorization": "Bearer " + key,
        "X-Orbita-Role-Limit": role,
        "Accept": "application/json",
        "Content-Type": content_type,
        "Connection": "close",
    }
    if idempotency:
        headers["Idempotency-Key"] = idempotency
    try:
        deadline = time.monotonic() + 30
        conn.request(method, target, body=body if method != "GET" else None, headers=headers)
        response = conn.getresponse()
        # Redirects are never followed; bearer keys never leave the configured origin.
        if 300 <= response.status < 400:
            raise RemoteUnavailable("redirect_refused", method != "GET")
        chunks, size = [], 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RemoteUnavailable("response_timeout", method != "GET")
            if conn.sock:
                conn.sock.settimeout(min(15, remaining))
            chunk = response.read1(min(65536, MAX_BYTES + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_BYTES:
                raise RemoteUnavailable("response_too_large", method != "GET")
        content = b"".join(chunks)
        return response.status, dict(response.getheaders()), content
    except (OSError, http.client.HTTPException, ValueError):
        raise RemoteUnavailable("connection_failed", method != "GET") from None
    finally:
        conn.close()


def inspect_remote(base_url, key, role="admin"):
    code, _, content = remote_http(base_url, key, "federation/manifest/", role=role)
    if code in {401, 403}:
        raise ValidationError("Chave remota inválida, expirada, revogada ou sem permissão.")
    if code != 200:
        raise RemoteUnavailable("incompatible_instance")
    try:
        data = json.loads(content)
        from uuid import UUID

        remote_id = UUID(data["instance_id"])
        if str(remote_id) == str(settings.ORBITA_INSTANCE_ID):
            raise ValidationError("Esta URL aponta para a própria instância. Use outra instalação do Órbita.")
        unit = data["unit"]
        if (
            data["protocol"] != "orbita-federation/1"
            or data["role"] not in {"viewer", "operator", "admin"}
            or data.get("sending_enabled") is not False
        ):
            raise ValueError
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,50}", unit["slug"]):
            raise ValueError
        if not isinstance(unit["name"], str) or len(unit["name"]) > 150:
            raise ValueError
        # Only public unit metadata, never remote clinical/operational records.
        from core.access import validate_permissions

        return {
            "instance_id": str(remote_id),
            "permissions": validate_permissions(data.get("permissions", {})),
            "role": data["role"],
            "unit": {
                "slug": unit["slug"],
                "name": unit["name"],
                "timezone": str(unit.get("timezone", "America/Sao_Paulo"))[:50],
                "paused": bool(unit.get("paused", True)),
                "response_hours": int(unit.get("response_hours", 24)),
            },
        }
    except (KeyError, ValueError, TypeError):
        raise RemoteUnavailable("incompatible_instance") from None
