from rest_framework.exceptions import PermissionDenied, ValidationError

from core.models import Membership, Unit


def get_unit(request, roles=None):
    from core.models import InstanceAccessKey

    access = request.auth if isinstance(request.auth, InstanceAccessKey) else None
    slug = request.query_params.get("unit", access.unit.slug if access else "ame")
    if access and slug != access.unit.slug:
        raise PermissionDenied("Chave não autorizada para esta unidade.")
    try:
        unit = Unit.objects.get(slug=slug)
    except Unit.DoesNotExist:
        raise ValidationError("Unidade não encontrada.") from None
    role = (
        "admin"
        if request.user.is_superuser
        else Membership.objects.filter(user=request.user, unit=unit).values_list("role", flat=True).first()
    )
    if access:
        role = access.effective_role
    if role is None or (roles and role not in roles):
        raise PermissionDenied("Sem permissão para esta operação na unidade.")
    return unit
