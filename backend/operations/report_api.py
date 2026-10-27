from operations.report_app_api import AppDataResponseSchema
import base64
import re

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from core.models import Audit, Membership
from core.permissions import get_unit
from operations import models as m
from operations.report_engine import connect, parameters, seal
from operations.report_canvas.api import CanvasConfigSchema, CanvasPreviewSchema, CanvasPreviewResult, CanvasSourcePreviewSchema, CanvasSourcePreviewResult, CanvasAssetSchema
from operations.reporting import (
    enqueue,
    execution_access,
    grant_for,
    is_admin,
    make_execution,
    readiness,
)
from operations.serializers import model_serializer
from operations.services import Conflict, idempotent
from operations.views import ConfigViewSet, ReportViewSet, ScopedRead


class ReportPagination(PageNumberPagination):
    page_size = 25


class ReportCatalogVersionInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class PreviewInput(serializers.Serializer):
    parameters = serializers.JSONField(default=dict)


class PreviewOutput(serializers.Serializer):
    columns = serializers.ListField(child=serializers.CharField())
    rows = serializers.ListField(
        child=serializers.ListField(child=serializers.CharField())
    )
    total = serializers.IntegerField()
    real_sends = serializers.BooleanField()


class ExecutionInput(PreviewInput):
    report = serializers.IntegerField(min_value=1)
    recipient = serializers.IntegerField(required=False, allow_null=True, min_value=1)


class VerifyInput(ReportCatalogVersionInput):
    evidence = serializers.CharField(min_length=5, max_length=1000)


class ConnectionSerializer(
    model_serializer(
        m.ReportConnection,
        ["version", "validated", "checked_at", "validation_error", "legacy"],
    )
):
    password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        trim_whitespace=False,
        max_length=1024,
    )
    admin_password = serializers.CharField(
        write_only=True, required=True, trim_whitespace=False, max_length=1024
    )
    source_description = serializers.SerializerMethodField()

    def get_source_description(self, obj) -> str:
        return obj.legacy.get("source_description", "")

    has_password = serializers.SerializerMethodField()

    class Meta:
        model = m.ReportConnection
        exclude = ("ciphertext",)
        read_only_fields = [  # noqa: RUF012
            "unit",
            "version",
            "validated",
            "checked_at",
            "validation_error",
            "legacy",
        ]

    def get_has_password(self, obj) -> bool:
        return bool(obj.ciphertext)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not self.context["request"].user.check_password(
            attrs.pop("admin_password", "")
        ):
            raise ValidationError("Senha do administrador inválida.")
        for key, low, high in [
            ("port", 1, 65535),
            ("timeout_seconds", 1, 60),
            ("max_rows", 1, 10000),
        ]:
            if key in attrs and not low <= attrs[key] <= high:
                raise ValidationError("Valor inválido: " + key)
        if "options" in attrs:
            options = attrs["options"]
            if (
                not isinstance(options, dict)
                or set(options) - {"identifier_type", "charset"}
                or options.get("identifier_type", "service") not in {"service", "sid"}
                or options.get("charset", "UTF8")
                not in {"UTF8", "WIN1252", "ISO8859_1"}
            ):
                raise ValidationError("Opções de conexão inválidas.")
        if attrs.get("host") and not re.fullmatch(
            r"[A-Za-z0-9.:-]{1,253}", attrs["host"]
        ):
            raise ValidationError("Host inválido.")
        name = attrs.get("name", self.instance.name if self.instance else "")
        duplicate = m.ReportConnection.objects.filter(
            unit=self.context["unit"], name=name
        )
        if self.instance:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if duplicate.exists():
            raise ValidationError("Nome de conexão j? cadastrado.")
        return attrs

    def save(self, **kwargs):
        password = self.validated_data.pop("password", None)
        changed = (
            not self.instance
            or any(
                k in self.validated_data
                and self.validated_data[k] != getattr(self.instance, k)
                for k in (
                    "engine",
                    "host",
                    "port",
                    "database",
                    "username",
                    "options",
                    "timeout_seconds",
                )
            )
            or password is not None
        )
        admin_password = self.context["request"].data.get("admin_password", "")
        if password is not None:
            self.validated_data["ciphertext"] = seal(password, admin_password)
        if changed:
            self.validated_data.update(
                validated=False, checked_at=None, validation_error=""
            )
        return super().save(**kwargs)


class CatalogSerializer(model_serializer(m.ReportDefinition, ["version", "legacy", "canvas_layout", "canvas_enabled"])):
    used_by = serializers.SerializerMethodField()

    def get_used_by(self, obj) -> list[dict]:
        request = self.context.get("request")
        if request and not is_admin(request.user, obj.unit):
            return []
        key = ("component_parents", obj.unit_id)
        if key not in self.context:
            parents = {}
            for parent in m.ReportDefinition.objects.filter(unit_id=obj.unit_id).values("id", "code", "name", "components", "legacy"):
                current = parent["components"] or []
                previous = parent["legacy"].get("migration", {}).get("previous_definition", {}).get("components", []) if isinstance(parent["legacy"], dict) else []
                for entries, legacy in ((current, False), (previous, True)):
                    for entry in entries:
                        if isinstance(entry, dict) and entry.get("code"):
                            item = {"id": parent["id"], "code": parent["code"], "name": parent["name"], "legacy": legacy}
                            bucket = parents.setdefault(entry["code"], [])
                            if not any(x["id"] == item["id"] for x in bucket):
                                bucket.append(item)
            self.context[key] = parents
        return self.context[key].get(obj.code, [])
    description = serializers.CharField(required=False, allow_blank=True, max_length=16000, trim_whitespace=False)

    def update(self, instance, validated_data):
        if "description" in validated_data:
            validated_data["legacy"] = {**instance.legacy, "report_description": validated_data.pop("description")}
        return super().update(instance, validated_data)

    def create(self, validated_data):
        if "description" in validated_data:
            validated_data["legacy"] = {**validated_data.get("legacy", {}), "report_description": validated_data.pop("description")}
        return super().create(validated_data)

    technical_description = serializers.SerializerMethodField()

    def get_technical_description(self, obj) -> dict | None:
        request = self.context.get("request")
        if request and not is_admin(request.user, obj.unit):
            return None
        from operations.report_descriptions import describe, index_for
        key = ("description_index", obj.unit_id)
        if key not in self.context:
            self.context[key] = index_for(obj.unit_id)
        return describe(obj, self.context[key])

    parameter_audit = serializers.SerializerMethodField()
    source_path = serializers.SerializerMethodField()

    def get_parameter_audit(self, obj) -> dict | None:
        if getattr(self.context.get("view"), "action", None) == "list":
            return None
        request = self.context.get("request")
        if request and not is_admin(request.user, obj.unit):
            return {"items": [], "component_issues": []}
        from operations.report_parameters import parameter_audit

        return parameter_audit(obj)

    def get_source_path(self, obj) -> str:
        return obj.legacy.get("source_path", "")

    pending_items = serializers.SerializerMethodField()
    connection_name = serializers.SerializerMethodField()

    def get_connection_name(self,obj)->str:
        if obj.source=="app" and obj.app_connection_id and obj.app_connection.unit_id==obj.unit_id:
            return obj.app_connection.name
        return obj.connection.name if obj.connection_id else ""


    def get_pending_items(self, obj) -> list[str]:
        return readiness(obj)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if "monthly_goals" in attrs:
            from operations.report_goals import normalize_goals
            attrs["monthly_goals"] = normalize_goals(attrs["monthly_goals"])
        schema = attrs.get(
            "parameter_schema", self.instance.parameter_schema if self.instance else {}
        )
        if not isinstance(schema, dict):
            raise ValidationError("Parâmetros devem ser um objeto.")
        from operations.report_parameters import normalized_schema

        schema = normalized_schema(schema)
        if "parameter_schema" in attrs:
            attrs["parameter_schema"] = schema
        for name, spec in schema.items():
            if (
                not isinstance(spec, dict)
                or not isinstance(spec.get("prompt", ""), str)
                or len(spec.get("prompt", "")) > 1000
            ):
                raise ValidationError("Mensagem do parâmetro inválida: " + name)
            order = spec.get("order", 1)
            if type(order) is not int or not 1 <= order <= 10000:
                raise ValidationError("Ordem inválida: " + name)
            previous = spec.get("not_before")
            if previous and (
                spec.get("type") != "date"
                or previous == name
                or not isinstance(schema.get(previous), dict)
                or schema[previous].get("type") != "date"
            ):
                raise ValidationError("Referência de data inválida: " + name)
        from types import SimpleNamespace

        from operations.report_whatsapp import ordered_parameters

        ordered_parameters(SimpleNamespace(parameter_schema=schema))
        return attrs

    def to_representation(self, obj):
        data = super().to_representation(obj)
        from operations.report_parameters import normalized_schema

        data["parameter_schema"] = normalized_schema(obj.parameter_schema)
        if "report_description" in obj.legacy:
            data["description"] = obj.legacy["report_description"]
        elif data.get("technical_description"):
            from operations.report_descriptions import as_text
            data["description"] = as_text(data["technical_description"])

        if getattr(self.context.get("view"), "action", None) == "list":
            data.pop("canvas_layout", None)
        request = self.context.get("request")
        if request and not is_admin(request.user, obj.unit):
            for field in (
                "query_sql",
                "legacy",
                "components",
                "dependencies",
                "source_path",
                "technical_description",
                "description",
                "app_connection",
                "parameter_audit",
                "canvas_layout",
            ):
                data.pop(field, None)
        return data


class RecipientSerializer(
    model_serializer(
        m.ReportRecipient, ["version", "verified_at", "legacy", "legacy_key"]
    )
):
    manual_reports = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False, write_only=True, max_length=500)
    manual_inactive_reports = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False, write_only=True, max_length=500)
    manual_reports_token = serializers.CharField(required=False, write_only=True, max_length=64, allow_blank=True)
    manual_report_count = serializers.SerializerMethodField()
    pending_items = serializers.SerializerMethodField()

    def get_manual_report_count(self, obj) -> int:
        count = getattr(obj, "manual_report_total", None)
        return count if count is not None else obj.grants.filter(unit=obj.unit, active=True, manual=True, report__catalog_kind="report").count()

    def save(self, **kwargs):
        from operations.recipient_manual_reports import set_manual_reports
        ids = self.validated_data.pop("manual_reports", None)
        inactive_ids = self.validated_data.pop("manual_inactive_reports", None)
        token = self.validated_data.pop("manual_reports_token", "")
        created = self.instance is None
        recipient = super().save(**kwargs)
        if ids is not None:
            set_manual_reports(recipient, ids, token, self.context["request"].user, created=created, inactive_ids=inactive_ids)
            recipient.__dict__.pop("manual_report_total", None)
        return recipient

    def get_pending_items(self, obj) -> list[str]:
        items = []
        if not obj.verified_at:
            items.append("Verificar destinatário")
        if (
            m.ReportRecipient.objects.filter(unit=obj.unit, address=obj.address)
            .exclude(pk=obj.pk)
            .exists()
        ):
            items.append(
                "Endereço compartilhado por outro cadastro; revisar permissões"
            )
        if obj.kind == "group":
            items.append("Transporte de grupo pendente")
        return items

    def validate(self, attrs):
        attrs = super().validate(attrs)
        kind = attrs.get("kind", self.instance.kind if self.instance else "phone")
        value = attrs.get("address", self.instance.address if self.instance else "")
        if kind == "group":
            if not re.fullmatch(r"[0-9-]{5,90}@g\.us", value):
                raise ValidationError("Identificador de grupo inválido.")
        elif not (
            self.instance
            and self.instance.legacy_key
            and value == self.instance.address
        ):
            from scheduling.connectors import normalize_phone

            try:
                value = normalize_phone(value)
            except ValueError:
                raise ValidationError("Telefone inválido.") from None
        attrs["address"] = value
        qs = m.ReportRecipient.objects.filter(unit=self.context["unit"], address=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists() and not (
            self.instance
            and self.instance.legacy_key
            and value == self.instance.address
        ):
            raise ValidationError(
                "Destinatário já cadastrado nesta unidade; edite o cadastro existente."
            )
        user = attrs.get("user")
        if user and (
            not user.is_active
            or not Membership.objects.filter(
                unit=self.context["unit"], user=user
            ).exists()
        ):
            raise ValidationError("Usuário sem vínculo ativo nesta unidade.")
        if self.instance and (
            value != self.instance.address or kind != self.instance.kind
        ):
            attrs["verified_at"] = None
        return attrs


class GrantSerializer(model_serializer(m.ReportGrant, ["version", "legacy"])):
    pending_items = serializers.SerializerMethodField()

    def get_pending_items(self, obj) -> list[str]:
        return (
            ["Mapear parâmetro restritivo do legado"]
            if obj.legacy.get("record", {}).get("PARAMETRO1")
            not in (None, "", "<NULL>")
            and not obj.parameters
            else []
        )

    recipient_name = serializers.CharField(source="recipient.name", read_only=True)
    report_name = serializers.CharField(source="report.name", read_only=True)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        r = attrs.get("report", self.instance.report if self.instance else None)
        a = attrs.get("recipient", self.instance.recipient if self.instance else None)
        activating = attrs.get("active", self.instance.active if self.instance else True)
        if r and r.catalog_kind != "report" and (not self.instance or activating):
            raise ValidationError("Selecione um relatório final; componentes não recebem permissões de envio.")
        qs = m.ReportGrant.objects.filter(report=r, recipient=a)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise ValidationError("Permissão j? cadastrada; edite o vínculo existente.")
        if "parameters" in attrs and not isinstance(attrs["parameters"], dict):
            raise ValidationError("Parâmetros inválidos.")
        return attrs


class AutomationSerializer(model_serializer(m.ReportAutomation, ["version", "legacy"])):
    recipient_name = serializers.CharField(source="recipient.name", read_only=True)
    report_name = serializers.CharField(source="report.name", read_only=True)
    pending_items = serializers.SerializerMethodField()

    def get_pending_items(self, obj) -> list[str]:
        # Reuse readiness only within this serializer response. Each later request
        # and every execution/download performs fresh authorization checks.
        key = ("automation_readiness", obj.report.unit_id, obj.report_id, obj.report.version)
        if key not in self.context:
            self.context[key] = tuple(readiness(obj.report))
        items = list(self.context[key])
        if obj.legacy.get("permission_missing"):
            items.append("Programação legada sem vínculo de permissão")
        if not obj.recipient.active or not obj.recipient.verified_at:
            items.append("Verificar e ativar destinatário")
        try:
            grant_for(obj.report, obj.recipient, "automatic")
        except PermissionDenied:
            items.append("Permissão automática pendente")
        items.append(
            "Transporte de grupos pendente"
            if obj.recipient.kind == "group"
            else "Entrega Meta pendente"
        )
        return items


class ExecutionSerializer(model_serializer(m.ReportExecution)):
    missing_dates = serializers.SerializerMethodField()
    data_environment = serializers.SerializerMethodField()
    data_origin = serializers.SerializerMethodField()

    def get_missing_dates(self, obj) -> list[str]:
        return obj.snapshot.get("missing_dates", [])

    def get_data_environment(self, obj) -> str:
        return obj.snapshot.get("data_environment", "")

    def get_data_origin(self, obj) -> str:
        return obj.snapshot.get("data_origin", "")

    report_name = serializers.CharField(source="report.name", read_only=True)
    recipient_name = serializers.CharField(
        source="recipient.name", read_only=True, default=""
    )

    class Meta:
        model = m.ReportExecution
        exclude = ("result", "snapshot")
        read_only_fields = tuple(f.name for f in m.ReportExecution._meta.fields)


class Managed(ConfigViewSet):
    pagination_class = ReportPagination
    def get_queryset(self):
        get_unit(self.request, ["admin"])
        qs = super().get_queryset()
        for field in ("report", "recipient"):
            if field in {
                f.name for f in qs.model._meta.fields
            } and self.request.query_params.get(field):
                value = self.request.query_params[field]
                if not value.isdigit():
                    raise ValidationError("Filtro inválido: " + field)
                qs = qs.filter(**{field + "_id": value})
        return qs

    def once(self, request, execute):
        from core.oracle_config import receipt_payload

        unit = get_unit(request, ["admin"])
        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"path": request.path, "data": receipt_payload(dict(request.data))},
                execute,
            )
        )

    def validate_config(self, obj):
        if isinstance(obj, m.ReportConnection) and obj.enabled and not obj.validated:
            raise ValidationError("Valide a conexão antes de ativar.")
        if isinstance(obj, m.ReportRecipient) and obj.active and not obj.verified_at:
            raise ValidationError("Verifique o destinatário antes de ativar.")
        if (
            isinstance(obj, m.ReportGrant)
            and obj.active
            and obj.legacy.get("record", {}).get("PARAMETRO1")
            not in (None, "", "<NULL>")
            and not obj.parameters
        ):
            raise ValidationError("Mapeie o parâmetro restritivo da permissão legada.")
        if isinstance(obj, m.ReportAutomation):
            if obj.report.catalog_kind != "report":
                raise ValidationError("Componentes não podem ter programação independente.")
            if (
                obj.report.unit_id != obj.unit_id
                or obj.recipient.unit_id != obj.unit_id
            ):
                raise ValidationError("Referência de outra unidade.")
            if (
                not isinstance(obj.weekdays, list)
                or not obj.weekdays
                or any(type(x) is not int or x not in range(7) for x in obj.weekdays)
            ):
                raise ValidationError("Selecione os dias da semana.")
            if obj.enabled:
                if not obj.report.enabled or readiness(obj.report):
                    raise ValidationError("Resolva as pendências do relatório.")
                grant_for(obj.report, obj.recipient, "automatic")
                parameters(obj.report, obj.parameters)
                if obj.legacy.get("DIA_FIXO") not in (
                    None,
                    "",
                    "<NULL>",
                ) or obj.legacy.get("TIPO") not in (None, "", "<NULL>"):
                    raise ValidationError(
                        "Programação legada com regra de calendário pendente de revisão."
                    )


class ConnectionViewSet(Managed):
    queryset = m.ReportConnection.objects.order_by("name")
    serializer_class = ConnectionSerializer

    @extend_schema(request=ReportCatalogVersionInput, responses=ConnectionSerializer)
    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        def execute():
            obj = self.get_object()
            if request.data.get("version") != obj.version:
                raise Conflict()
            try:
                with connect(obj) as c:
                    cur = c.cursor()
                    cur.execute(
                        "SELECT 1 FROM RDB$DATABASE"
                        if obj.engine == "firebird"
                        else "SELECT 1 FROM DUAL"
                        if obj.engine == "oracle"
                        else "SELECT 1"
                    )
                    cur.fetchone()
                    cur.close()
                obj.validated, obj.validation_error = True, ""
            except Exception:  # noqa: BLE001 - do not expose driver credentials or source data
                obj.validated, obj.validation_error = False, "connection_failed"
            obj.checked_at = timezone.now()
            obj.version += 1
            obj.save()
            Audit.objects.create(
                unit=obj.unit,
                actor=request.user,
                action="report_connection.tested",
                object_id=str(obj.pk),
                details={"valid": obj.validated},
            )
            return self.get_serializer(obj).data

        return self.once(request, execute)


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("section", str, enum=["reports", "components", "all", "review"]),
            OpenApiParameter("source", str),
            OpenApiParameter(
                "status", str, enum=["enabled", "disabled", "reviewed", "unreviewed"]
            ),
            OpenApiParameter("connection", int),
            OpenApiParameter("sql", str, enum=["yes", "no"]),
            OpenApiParameter("search", str),
        ]
    )
)
class CatalogViewSet(ReportViewSet):
    pagination_class = ReportPagination
    @extend_schema(parameters=[OpenApiParameter("metric",str,required=True),OpenApiParameter("start",str),OpenApiParameter("end",str),OpenApiParameter("filters",str)],responses=AppDataResponseSchema)
    @action(detail=False,methods=["get"],url_path="app-data")
    def app_data(self,request):
        from operations.report_app_api import app_data
        return app_data(request)

    @extend_schema(request=CanvasConfigSchema, responses=CanvasConfigSchema)
    @action(detail=True, methods=["get", "post"])
    def canvas(self, request, pk=None):
        from operations.report_canvas.api import configure
        return configure(self, request)

    @extend_schema(request=CanvasPreviewSchema, responses=CanvasPreviewResult)
    @action(detail=True, methods=["post"], url_path="canvas-preview")
    def canvas_preview(self, request, pk=None):
        from operations.report_canvas.api import preview
        return preview(self, request)

    @extend_schema(request=CanvasSourcePreviewSchema, responses=CanvasSourcePreviewResult)
    @action(detail=True, methods=["post"], url_path="canvas-source-preview")
    def canvas_source_preview(self, request, pk=None):
        from operations.report_canvas.api import source_preview
        return source_preview(self, request)

    @extend_schema(request=CanvasAssetSchema, responses=CanvasAssetSchema)
    @action(detail=True, methods=["get", "post"], url_path="canvas-assets")
    def canvas_assets(self, request, pk=None):
        from operations.report_canvas.api import assets
        return assets(self, request)

    queryset = m.ReportDefinition.objects.select_related("connection", "unit").order_by(
        "name"
    )
    serializer_class = CatalogSerializer

    def get_queryset(self):
        unit = get_unit(self.request)
        qs = self.queryset.filter(unit=unit)
        if not is_admin(self.request.user, unit):
            qs = qs.filter(catalog_kind="report").filter(
                Q(
                    recipient_grants__active=True,
                    recipient_grants__manual=True,
                    recipient_grants__recipient__active=True,
                    recipient_grants__recipient__manual_enabled=True,
                    recipient_grants__recipient__verified_at__isnull=False,
                    recipient_grants__recipient__user=self.request.user,
                )
                | Q(
                    reportaccess__user=self.request.user,
                    reportaccess__active=True,
                    reportaccess__verified_at__isnull=False,
                )
            ).distinct()
        search = self.request.query_params.get("search", "")
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(code__icontains=search))
        # Filters apply only to lists, so moving a record never breaks detail actions.
        if self.action == "list":
            params = self.request.query_params
            section = params.get("section", "reports")
            if section == "components":
                if not is_admin(self.request.user, unit):
                    raise PermissionDenied("Componentes são restritos à administração.")
                qs = qs.filter(catalog_kind="component")
            elif section == "reports":
                qs = qs.filter(catalog_kind="report")
            elif section == "review":
                # Compatibility for previous clients; no longer exposed in the UI.
                qs = qs.filter(review_queue=True)
            elif section != "all":
                raise ValidationError("Seção inválida.")
            if params.get("source"):
                qs = qs.filter(source=params["source"])
            if params.get("app_connection"):
                if not params["app_connection"].isdigit():raise ValidationError("Conexão do app inválida.")
                qs=qs.filter(app_connection_id=params["app_connection"])
            if params.get("connection"):
                if not params["connection"].isdigit():
                    raise ValidationError("Conexão inválida.")
                qs = qs.filter(connection_id=params["connection"])
            status = params.get("status")
            if status in {"enabled", "disabled"}:
                qs = qs.filter(enabled=status == "enabled")
            elif status in {"reviewed", "unreviewed"}:
                qs = qs.filter(reviewed=status == "reviewed")
            if params.get("sql") == "yes":
                qs = qs.exclude(query_sql="")
            elif params.get("sql") == "no":
                qs = qs.filter(query_sql="")
        return qs

    def validate_config(self, obj):
        from operations.reports import HANDLERS

        if obj.catalog_kind == "component":
            paused = m.ReportAutomation.objects.filter(report=obj, enabled=True).update(enabled=False)
            paused += m.ReportSchedule.objects.filter(report=obj, enabled=True).update(enabled=False)
            if paused:
                Audit.objects.create(unit=obj.unit, actor=self.request.user,
                    action="report.component_programs_paused", object_id=str(obj.pk),
                    details={"paused": paused})

        if obj.source == "local" and obj.handler in HANDLERS and not obj.reviewed:
            obj.reviewed = True
            obj.save(update_fields=["reviewed"])
        if obj.connection_id and obj.connection.unit_id != obj.unit_id:
            raise ValidationError("Conexão de outra unidade.")
        if obj.app_connection_id and obj.app_connection.unit_id != obj.unit_id:
            raise ValidationError("Conexão do app de outra unidade.")
        if obj.source not in {
            "app",
            "local",
            "sql",
            "composite",
            "legacy_pending",
            "external_file",
            "application_pending",
        }:
            raise ValidationError("Fonte inválida.")
        if (
            not isinstance(obj.parameter_schema, dict)
            or not isinstance(obj.keywords, list)
            or any(
                not isinstance(k, str) or not k.strip() or len(k) > 100
                for k in obj.keywords
            )
        ):
            raise ValidationError("Parâmetros ou palavras-chave inválidos.")
        if obj.enabled and readiness(obj):
            raise ValidationError({"pending_items": readiness(obj)})

    @action(detail=False, methods=["get"])
    def inventory(self, request):
        unit = get_unit(request, ["admin"])
        return Response(
            {
                "reports": m.ReportDefinition.objects.filter(unit=unit, catalog_kind="report").count(),
                "components": m.ReportDefinition.objects.filter(unit=unit, catalog_kind="component").count(),
                "total_definitions": m.ReportDefinition.objects.filter(unit=unit).count(),
                "review_count": m.ReportDefinition.objects.filter(
                    unit=unit, review_queue=True
                ).count(),
                "legacy": m.ReportDefinition.objects.filter(
                    unit=unit, code__startswith="legacy123-"
                ).count(),
                "connections": m.ReportConnection.objects.filter(unit=unit).count(),
                "recipients": m.ReportRecipient.objects.filter(unit=unit).count(),
                "grants": m.ReportGrant.objects.filter(unit=unit).count(),
                "automations": m.ReportAutomation.objects.filter(unit=unit).count(),
                "legacy_import": Audit.objects.filter(
                    unit=unit, action="report.legacy_imported"
                )
                .order_by("-id")
                .values_list("details", flat=True)
                .first(),
            }
        )

    @extend_schema(request=PreviewInput, responses=PreviewOutput)
    @action(detail=True, methods=["post"])
    def preview(self, request, pk=None):
        get_unit(request, ["admin"])

        def execute():
            report = self.get_object()
            from operations.report_engine import run_query

            if report.source != "sql" or not report.reviewed:
                raise ValidationError("Revise a consulta antes de testar.")
            try:
                headers, rows = run_query(report, request.data.get("parameters", {}))
            except ValidationError:
                raise
            except Exception:  # noqa: BLE001 - do not expose driver credentials or source data
                raise ValidationError(
                    "Falha na consulta; confira a conexão, SQL e parâmetros."
                ) from None
            Audit.objects.create(
                unit=report.unit,
                actor=request.user,
                action="report.query_preview",
                object_id=str(report.pk),
                details={"rows": len(rows)},
            )
            return {
                "columns": headers,
                "rows": rows[:20],
                "total": len(rows),
                "real_sends": False,
            }

        return self.once(request, execute)


from operations.recipient_manual_reports import RecipientManualReportsMixin


class RecipientViewSet(RecipientManualReportsMixin, Managed):
    queryset = m.ReportRecipient.objects.order_by("name")
    serializer_class = RecipientSerializer

    def get_queryset(self):
        unit = get_unit(self.request)
        if not is_admin(self.request.user, unit):
            return self.queryset.filter(unit=unit, user=self.request.user)
        qs = super().get_queryset()
        if self.action == "list":
            qs = qs.annotate(manual_report_total=Count("grants", distinct=True, filter=Q(grants__unit=unit, grants__report__unit=unit, grants__active=True, grants__manual=True, grants__report__catalog_kind="report")))
            params = self.request.query_params
            if params.get("search"):
                qs = qs.filter(Q(name__icontains=params["search"]) | Q(address__icontains=params["search"]))
            if params.get("status") in {"active", "inactive"}:
                qs = qs.filter(active=params["status"] == "active")
            if params.get("recipient_kind") in {"phone", "group"}:
                qs = qs.filter(kind=params["recipient_kind"])
            if params.get("report"):
                if not params["report"].isdigit():
                    raise ValidationError("Relatório inválido.")
                qs = qs.filter(grants__report_id=params["report"], grants__manual=True, grants__active=True).distinct()
        return qs

    @action(detail=False, methods=["get"])
    def users(self, request):
        unit = get_unit(request, ["admin"])
        return Response(
            list(
                get_user_model()
                .objects.filter(membership__unit=unit, is_active=True)
                .values("id", "username")
            )
        )

    @extend_schema(request=VerifyInput, responses=RecipientSerializer)
    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        def execute():
            obj = self.get_object()
            if request.data.get("version") != obj.version:
                raise Conflict()
            evidence = str(request.data.get("evidence", "")).strip()
            if not 5 <= len(evidence) <= 1000:
                raise ValidationError("Registre a evidência da verificação.")
            obj.verified_at = timezone.now()
            obj.version += 1
            obj.save()
            Audit.objects.create(
                unit=obj.unit,
                actor=request.user,
                action="report_recipient.verified",
                object_id=str(obj.pk),
                details={"evidence": evidence},
            )
            return self.get_serializer(obj).data

        return self.once(request, execute)


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("search", str),
            OpenApiParameter("report", int),
            OpenApiParameter("recipient", int),
            OpenApiParameter("status", str, enum=["active", "inactive"]),
            OpenApiParameter(
                "permission", str, enum=["manual", "automatic", "both", "neither"]
            ),
            OpenApiParameter("recipient_kind", str, enum=["phone", "group"]),
        ]
    )
)
class GrantViewSet(Managed):
    queryset = m.ReportGrant.objects.select_related("report", "recipient").order_by(
        "recipient__name", "report__name"
    )
    serializer_class = GrantSerializer

    def get_queryset(self):
        qs = super().get_queryset().filter(report__catalog_kind="report")
        if self.action != "list":
            return qs
        params = self.request.query_params
        search = params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(report__name__icontains=search)
                | Q(report__code__icontains=search)
                | Q(recipient__name__icontains=search)
                | Q(recipient__address__icontains=search)
            )
        if params.get("status") in {"active", "inactive"}:
            qs = qs.filter(active=params["status"] == "active")
        modes = {
            "manual": {"manual": True},
            "automatic": {"automatic": True},
            "both": {"manual": True, "automatic": True},
            "neither": {"manual": False, "automatic": False},
        }
        if params.get("permission") in modes:
            qs = qs.filter(**modes[params["permission"]])
        if params.get("recipient_kind") in {"phone", "group"}:
            qs = qs.filter(recipient__kind=params["recipient_kind"])
        return qs


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("search", str),
            OpenApiParameter("report", int),
            OpenApiParameter("recipient", int),
            OpenApiParameter("status", str, enum=["active", "inactive"]),
            OpenApiParameter("weekday", int, enum=list(range(7))),
            OpenApiParameter("time_from", str),
            OpenApiParameter("time_to", str),
            OpenApiParameter("recipient_kind", str, enum=["phone", "group"]),
        ]
    )
)
class AutomationViewSet(Managed):
    queryset = m.ReportAutomation.objects.select_related(
        "report__connection", "report__unit", "recipient", "unit"
    ).order_by("send_time")
    serializer_class = AutomationSerializer

    def get_queryset(self):
        from django.utils.dateparse import parse_time

        qs = super().get_queryset().filter(report__catalog_kind="report")
        if self.action != "list":
            return qs
        params = self.request.query_params
        search = params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(report__name__icontains=search)
                | Q(report__code__icontains=search)
                | Q(recipient__name__icontains=search)
                | Q(recipient__address__icontains=search)
            )
        if params.get("status") in {"active", "inactive"}:
            qs = qs.filter(enabled=params["status"] == "active")
        if params.get("recipient_kind") in {"phone", "group"}:
            qs = qs.filter(recipient__kind=params["recipient_kind"])
        weekday = params.get("weekday", "")
        if weekday:
            if not weekday.isdigit() or int(weekday) not in range(7):
                raise ValidationError("Dia da semana inválido.")
            qs = qs.filter(weekdays__contains=[int(weekday)])
        times = {}
        for key in ("time_from", "time_to"):
            if params.get(key):
                try:
                    value = parse_time(params[key])
                except ValueError:
                    value = None
                if value is None or value.tzinfo is not None:
                    raise ValidationError("Horário inválido.")
                times[key] = value
        if (
            "time_from" in times
            and "time_to" in times
            and times["time_from"] > times["time_to"]
        ):
            raise ValidationError(
                "O horário final deve ser igual ou posterior ao inicial."
            )
        if "time_from" in times:
            qs = qs.filter(send_time__gte=times["time_from"])
        if "time_to" in times:
            qs = qs.filter(send_time__lte=times["time_to"])
        return qs


class ExecutionViewSet(ScopedRead):
    pagination_class = ReportPagination
    queryset = m.ReportExecution.objects.select_related(
        "report__connection", "recipient", "unit", "requester", "automation"
    ).order_by("-created_at")
    serializer_class = ExecutionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if not is_admin(self.request.user, get_unit(self.request)):
            qs = qs.filter(requester=self.request.user)
        return qs

    @extend_schema(request=ExecutionInput, responses=ExecutionSerializer)
    def create(self, request):
        form = ExecutionInput(data=request.data)
        form.is_valid(raise_exception=True)

        def execute():
            unit = get_unit(request, ["admin", "operator"])
            report = get_object_or_404(
                m.ReportDefinition, unit=unit, pk=request.data.get("report")
            )
            recipient = (
                get_object_or_404(
                    m.ReportRecipient, unit=unit, pk=request.data["recipient"]
                )
                if request.data.get("recipient")
                else None
            )
            job = make_execution(
                report,
                request.data.get("parameters", {}),
                user=request.user,
                recipient=recipient,
            )
            enqueue(job)
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="report.execution_requested",
                object_id=str(job.pk),
            )
            job.refresh_from_db()
            return self.get_serializer(job).data

        return self.once(request, execute)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        job = self.get_object()
        execution_access(job, for_download=True)
        if job.state != "ready":
            raise ValidationError("Resultado ainda não disponível.")
        if job.snapshot.get("no_data"):
            raise ValidationError("Não existem dados para a data selecionada.")
        response = HttpResponse(
            base64.b64decode(job.result) if job.format in {"pdf", "xlsx"} else job.result,
            content_type={
                "pdf": "application/pdf",
                "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "csv": "text/csv; charset=utf-8",
                "text": "text/plain; charset=utf-8",
            }[job.format],
        )
        from django.utils.http import content_disposition_header
        from operations.report_engine import report_filename
        response["Content-Disposition"] = content_disposition_header(
            True, report_filename(job.report.name + (" - Legado" if job.snapshot.get("data_origin") == "legacy" else ""), job.format)
        )
        response["Cache-Control"] = "no-store"
        Audit.objects.create(
            unit=job.unit,
            actor=request.user,
            action="report.execution_downloaded",
            object_id=str(job.pk),
        )
        return response
