import hashlib
import hmac
from datetime import datetime
from datetime import timezone as dt_timezone

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from operations.services import Conflict, idempotent
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from core.models import Audit, OracleConfiguration
from core.oracle_credentials import access, connect, decrypt, derive, encrypt, unlocked, wrap_service_key
from core.permissions import get_unit


class PasswordInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)
    admin_password = serializers.CharField(write_only=True, max_length=1024, trim_whitespace=False)


class ConfigurationInput(PasswordInput):
    host = serializers.RegexField(r"^[a-zA-Z0-9][a-zA-Z0-9.\-:]{0,252}$")
    port = serializers.IntegerField(min_value=1, max_value=65535, default=1521)
    identifier_type = serializers.ChoiceField(choices=["service", "sid"])
    identifier = serializers.RegexField(r"^[a-zA-Z0-9_.$\-]{1,128}$")
    username = serializers.CharField(max_length=128)
    password = serializers.CharField(write_only=True, max_length=1024, trim_whitespace=False)
    timeout_ms = serializers.IntegerField(min_value=1000, max_value=120000, default=30000)


class OracleVersionInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class ConfigurationOutput(serializers.Serializer):
    unit = serializers.CharField()
    version = serializers.IntegerField()
    configured = serializers.BooleanField()
    legacy_configured = serializers.BooleanField()
    unlocked = serializers.BooleanField()
    unlocked_until = serializers.DateTimeField(allow_null=True)
    persistent_access = serializers.BooleanField()
    protected_by = serializers.CharField()
    validation_state = serializers.CharField()
    checked_at = serializers.DateTimeField(allow_null=True)
    details = serializers.JSONField(allow_null=True)
    client_mode = serializers.CharField()


def receipt_payload(values):
    # A plain SHA256 receipt containing only version + admin password would
    # bypass scrypt's protection against offline password guessing.
    return {
        key: hmac.new(settings.SECRET_KEY.encode(), (key + "\0" + value).encode(), hashlib.sha256).hexdigest()
        if key in {"password", "admin_password"}
        else value
        for key, value in values.items()
    }


def output(config, unit):
    from django.conf import settings
    from scheduling.connectors import OracleSource

    active = None
    details = None
    if config:
        try:
            active = access(config)
            if active:
                details = {k: v for k, v in decrypt(config, active[0]).items() if k != "password"}
        except ValueError:
            active = None
    return {
        "unit": unit.slug,
        "version": config.version if config else 0,
        "configured": bool(config),
        "unlocked": bool(active),
        "legacy_configured": not config and all(OracleSource(unit).credentials()),
        "unlocked_until": datetime.fromtimestamp(active[1], dt_timezone.utc)
        if active and active[1] is not None
        else None,
        "persistent_access": bool(config and config.service_key_ciphertext),
        "protected_by": config.owner.get_username() if config else "",
        "validation_state": config.validation_state if config else "not_checked",
        "checked_at": config.checked_at if config else None,
        "details": details,
        "client_mode": "Thick" if settings.ORACLE_THICK else "Thin",
    }


class OracleConfigurationViewSet(viewsets.ViewSet):
    """Configuration is local and cannot be delegated via federation keys."""

    def unit(self, request):
        if request.auth is not None:
            raise PermissionDenied("Configure o Oracle na instância de origem com a sessão do administrador.")
        return get_unit(request, ["admin"])

    @extend_schema(responses=ConfigurationOutput)
    def list(self, request):
        unit = self.unit(request)
        return Response(
            output(OracleConfiguration.objects.select_related("owner").filter(unit=unit).first(), unit)
        )

    def password(self, request, values):
        if not request.user.check_password(values["admin_password"]):
            raise ValidationError("Senha do administrador inválida.")

    @extend_schema(request=ConfigurationInput, responses=ConfigurationOutput)
    @action(detail=False, methods=["post"])
    @transaction.atomic
    def configure(self, request):
        unit = self.unit(request)
        form = ConfigurationInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        self.password(request, values)

        def execute():
            config = OracleConfiguration.objects.select_related("owner").filter(unit=unit).first()
            if values["version"] != (config.version if config else 0):
                raise Conflict()
            payload = {k: v for k, v in values.items() if k not in {"admin_password", "version"}}
            salt, ciphertext, key = encrypt(payload, values["admin_password"])
            if not config:
                config = OracleConfiguration(unit=unit, version=0)
            config.owner = request.user
            config.salt, config.ciphertext = salt, ciphertext
            config.service_key_ciphertext = wrap_service_key(key)
            config.operational_enabled = True
            config.version += 1
            config.checked_at = None
            config.validation_state = "not_checked"
            config.save()
            Audit.objects.create(
                unit=unit, actor=request.user, action="oracle.configure", details={"version": config.version}
            )
            # No decrypted connection data or passwords in idempotency receipts.
            return {"version": config.version}

        try:
            idempotent(
                unit, request.user, request.headers.get("Idempotency-Key"), receipt_payload(values), execute
            )
        except ValueError:
            raise ValidationError(
                "O serviço de desbloqueio está indisponível. Nenhuma configuração foi salva."
            ) from None
        return self.list(request)

    @extend_schema(request=PasswordInput, responses=ConfigurationOutput)
    @action(detail=False, methods=["post"])
    @transaction.atomic
    def unlock(self, request):
        return self.change(request, "unlock")

    @extend_schema(request=OracleVersionInput, responses=ConfigurationOutput)
    @action(detail=False, methods=["post"])
    @transaction.atomic
    def lock(self, request):
        return self.change(request, "lock")

    def change(self, request, operation):
        unit = self.unit(request)
        form = (PasswordInput if operation == "unlock" else OracleVersionInput)(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        if operation == "unlock":
            self.password(request, values)

        def execute():
            config = OracleConfiguration.objects.select_related("owner").filter(unit=unit).first()
            if not config or config.version != values["version"]:
                raise Conflict()
            if operation == "unlock":
                if config.owner_id != request.user.pk:
                    raise ValidationError(
                        "Somente o administrador que protegeu esta configuração pode desbloqueá-la. Outro administrador pode substituir a configuração completa."
                    )
                if config.service_key_ciphertext:
                    # Reactivation uses the existing server-protected key, even after an admin password change.
                    config.operational_enabled = True
                    key = access(config)[0]
                else:
                    key = derive(values["admin_password"], config.salt)
                try:
                    decrypt(config, key)
                except ValueError:
                    raise ValidationError(
                        "A senha mudou desde o cadastro. Configure novamente as credenciais Oracle com a senha atual."
                    ) from None
                config.service_key_ciphertext = wrap_service_key(key)
                config.operational_enabled = True
            else:
                config.operational_enabled = False
            config.save(update_fields=["service_key_ciphertext", "operational_enabled", "updated_at"])
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action=f"oracle.{operation}",
                details={"version": config.version},
            )
            return {"version": config.version}

        try:
            idempotent(
                unit, request.user, request.headers.get("Idempotency-Key"), receipt_payload(values), execute
            )
        except ValueError:
            raise ValidationError("O serviço de desbloqueio está indisponível.") from None
        return self.list(request)

    @extend_schema(request=OracleVersionInput, responses=ConfigurationOutput)
    @action(detail=False, methods=["post"], url_path="test")
    @transaction.atomic
    def test_connection(self, request):
        unit = self.unit(request)
        form = OracleVersionInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data

        def execute():
            config = OracleConfiguration.objects.select_related("owner").filter(unit=unit).first()
            if not config or config.version != values["version"]:
                raise Conflict()
            try:
                payload = unlocked(config)
            except ValueError:
                raise ValidationError("Ative a conexão antes de testar.") from None
            try:
                with connect(payload) as connection:
                    try:
                        with connection.cursor() as cursor:
                            cursor.execute("SET TRANSACTION READ ONLY")
                            cursor.execute("SELECT 1 FROM DUAL")
                            if cursor.fetchone()[0] != 1:
                                raise ValueError()
                    finally:
                        connection.rollback()
                config.validation_state = "connected"
            except Exception:
                # Driver messages can contain DSNs, usernames and SQL; never expose them.
                config.validation_state = "connection_failed"
            config.checked_at = timezone.now()
            config.save(update_fields=["validation_state", "checked_at"])
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="oracle.test",
                details={"state": config.validation_state},
            )
            return {"state": config.validation_state}

        idempotent(
            unit, request.user, request.headers.get("Idempotency-Key"), receipt_payload(values), execute
        )
        return self.list(request)
