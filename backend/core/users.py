from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as PasswordError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from operations.services import Conflict, idempotent
from rest_framework import serializers, viewsets
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from core.access import (
    LEVELS,
    PRIVILEGED,
    SECTIONS,
    local_permissions,
    role_permissions,
    validate_permissions,
)
from core.models import Audit, Membership, RemoteInstance, RemoteMembership, Unit, UserAccessProfile
from core.permissions import get_unit


def scope_options(user):
    units = Unit.objects.all() if user.is_superuser else Unit.objects.filter(membership__user=user)
    options = []
    for unit in units.order_by("name"):
        level = local_permissions(user, unit)["users"]
        if level == "none":
            continue
        options.append(
            {
                "slug": unit.slug,
                "name": unit.name,
                "remote": False,
                "editable": level == "write",
                "max_role": "admin",
                "permissions": role_permissions("admin"),
            }
        )
        for remote in RemoteInstance.objects.filter(local_unit=unit).order_by("name"):
            options.append(
                {
                    "slug": "remote:" + str(remote.pk),
                    "name": remote.remote_unit.get("name", remote.name),
                    "remote": True,
                    "instance_name": remote.name,
                    "enabled": remote.enabled,
                    "editable": level == "write",
                    "max_role": remote.remote_role,
                    "permissions": {
                        **role_permissions(remote.remote_role, remote.remote_permissions),
                        "users": "none",
                        "operationsAdmin": "none",
                    },
                }
            )
    return options


def user_output(user, options, actor):
    available = {o["slug"]: o for o in options}
    grants = []
    outside = False
    for membership in Membership.objects.filter(user=user).select_related("unit"):
        slug = membership.unit.slug
        if slug not in available:
            outside = True
            continue
        if not available[slug]["editable"]:
            outside = True
        grants.append(
            {
                "unit": slug,
                "role": membership.role,
                "permissions": role_permissions(membership.role, membership.permissions),
            }
        )
    for membership in RemoteMembership.objects.filter(user=user).select_related("connection"):
        slug = "remote:" + str(membership.connection_id)
        if slug not in available:
            outside = True
            continue
        if not available[slug]["editable"]:
            outside = True
        grants.append(
            {
                "unit": slug,
                "role": membership.role,
                "permissions": role_permissions(membership.role, membership.permissions),
            }
        )
    profile = UserAccessProfile.objects.filter(user=user).first()
    if not profile or not profile.explicit_units:
        from core.access import remote_access

        existing = {g["unit"] for g in grants}
        for option in options:
            if option["remote"] and option["slug"] not in existing:
                connection = RemoteInstance.objects.select_related("local_unit").get(
                    pk=option["slug"].split(":", 1)[1]
                )
                role, policy = remote_access(user, connection)
                if role:
                    grants.append({"unit": option["slug"], "role": role, "permissions": policy})
    editable = user.pk != actor.pk and not user.is_superuser and any(o["editable"] for o in options)
    return {
        "id": user.pk,
        "username": user.username,
        "full_name": user.first_name,
        "active": user.is_active,
        "version": profile.version if profile else 0,
        "grants": grants,
        "editable": editable,
        "global_editable": editable and not outside,
        "has_other_units": outside,
        "administrative": user.is_superuser or any(g["role"] == "admin" for g in grants),
    }


class GrantInput(serializers.Serializer):
    unit = serializers.CharField(max_length=100)
    role = serializers.ChoiceField(choices=Membership.Role.choices)
    permissions = serializers.JSONField(default=dict, validators=[validate_permissions])


class UserInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)
    username = serializers.RegexField(r"^[\w.@+-]{3,150}$", required=False)
    full_name = serializers.CharField(max_length=150, allow_blank=True, default="")
    active = serializers.BooleanField(default=True)
    password = serializers.CharField(write_only=True, min_length=12, max_length=200, required=False)
    grants = GrantInput(many=True)


class UserOutput(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    full_name = serializers.CharField()
    active = serializers.BooleanField()
    version = serializers.IntegerField()
    grants = GrantInput(many=True)
    editable = serializers.BooleanField()
    global_editable = serializers.BooleanField()
    has_other_units = serializers.BooleanField()
    administrative = serializers.BooleanField()


class UserOptionsOutput(serializers.Serializer):
    units = serializers.ListField(child=serializers.JSONField())
    sections = serializers.DictField(child=serializers.CharField())


class UserViewSet(viewsets.GenericViewSet):
    authentication_classes = [SessionAuthentication]
    serializer_class = UserOutput
    queryset = get_user_model().objects.none()

    def scoped_users(self, request, options):
        local = [o["slug"] for o in options if not o["remote"]]
        remote = [o["slug"].split(":", 1)[1] for o in options if o["remote"]]
        return (
            get_user_model()
            .objects.filter(
                Q(membership__unit__slug__in=local)
                | Q(remotemembership__connection_id__in=remote)
                | Q(useraccessprofile__managing_unit__slug__in=local)
            )
            .distinct()
            .order_by("username")
        )

    def list(self, request):
        get_unit(request)
        options = scope_options(request.user)
        users = self.scoped_users(request, options)
        if request.query_params.get("search"):
            users = users.filter(
                Q(username__icontains=request.query_params["search"])
                | Q(first_name__icontains=request.query_params["search"])
            )
        page = self.paginate_queryset(users)
        return self.get_paginated_response([user_output(u, options, request.user) for u in page])

    @extend_schema(responses=UserOptionsOutput)
    @action(detail=False, methods=["get"])
    def options(self, request):
        get_unit(request)
        return Response({"units": scope_options(request.user), "sections": SECTIONS})

    @extend_schema(request=UserInput, responses=UserOutput)
    def create(self, request):
        return self.configure_user(request)

    @extend_schema(request=UserInput, responses=UserOutput)
    @action(detail=True, methods=["post"])
    def configure(self, request, pk=None):
        return self.configure_user(request, pk)

    def configure_user(self, request, pk=None):
        anchor = get_unit(request, ["admin"])
        values = UserInput(data=request.data)
        values.is_valid(raise_exception=True)
        data = values.validated_data
        options = scope_options(request.user)
        writable = {o["slug"]: o for o in options if o["editable"]}
        grants = data["grants"]
        if len(grants) > 200 or len({g["unit"] for g in grants}) != len(grants):
            raise ValidationError("Selecione unidades únicas; limite de 200 acessos por operação.")
        for grant in grants:
            if grant["unit"] not in writable:
                raise PermissionDenied("Você não pode conceder ou alterar acesso nesta unidade.")
            option = writable[grant["unit"]]
            from core.federation_auth import RANK

            if RANK[grant["role"]] > RANK[option["max_role"]]:
                raise ValidationError("O perfil excede a permissão da conexão remota.")
            policy = role_permissions(grant["role"], grant["permissions"])
            for section, level in grant["permissions"].items():
                if level == "write" and (
                    grant["role"] == "viewer" or (grant["role"] != "admin" and section in PRIVILEGED)
                ):
                    raise ValidationError(
                        "Edição administrativa exige perfil Administrativo; Consulta não permite edição."
                    )
                if LEVELS[level] > LEVELS[option["permissions"].get(section, "none")]:
                    raise ValidationError("A seção excede as permissões disponíveis na unidade remota.")
            grant["permissions"] = policy
        if data.get("password"):
            try:
                validate_password(data["password"])
            except PasswordError:
                raise ValidationError("Senha não atende aos requisitos de segurança.") from None

        def execute():
            if pk:
                target = get_object_or_404(self.scoped_users(request, options), pk=pk)
                user = get_user_model().objects.select_for_update().get(pk=target.pk)
                if user.pk == request.user.pk or user.is_superuser:
                    raise PermissionDenied("Esta conta administrativa não pode ser alterada por esta tela.")
                profile = UserAccessProfile.objects.select_for_update().filter(user=user).first()
                if (profile.version if profile else 0) != data["version"]:
                    raise Conflict()
                state = user_output(user, options, request.user)
                if not state["global_editable"] and (
                    data["active"] != user.is_active
                    or data["full_name"] != user.first_name
                    or data.get("password")
                ):
                    raise PermissionDenied(
                        "Esta conta também pertence a unidades fora da sua administração. Altere somente os acessos que você administra."
                    )
                if data.get("username") and data["username"] != user.username:
                    raise ValidationError(
                        "O login não pode ser renomeado; preserve a identidade e o histórico."
                    )
            else:
                if data["version"] != 0 or not data.get("username") or not data.get("password"):
                    raise ValidationError("Informe login, senha inicial e versão zero.")
                if get_user_model().objects.filter(username=data["username"]).exists():
                    raise ValidationError(
                        "Login indisponível. Não é permitido vincular uma conta externa ao seu escopo."
                    )
                try:
                    with transaction.atomic():
                        user = get_user_model().objects.create_user(data["username"])
                except IntegrityError:
                    raise ValidationError("Login indisponível.") from None
                profile = None
            user.first_name, user.is_active = data["full_name"], data["active"]
            if data.get("password"):
                user.set_password(data["password"])
            user.save()
            # Preserve grants outside the caller's administration, including read-only scopes.
            local = [s for s in writable if not s.startswith("remote:")]
            remote = [s.split(":", 1)[1] for s in writable if s.startswith("remote:")]
            Membership.objects.filter(user=user, unit__slug__in=local).exclude(
                unit__slug__in=[g["unit"] for g in grants]
            ).delete()
            RemoteMembership.objects.filter(user=user, connection_id__in=remote).exclude(
                connection_id__in=[
                    g["unit"].split(":", 1)[1] for g in grants if g["unit"].startswith("remote:")
                ]
            ).delete()
            for grant in grants:
                if grant["unit"].startswith("remote:"):
                    RemoteMembership.objects.update_or_create(
                        user=user,
                        connection_id=grant["unit"].split(":", 1)[1],
                        defaults={"role": grant["role"], "permissions": grant["permissions"]},
                    )
                else:
                    Membership.objects.update_or_create(
                        user=user,
                        unit=Unit.objects.get(slug=grant["unit"]),
                        defaults={"role": grant["role"], "permissions": grant["permissions"]},
                    )
            profile = profile or UserAccessProfile(user=user, version=0, managing_unit=anchor)
            profile.version += 1
            profile.explicit_units = True
            profile.save()
            Audit.objects.create(
                unit=anchor,
                actor=request.user,
                action="user.access_configured",
                object_id=str(user.pk),
                details={
                    "version": profile.version,
                    "units": [g["unit"] for g in grants],
                    "active": user.is_active,
                },
            )
            return user_output(user, options, request.user)

        return Response(
            idempotent(
                anchor,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"action": "user.configure", "user": pk, "data": data},
                execute,
            )
        )
