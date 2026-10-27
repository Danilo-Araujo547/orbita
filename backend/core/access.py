"""Section permissions are enforced on every API request, not only navigation."""

from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated

from core.models import Membership, RemoteMembership, UserAccessProfile

SECTIONS = {
    "overview": "Visão geral",
    "costs": "Custos Meta",
    "appointments": "Agendamentos",
    "groups": "Grupos",
    "messages": "Mensagens",
    "issues": "Pendências",
    "campaigns": "Importa CROSS",
    "reports": "Relatórios",
    "operationsAdmin": "Administração",
    "settings": "Configurações",
    "users": "Usuários",
}
LEVELS = {"none": 0, "read": 1, "write": 2}
PRIVILEGED = {"operationsAdmin", "settings", "users"}
RESOURCES = {
    "indicators": ["overview"],
    "meta-costs": ["costs"],
    "appointments": ["appointments"],
    "agenda-items": ["appointments"],
    "appointment-groups": ["groups"],
    "messages": ["messages"],
    "replies": ["messages"],
    "issues": ["issues", "appointments"],
    "cases": ["appointments", "issues", "campaigns"],
    "contacts": ["appointments", "issues", "campaigns"],
    "movements": ["appointments", "issues"],
    "campaigns": ["campaigns"],
    "sheet-imports": ["campaigns"],
    "reports": ["reports", "operationsAdmin"],
    "report-requests": ["reports"],
    "report-access": ["reports", "operationsAdmin"],
    "report-connections": ["reports"],
    "report-app-connections": ["reports"],
    "report-recipients": ["reports"],
    "report-grants": ["reports"],
    "report-automations": ["reports"],
    "report-executions": ["reports"],
    "report-snapshots": ["reports"],
    "report-snapshot-runs": ["reports"],
    "report-whatsapp": ["reports"],
    "report-schedules": ["reports", "operationsAdmin"],
    "preparations": ["operationsAdmin"],
    "layouts": ["operationsAdmin", "campaigns"],
    "policies": ["operationsAdmin"],
    "sources": ["operationsAdmin"],
    "flow-rules": ["operationsAdmin"],
    "flow-runs": ["operationsAdmin"],
    "rules": ["settings"],
    "templates": ["settings", "operationsAdmin", "campaigns"],
    "imports": ["settings"],
    "audit": ["settings"],
    "logs": ["settings"],
    "control": ["settings"],
    "meta-configuration": ["settings"],
    "oracle-agendas": ["settings"],
    "oracle-configuration": ["settings"],
    "instance-keys": ["settings"],
    "remote-instances": ["settings"],
    "members": ["users"],
    "units": ["operationsAdmin", "users", "settings"],
    "users": ["users"],
    "tests": ["appointments", "overview"],
}


def validate_permissions(value):
    if not isinstance(value, dict) or any(
        k not in SECTIONS or v not in LEVELS for k, v in value.items()
    ):
        raise ValidationError(
            "Permissões devem conter somente seções válidas com none, read ou write."
        )
    return value


def role_permissions(role, overrides=None):
    value = {
        key: "write"
        if role == "admin" or (role == "operator" and key not in PRIVILEGED)
        else "read"
        for key in SECTIONS
    }
    if role != "admin":
        value["users"] = "none"
    if role != "admin" or (overrides and "costs" not in overrides):
        value["costs"] = "none"
    value.update(
        {k: v for k, v in (overrides or {}).items() if k in SECTIONS and v in LEVELS}
    )
    for key in value:
        if role == "viewer" and value[key] == "write":
            value[key] = "read"
        if role != "admin" and key in PRIVILEGED and value[key] == "write":
            value[key] = "read"
    return value


def intersect_permissions(*policies):
    return {
        key: min((p.get(key, "none") for p in policies), key=lambda v: LEVELS.get(v, 0))
        for key in SECTIONS
    }


def local_permissions(user, unit):
    if user.is_superuser:
        return role_permissions("admin")
    member = Membership.objects.filter(user=user, unit=unit).first()
    return (
        role_permissions(member.role, member.permissions)
        if member
        else {k: "none" for k in SECTIONS}
    )


def remote_access(user, connection):
    from core.federation_auth import limited_role

    if not user.is_active:
        return None, {k: "none" for k in SECTIONS}
    explicit = UserAccessProfile.objects.filter(user=user, explicit_units=True).exists()
    grant = RemoteMembership.objects.filter(user=user, connection=connection).first()
    if grant:
        role, policy = grant.role, role_permissions(grant.role, grant.permissions)
    elif user.is_superuser:
        role, policy = "admin", role_permissions("admin")
    elif not explicit:
        member = Membership.objects.filter(
            user=user, unit=connection.local_unit
        ).first()
        if not member:
            return None, {k: "none" for k in SECTIONS}
        role, policy = member.role, role_permissions(member.role, member.permissions)
    else:
        return None, {k: "none" for k in SECTIONS}
    role = limited_role(role, connection.remote_role)
    policy = intersect_permissions(
        policy,
        role_permissions(role),
        role_permissions(connection.remote_role, connection.remote_permissions),
    )
    policy["users"] = (
        "none"  # User administration cannot be delegated by an instance key.
    )
    policy["operationsAdmin"] = "none"
    return role, policy


def required_sections(resource, method, params):
    root = resource.split("/")[0]
    sections = list(RESOURCES.get(root, []))
    if method in {"GET", "HEAD", "OPTIONS"}:
        if root == "sheet-imports" and resource.rstrip("/") == "sheet-imports/schema":
            sections.append("operationsAdmin")
        if root == "rules":
            sections.append("operationsAdmin")
        if root in {"appointments", "agenda-items"}:
            if params.get("group"):
                sections.append("groups")
            if params.get("operational_pending") == "true":
                sections.append("issues")
        if root in {"cases", "contacts"}:
            sections.append("groups")
        if root == "members":
            sections.append("operationsAdmin")
    return sections


def check_resource(policy, resource, method, params):
    root = resource.split("/")[0]
    if root == "workspace":
        if any(v != "none" for v in policy.values()):
            return
    required = 1 if method in {"GET", "HEAD", "OPTIONS"} else 2
    if any(
        LEVELS[policy.get(section, "none")] >= required
        for section in required_sections(resource, method, params)
    ):
        return
    raise PermissionDenied(
        "Sem permissão para consultar ou editar esta seção na unidade."
    )


class SectionPermission(IsAuthenticated):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        path = request.path_info.removeprefix("/api/v1/")
        root = path.split("/")[0]
        if root in {"auth", "schema", "docs", "remote", "federation"}:
            return True
        if root not in RESOURCES and root != "workspace":
            raise PermissionDenied("Recurso não autorizado.")
        from core.permissions import get_unit

        unit = get_unit(request)
        policy = local_permissions(request.user, unit)
        if getattr(request.auth, "effective_role", None):
            policy = intersect_permissions(
                policy, role_permissions(request.auth.effective_role)
            )
        check_resource(policy, path, request.method, request.query_params)
        return True
