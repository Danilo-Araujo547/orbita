import hashlib
import hmac
import re
from contextvars import ContextVar

from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied

from core.models import InstanceAccessKey, Membership

access_context = ContextVar("orbita_instance_access", default="")
RANK = {"viewer": 0, "operator": 1, "admin": 2}
# Only unit-scoped resources. Auth, key issuance, instance relay and user administration cannot be delegated.
RESOURCES = {
    "appointment-groups",
    "appointments",
    "messages",
    "replies",
    "issues",
    "rules",
    "templates",
    "imports",
    "audit",
    "cases",
    "contacts",
    "movements",
    "preparations",
    "layouts",
    "policies",
    "sheet-imports",
    "campaigns",
    "reports",
    "report-access",
    "report-requests",
    "report-schedules",
    "sources",
    "flow-rules",
    "flow-runs",
    "control",
    "indicators",
    "workspace",
    "meta-configuration",
}


def limited_role(*roles):
    return min(roles, key=lambda role: RANK.get(role, -1))


def key_role(key):
    role = (
        "admin"
        if key.issuer.is_superuser
        else Membership.objects.filter(unit=key.unit, user=key.issuer).values_list("role", flat=True).first()
    )
    if role not in RANK or not key.issuer.is_active:
        raise AuthenticationFailed("A chave não possui mais autorização na unidade.")
    return limited_role(role, key.role)


def allowed_resource(path):
    if not re.fullmatch(r"[a-zA-Z0-9_/-]+/", path) or "//" in path:
        return False
    return path.split("/")[0] in RESOURCES


class InstanceKeyAuthentication(BaseAuthentication):
    def authenticate_header(self, request):
        return "Bearer"

    def authenticate(self, request):
        header = get_authorization_header(request)
        if not header:
            return None
        try:
            kind, token = header.decode("ascii").split(" ", 1)
        except (ValueError, UnicodeError):
            raise AuthenticationFailed("Chave de instância inválida.") from None
        match = re.fullmatch(r"orbita_([a-f0-9]{32})\.([A-Za-z0-9_-]{43})", token)
        if kind != "Bearer" or not match:
            raise AuthenticationFailed("Chave de instância inválida.")
        key = InstanceAccessKey.objects.select_related("unit", "issuer").filter(pk=match[1]).first()
        if not key or not hmac.compare_digest(key.secret_hash, hashlib.sha256(token.encode()).hexdigest()):
            raise AuthenticationFailed("Chave de instância inválida.")
        if key.revoked_at or key.expires_at <= timezone.now():
            raise AuthenticationFailed("Chave de instância revogada ou expirada.")
        path = request.path_info.removeprefix("/api/v1/")
        if not request.path_info.startswith("/api/v1/") or not (
            allowed_resource(path) or path == "federation/manifest/"
        ):
            raise PermissionDenied("Este recurso não está disponível para chaves de instância.")
        if request.query_params.get("unit", key.unit.slug) != key.unit.slug:
            raise PermissionDenied("Chave não autorizada para esta unidade.")
        role = key_role(key)
        limit = request.headers.get("X-Orbita-Role-Limit", role)
        if limit not in RANK:
            raise PermissionDenied("Limite de permissão inválido.")
        key.effective_role = limited_role(role, limit)
        if request.method not in {"GET", "HEAD", "OPTIONS"} and key.effective_role == "viewer":
            raise PermissionDenied("Esta chave permite somente consulta.")
        InstanceAccessKey.objects.filter(pk=key.pk).update(last_used_at=timezone.now())
        access_context.set(str(key.pk))
        return key.issuer, key


class FederationContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = access_context.set("")
        try:
            return self.get_response(request)
        finally:
            access_context.reset(token)


class InstanceKeySchema(OpenApiAuthenticationExtension):
    target_class = "core.federation_auth.InstanceKeyAuthentication"
    name = "orbitaInstanceKey"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer", "bearerFormat": "orbita_<id>.<secret>"}
