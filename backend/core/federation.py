import hashlib
import json
import secrets
from datetime import timedelta
from urllib.parse import parse_qs, urlencode, urlsplit

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from operations.services import Conflict, idempotent
from rest_framework import serializers, viewsets
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.federation_auth import RANK, allowed_resource, limited_role
from core.federation_network import (
    RemoteUnavailable,
    decrypt_key,
    encrypt_key,
    inspect_remote,
    normalized_url,
    remote_http,
)
from core.models import Audit, InstanceAccessKey, Membership, RemoteInstance
from core.permissions import get_unit
from core.serializers import UnitSerializer


def local_role(user, unit):
    if not user.is_active:
        return None
    return (
        "admin"
        if user.is_superuser
        else Membership.objects.filter(user=user, unit=unit).values_list("role", flat=True).first()
    )


def remote_options(user):
    from core.access import remote_access

    qs = RemoteInstance.objects.filter(enabled=True).select_related("local_unit")
    units, roles = [], {}
    for connection in qs.order_by("name", "id"):
        slug = "remote:" + str(connection.pk)
        role, policy = remote_access(user, connection)
        if role not in RANK:
            continue
        units.append(
            {
                **connection.remote_unit,
                "id": str(connection.pk),
                "slug": slug,
                "remote": True,
                "instance_id": str(connection.remote_instance_id),
                "instance_name": connection.name,
                "origin_unit": connection.remote_unit_slug,
                "connection_state": connection.state,
                "permissions": policy,
            }
        )
        roles[slug] = limited_role(role, connection.remote_role)
    return units, roles


class KeySerializer(serializers.ModelSerializer):
    active = serializers.SerializerMethodField()

    def get_active(self, obj) -> bool:
        return not obj.revoked_at and obj.expires_at > timezone.now()

    class Meta:
        model = InstanceAccessKey
        fields = ["id", "name", "role", "created_at", "expires_at", "revoked_at", "last_used_at", "active"]


class KeyInput(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    role = serializers.ChoiceField(choices=Membership.Role.choices, default="viewer")
    validity_days = serializers.IntegerField(min_value=1, max_value=365, default=90)


class IssuedKeyOutput(KeySerializer):
    key = serializers.CharField(read_only=True)

    class Meta(KeySerializer.Meta):
        fields = KeySerializer.Meta.fields + ["key"]


class InstanceKeyViewSet(viewsets.ReadOnlyModelViewSet):
    authentication_classes = [SessionAuthentication]
    serializer_class = KeySerializer
    queryset = InstanceAccessKey.objects.none()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        return InstanceAccessKey.objects.filter(unit=get_unit(self.request, ["admin"])).order_by(
            "-created_at"
        )

    @extend_schema(request=KeyInput, responses=IssuedKeyOutput)
    def create(self, request):
        unit = get_unit(request, ["admin"])
        if not settings.ORBITA_INSTANCE_ID:
            raise ValidationError("Configure ORBITA_INSTANCE_ID no servidor antes de emitir chaves.")
        values = KeyInput(data=request.data)
        values.is_valid(raise_exception=True)
        receipt = request.headers.get("Idempotency-Key", "")
        if not 8 <= len(receipt) <= 100:
            raise ValidationError("Informe Idempotency-Key entre 8 e 100 caracteres.")
        with transaction.atomic():
            type(unit).objects.select_for_update().get(pk=unit.pk)
            if InstanceAccessKey.objects.filter(
                unit=unit, issuer=request.user, issuance_key=receipt
            ).exists():
                raise Conflict(
                    "Esta chave já foi emitida. O segredo não pode ser recuperado; gere outra e revogue a anterior se necessário."
                )
            data = values.validated_data
            key = InstanceAccessKey(
                unit=unit,
                issuer=request.user,
                name=data["name"],
                role=data["role"],
                issuance_key=receipt,
                expires_at=timezone.now() + timedelta(days=data["validity_days"]),
            )
            token = f"orbita_{key.pk.hex}.{secrets.token_urlsafe(32)}"
            key.secret_hash = hashlib.sha256(token.encode()).hexdigest()
            key.save()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="instance.key_issued",
                object_id=str(key.pk),
                details={"role": key.role},
            )
        response = Response({**KeySerializer(key).data, "key": token}, status=201)
        response["Cache-Control"] = "no-store"
        return response

    @extend_schema(request=None, responses=KeySerializer)
    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        unit = get_unit(request, ["admin"])
        key = self.get_object()

        def execute():
            if InstanceAccessKey.objects.filter(pk=key.pk, revoked_at__isnull=True).update(
                revoked_at=timezone.now()
            ):
                Audit.objects.create(
                    unit=unit, actor=request.user, action="instance.key_revoked", object_id=str(key.pk)
                )
            key.refresh_from_db()
            return KeySerializer(key).data

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"action": "instance.key_revoke", "id": pk},
                execute,
            )
        )


class RemoteSerializer(serializers.ModelSerializer):
    has_key = serializers.SerializerMethodField()

    def get_has_key(self, obj) -> bool:
        return bool(obj.key_ciphertext)

    class Meta:
        model = RemoteInstance
        fields = [
            "id",
            "name",
            "base_url",
            "remote_instance_id",
            "remote_unit",
            "remote_unit_slug",
            "remote_role",
            "enabled",
            "version",
            "checked_at",
            "state",
            "error_code",
            "has_key",
        ]


class RemoteInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)
    name = serializers.CharField(max_length=120)
    base_url = serializers.CharField(max_length=500)
    key = serializers.RegexField(
        r"^orbita_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$", write_only=True, required=False, allow_blank=True
    )


class InstanceVersionInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class RemoteInstanceViewSet(viewsets.ReadOnlyModelViewSet):
    authentication_classes = [SessionAuthentication]
    serializer_class = RemoteSerializer
    queryset = RemoteInstance.objects.none()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        return RemoteInstance.objects.filter(local_unit=get_unit(self.request, ["admin"])).order_by("name")

    def configure_connection(self, request, pk=None):
        unit = get_unit(request, ["admin"])
        values = RemoteInput(data=request.data)
        values.is_valid(raise_exception=True)
        data = values.validated_data
        if pk:
            self.get_object()

        def execute():
            connection = get_object_or_404(RemoteInstance, pk=pk, local_unit=unit) if pk else None
            if (connection.version if connection else 0) != data["version"]:
                raise Conflict()
            key = data.get("key") or (decrypt_key(connection.key_ciphertext) if connection else "")
            if not key:
                raise ValidationError("Informe a chave gerada na instância de origem.")
            url = normalized_url(data["base_url"])
            if connection and url != connection.base_url and not data.get("key"):
                raise ValidationError("Ao alterar a URL, informe novamente a chave da instância de destino.")
            manifest = inspect_remote(url, key)
            if connection and (
                manifest["instance_id"] != str(connection.remote_instance_id)
                or manifest["unit"]["slug"] != connection.remote_unit_slug
            ):
                raise ValidationError(
                    "A conexão deve continuar vinculada à mesma instalação e unidade. Para outro destino, crie uma nova conexão."
                )
            duplicates = RemoteInstance.objects.filter(
                local_unit=unit,
                remote_instance_id=manifest["instance_id"],
                remote_unit_slug=manifest["unit"]["slug"],
            )
            if connection:
                duplicates = duplicates.exclude(pk=connection.pk)
            if duplicates.exists():
                raise ValidationError("Esta unidade remota já possui uma conexão cadastrada.")
            connection = connection or RemoteInstance(local_unit=unit, version=0)
            connection.name, connection.base_url = data["name"], url
            connection.key_ciphertext = encrypt_key(key)
            connection.remote_instance_id = manifest["instance_id"]
            connection.remote_unit = manifest["unit"]
            connection.remote_unit_slug = manifest["unit"]["slug"]
            connection.remote_role = manifest["role"]
            connection.remote_permissions = manifest.get("permissions", {})
            connection.enabled, connection.state, connection.error_code = True, "connected", ""
            connection.checked_at, connection.version = timezone.now(), connection.version + 1
            connection.save()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="instance.connected",
                object_id=str(connection.pk),
                details={"version": connection.version},
            )
            return RemoteSerializer(connection).data

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"action": "instance.configure", "id": pk, "data": data},
                execute,
            )
        )

    @extend_schema(request=RemoteInput, responses=RemoteSerializer)
    def create(self, request):
        return self.configure_connection(request)

    @extend_schema(request=RemoteInput, responses=RemoteSerializer)
    @action(detail=True, methods=["post"])
    def configure(self, request, pk=None):
        return self.configure_connection(request, pk)

    @extend_schema(request=InstanceVersionInput, responses=RemoteSerializer)
    @action(detail=True, methods=["post"])
    def check(self, request, pk=None):
        return self.update_status(request, pk, False)

    @extend_schema(request=InstanceVersionInput, responses=RemoteSerializer)
    @action(detail=True, methods=["post"])
    def disconnect(self, request, pk=None):
        return self.update_status(request, pk, True)

    def update_status(self, request, pk, disconnect):
        unit = get_unit(request, ["admin"])
        self.get_object()
        values = InstanceVersionInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            connection = RemoteInstance.objects.get(pk=pk, local_unit=unit)
            if connection.version != values.validated_data["version"]:
                raise Conflict()
            if disconnect:
                connection.enabled, connection.state = False, "disconnected"
            else:
                try:
                    manifest = inspect_remote(connection.base_url, decrypt_key(connection.key_ciphertext))
                    if (
                        manifest["instance_id"] != str(connection.remote_instance_id)
                        or manifest["unit"]["slug"] != connection.remote_unit_slug
                    ):
                        raise RemoteUnavailable("identity_changed")
                    connection.remote_unit, connection.remote_role = manifest["unit"], manifest["role"]
                    connection.remote_permissions = manifest.get("permissions", {})
                    connection.state, connection.error_code = "connected", ""
                except (RemoteUnavailable, ValidationError) as error:
                    connection.state, connection.error_code = (
                        "unavailable",
                        getattr(error, "code", "access_denied"),
                    )
                connection.checked_at = timezone.now()
            connection.version += 1
            connection.save()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="instance.disconnected" if disconnect else "instance.checked",
                object_id=str(connection.pk),
                details={"state": connection.state},
            )
            return RemoteSerializer(connection).data

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {
                    "action": "instance.disconnect" if disconnect else "instance.check",
                    "id": pk,
                    "data": values.validated_data,
                },
                execute,
            )
        )


class ManifestOutput(serializers.Serializer):
    protocol = serializers.CharField()
    instance_id = serializers.UUIDField()
    unit = UnitSerializer()
    role = serializers.CharField()
    sending_enabled = serializers.BooleanField()
    permissions = serializers.DictField(child=serializers.CharField())


class ManifestView(APIView):
    @extend_schema(responses=ManifestOutput)
    def get(self, request):
        from core.access import intersect_permissions, local_permissions, role_permissions

        if not isinstance(request.auth, InstanceAccessKey):
            raise PermissionDenied("Use uma chave de instância para consultar o manifesto.")
        return Response(
            {
                "protocol": "orbita-federation/1",
                "instance_id": settings.ORBITA_INSTANCE_ID,
                "unit": UnitSerializer(get_unit(request)).data,
                "role": request.auth.effective_role,
                "sending_enabled": False,
                "permissions": intersect_permissions(
                    local_permissions(request.user, get_unit(request)),
                    role_permissions(request.auth.effective_role),
                ),
            },
            headers={"Cache-Control": "no-store"},
        )


class RemoteProxyView(APIView):
    authentication_classes = [SessionAuthentication]

    @extend_schema(
        responses={
            (200, "application/json"): OpenApiTypes.OBJECT,
            (200, "text/csv"): OpenApiTypes.BINARY,
            (200, "application/pdf"): OpenApiTypes.BINARY,
        }
    )
    def get(self, request, connection_id, resource):
        return self.relay(request, connection_id, resource)

    @extend_schema(
        request=OpenApiTypes.OBJECT,
        responses=OpenApiTypes.OBJECT,
        parameters=[OpenApiParameter("Idempotency-Key", str, OpenApiParameter.HEADER, required=True)],
    )
    def post(self, request, connection_id, resource):
        return self.relay(request, connection_id, resource)

    def relay(self, request, connection_id, resource):
        connection = get_object_or_404(
            RemoteInstance.objects.select_related("local_unit"), pk=connection_id, enabled=True
        )
        from core.access import check_resource, remote_access

        role, policy = remote_access(request.user, connection)
        if role not in RANK:
            raise PermissionDenied("Sem acesso a esta conexão remota.")
        if not allowed_resource(resource):
            raise PermissionDenied("Recurso não disponível pela conexão remota.")
        check_resource(policy, resource, request.method, request.query_params)
        role = limited_role(role, connection.remote_role)
        if request.method != "GET" and role == "viewer":
            raise PermissionDenied("Seu perfil permite somente consulta remota.")
        key = request.headers.get("Idempotency-Key", "")
        if request.method != "GET" and not 8 <= len(key) <= 100:
            raise ValidationError("Ações remotas exigem Idempotency-Key entre 8 e 100 caracteres.")
        body = request.body
        if len(body) > 8 * 1024 * 1024:
            raise ValidationError("Conteúdo excede o limite da conexão remota.")
        params = {k: request.query_params.getlist(k) for k in request.query_params if k != "unit"}
        params["unit"] = connection.remote_unit_slug
        code, headers, content = remote_http(
            connection.base_url,
            decrypt_key(connection.key_ciphertext),
            resource,
            method=request.method,
            query=params,
            body=body,
            role=role,
            idempotency=key,
            content_type=request.headers.get("Content-Type", "application/json"),
        )
        content_type = next((v for k, v in headers.items() if k.lower() == "content-type"), "")
        if code in {401, 403}:
            return Response(
                {
                    "detail": "A instância remota recusou o acesso. Verifique a chave e as permissões na origem."
                },
                status=code,
                headers={"Cache-Control": "no-store"},
            )
        if code >= 500:
            raise RemoteUnavailable("remote_error", request.method != "GET")
        if content_type.startswith("application/json"):
            try:
                data = json.loads(content)
            except (ValueError, UnicodeError):
                raise RemoteUnavailable("invalid_response", request.method != "GET") from None
            if isinstance(data, dict):
                for field in ("next", "previous"):
                    if isinstance(data.get(field), str):
                        params = parse_qs(urlsplit(data[field]).query)
                        params.pop("unit", None)
                        data[field] = (
                            f"/api/v1/remote/{connection.pk}/{resource}?{urlencode(params, doseq=True)}"
                        )
            return Response(data, status=code, headers={"Cache-Control": "no-store", "X-Orbita-Remote": "1"})
        if code != 200 or content_type.split(";")[0] not in {"text/csv", "text/plain", "application/pdf"}:
            raise RemoteUnavailable("invalid_response", request.method != "GET")
        response = HttpResponse(content, content_type=content_type)
        extension = "pdf" if "pdf" in content_type else "csv" if "csv" in content_type else "txt"
        response["Content-Disposition"] = f'attachment; filename="orbita-remoto.{extension}"'
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
