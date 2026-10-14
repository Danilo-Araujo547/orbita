"""Unit-scoped credentials and GET-only Meta diagnostics. Never enables transport."""

import re
import time

import requests
from core.models import Audit
from core.permissions import get_unit
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from operations.services import Conflict, idempotent
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from messaging.models import MetaConfiguration, Template

SECRETS = {
    "access_token": "token_ciphertext",
    "app_secret": "app_secret_ciphertext",
    "verify_token": "verify_token_ciphertext",
}


def cipher():
    try:
        return Fernet(settings.META_CREDENTIALS_KEY.encode())
    except (ValueError, AttributeError, TypeError):
        raise ValidationError("Chave de proteção das credenciais não configurada no servidor.") from None


class ConfigInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)
    waba_id = serializers.RegexField(r"^\d{1,40}$", allow_blank=True)
    phone_number_id = serializers.RegexField(r"^\d{1,40}$", allow_blank=True)
    business_id = serializers.RegexField(r"^\d{1,40}$", allow_blank=True, required=False)
    app_id = serializers.RegexField(r"^\d{1,40}$", allow_blank=True, required=False)
    api_version = serializers.RegexField(r"^v\d{1,3}\.\d{1,2}$")
    access_token = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=8192)
    app_secret = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=1024)
    verify_token = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=1024)
    clear_secrets = serializers.ListField(
        child=serializers.ChoiceField(choices=list(SECRETS)), required=False
    )


class CheckInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class RemoteTemplateOutput(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    language = serializers.CharField()
    status = serializers.CharField()
    category = serializers.CharField()
    components = serializers.JSONField()
    body = serializers.CharField()
    parameters = serializers.ListField(child=serializers.CharField())
    checks = serializers.ListField(child=serializers.CharField())


class ConfigOutput(serializers.Serializer):
    unit = serializers.CharField()
    version = serializers.IntegerField()
    waba_id = serializers.CharField()
    phone_number_id = serializers.CharField()
    business_id = serializers.CharField()
    app_id = serializers.CharField()
    api_version = serializers.CharField()
    has_access_token = serializers.BooleanField()
    has_app_secret = serializers.BooleanField()
    has_verify_token = serializers.BooleanField()
    sending_enabled = serializers.BooleanField()
    validation_state = serializers.CharField()
    validation_code = serializers.CharField()
    checked_at = serializers.DateTimeField(allow_null=True)
    account_name = serializers.CharField()
    display_phone_number = serializers.CharField()
    verified_name = serializers.CharField()
    templates_synced_at = serializers.DateTimeField(allow_null=True)
    templates = RemoteTemplateOutput(many=True)


def template_output(remote, unit):
    components = remote.get("components", [])
    body = next((str(c.get("text", "")) for c in components if c.get("type") == "BODY"), "")
    params = list(dict.fromkeys(re.findall(r"\{\{\s*([\w]+)\s*\}\}", body)))
    local = Template.objects.filter(
        unit=unit, name=remote.get("name"), language=remote.get("language")
    ).first()
    checks = []
    if remote.get("status") != "APPROVED":
        checks.append("Template não aprovado pela Meta.")
    if not local:
        checks.append("Sem correspondência no catálogo local.")
    else:
        if len(local.fields) != len(params):
            checks.append("Quantidade de variáveis diferente do cadastro local.")
        if local.body.strip() != body.strip():
            checks.append("Texto diferente do cadastro local.")
        if any(not p.isdigit() for p in params):
            checks.append("Parâmetros nomeados exigem revisão do mapeamento local.")
        elif set(params) != {str(i) for i in range(1, len(params) + 1)}:
            checks.append("A sequência de variáveis posicionais exige revisão.")
    if any(c.get("type") in {"HEADER", "BUTTONS"} for c in components):
        checks.append("Cabeçalho e botões exigem revisão do mapeamento antes de habilitar envio.")
    return {**remote, "body": body, "parameters": params, "checks": checks}


def output(config, unit):
    if config is None:
        config = MetaConfiguration(unit=unit, version=0)
    return {
        "unit": unit.slug,
        "version": config.version,
        **{
            k: getattr(config, k)
            for k in (
                "waba_id",
                "phone_number_id",
                "business_id",
                "app_id",
                "api_version",
                "validation_state",
                "validation_code",
                "checked_at",
                "account_name",
                "display_phone_number",
                "verified_name",
                "templates_synced_at",
            )
        },
        **{"has_" + k: bool(getattr(config, field)) for k, field in SECRETS.items()},
        "sending_enabled": False,
        "templates": [template_output(t, unit) for t in config.templates],
    }


class MetaReadError(Exception):
    def __init__(self, code):
        self.code = code


class MetaReader:
    def __init__(self, config):
        self.config = config
        try:
            self.token = cipher().decrypt(config.token_ciphertext.encode()).decode()
        except (InvalidToken, UnicodeError):
            raise MetaReadError("credentials_unreadable") from None
        self.deadline = time.monotonic() + 35

    def get(self, path, **params):
        if time.monotonic() >= self.deadline:
            raise MetaReadError("validation_timeout")
        try:
            response = requests.get(
                f"https://graph.facebook.com/{self.config.api_version}/{path}",
                headers={"Authorization": f"Bearer {self.token}"},
                params=params,
                timeout=(3, 8),
                allow_redirects=False,
            )
            if len(response.content) > 4_000_000:
                raise MetaReadError("provider_response_too_large")
            data = response.json()
            if response.status_code != 200 or not isinstance(data, dict) or "error" in data:
                error = data.get("error") if isinstance(data, dict) else None
                code = error.get("code") if isinstance(error, dict) else None
                raise MetaReadError(
                    "meta_" + str(code) if isinstance(code, int) else "provider_access_denied"
                )
            return data
        except requests.RequestException:
            raise MetaReadError("connection_failed") from None
        except ValueError:
            raise MetaReadError("invalid_provider_response") from None

    def collection(self, edge, fields):
        rows, after, seen = [], None, set()
        for _ in range(20):
            data = self.get(
                f"{self.config.waba_id}/{edge}",
                fields=fields,
                limit=100,
                **({"after": after} if after else {}),
            )
            page = data.get("data")
            if not isinstance(page, list) or any(not isinstance(item, dict) for item in page):
                raise MetaReadError("invalid_provider_response")
            rows.extend(page)
            if len(rows) > 1000:
                raise MetaReadError("catalog_limit_exceeded")
            paging = data.get("paging", {})
            if not paging.get("next"):
                return rows
            # Never follow provider URLs: they may contain tokens or point outside Graph.
            after = paging.get("cursors", {}).get("after")
            if not isinstance(after, str) or not after or len(after) > 4096 or after in seen:
                raise MetaReadError("invalid_pagination")
            seen.add(after)
        raise MetaReadError("catalog_limit_exceeded")

    def validate(self):
        account = self.get(self.config.waba_id, fields="id,name")
        if account.get("id") != self.config.waba_id:
            raise MetaReadError("waba_mismatch")
        phones = self.collection("phone_numbers", "id,display_phone_number,verified_name")
        phone = next((p for p in phones if p.get("id") == self.config.phone_number_id), None)
        if phone is None:
            raise MetaReadError("phone_not_in_waba")
        templates = self.collection("message_templates", "id,name,language,status,category,components")
        catalog = []
        for item in templates:
            if not all(
                isinstance(item.get(k), str) for k in ("id", "name", "language", "status", "category")
            ):
                raise MetaReadError("invalid_provider_response")
            components = item.get("components", [])
            if not isinstance(components, list) or any(not isinstance(c, dict) for c in components):
                raise MetaReadError("invalid_provider_response")
            # Examples are deliberately excluded: they may contain personal data.
            clean = [{k: c[k] for k in ("type", "text", "format", "buttons") if k in c} for c in components]
            catalog.append(
                {
                    **{k: item[k] for k in ("id", "name", "language", "status", "category")},
                    "components": clean,
                }
            )
        return account, phone, catalog


class MetaConfigurationViewSet(viewsets.GenericViewSet):
    serializer_class = ConfigOutput
    queryset = MetaConfiguration.objects.none()

    def list(self, request):
        unit = get_unit(request, ["admin"])
        return Response(output(MetaConfiguration.objects.filter(unit=unit).first(), unit))

    @extend_schema(request=ConfigInput, responses=ConfigOutput)
    @action(detail=False, methods=["post"])
    def configure(self, request):
        unit = get_unit(request, ["admin"])
        values = ConfigInput(data=request.data)
        values.is_valid(raise_exception=True)
        data = values.validated_data

        def execute():
            config = MetaConfiguration.objects.filter(unit=unit).first()
            if (config.version if config else 0) != data["version"]:
                raise Conflict()
            config = config or MetaConfiguration(unit=unit, version=0)
            for key in ("waba_id", "phone_number_id", "business_id", "app_id", "api_version"):
                if key in data:
                    setattr(config, key, data[key])
            for key, field in SECRETS.items():
                if key in data.get("clear_secrets", []):
                    setattr(config, field, "")
                elif data.get(key):
                    setattr(config, field, cipher().encrypt(data[key].encode()).decode())
            config.version += 1
            config.validation_state = "not_checked"
            config.validation_code = ""
            config.checked_at = None
            config.templates = []
            config.templates_synced_at = None
            config.account_name = config.display_phone_number = config.verified_name = ""
            config.save()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="meta.configured",
                object_id=str(config.pk),
                details={"version": config.version},
            )
            return output(config, unit)

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"action": "meta.configure", "data": data},
                execute,
            )
        )

    @extend_schema(request=CheckInput, responses=ConfigOutput)
    @action(detail=False, methods=["post"], url_path="validate")
    def validate_config(self, request):
        unit = get_unit(request, ["admin"])
        values = CheckInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            config = MetaConfiguration.objects.filter(unit=unit).first()
            if not config or config.version != values.validated_data["version"]:
                raise Conflict()
            if not config.token_ciphertext or not config.waba_id or not config.phone_number_id:
                raise ValidationError("Informe WABA, ID do número e token de acesso antes de validar.")
            try:
                account, phone, templates = MetaReader(config).validate()
                config.validation_state, config.validation_code = "valid", ""
                config.account_name = str(account.get("name", ""))[:255]
                config.display_phone_number = str(phone.get("display_phone_number", ""))[:80]
                config.verified_name = str(phone.get("verified_name", ""))[:255]
                config.templates = templates
                config.templates_synced_at = timezone.now()
            except MetaReadError as error:
                config.validation_state, config.validation_code = "error", error.code
                # Keep last successful catalog, clearly dated, for investigation.
            config.checked_at = timezone.now()
            config.version += 1
            config.save()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="meta.validated",
                object_id=str(config.pk),
                details={
                    "state": config.validation_state,
                    "code": config.validation_code,
                    "templates": len(config.templates),
                },
            )
            return output(config, unit)

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"action": "meta.validate", "data": values.validated_data},
                execute,
            )
        )
