from datetime import timedelta
from uuid import uuid4

from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core.models import Audit
from core.permissions import get_unit
from messaging.models import Message, MetaConfiguration, Template
from operations.services import Conflict, idempotent
from scheduling.models import OracleAgenda, Rule
from scheduling.oracle_agendas import (
    DEFAULT_COLUMNS,
    describe,
    safe_error,
    safe_view,
    template_keys,
    window_dates,
)


class InspectInput(serializers.Serializer):
    view_name = serializers.CharField(max_length=200)


class InspectOutput(serializers.Serializer):
    columns = serializers.ListField(child=serializers.JSONField())


class TestPatientInput(serializers.Serializer):
    id = serializers.IntegerField(min_value=1, required=False)
    view_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    patient_external_id = serializers.CharField(max_length=100)
    column_mapping = serializers.JSONField(required=False, default=dict)
    parameter_mapping = serializers.JSONField(required=False, default=dict)


class TestPatientOutput(serializers.Serializer):
    found = serializers.BooleanField()
    source = serializers.CharField(required=False)
    patient_external_id = serializers.CharField(required=False)
    values = serializers.JSONField(required=False)
    parameters = serializers.JSONField(required=False)
    message = serializers.CharField(required=False)


class AgendaInput(InspectInput):
    id = serializers.IntegerField(min_value=1, required=False)
    name = serializers.CharField(max_length=120, default="Agenda Oracle")
    kind = serializers.ChoiceField(
        choices=["consultation", "exam", "lab"], default="consultation"
    )
    version = serializers.IntegerField(min_value=0)
    template_id = serializers.CharField(max_length=40)
    column_mapping = serializers.JSONField()
    parameter_mapping = serializers.JSONField()
    horizon_days = serializers.IntegerField(min_value=1, max_value=30, default=10)
    days_before = serializers.IntegerField(min_value=0, max_value=30, default=5)
    send_time = serializers.TimeField(default="09:00")
    enabled = serializers.BooleanField(default=True)
    send_weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        min_length=1,
        max_length=7,
        required=False,
    )
    blocked_day_policy = serializers.JSONField(required=False)

    def validate(self, attrs):
        days = attrs.get("send_weekdays")
        if days is not None and len(days) != len(set(days)):
            raise serializers.ValidationError(
                {"send_weekdays": "Selecione dias distintos."}
            )
        policy = attrs.get("blocked_day_policy", {})
        if not isinstance(policy, dict) or any(
            k not in {str(d) for d in range(7)} or v not in ("previous", "next")
            for k, v in policy.items()
        ):
            raise serializers.ValidationError(
                {
                    "blocked_day_policy": "Selecione antecipar ou adiar para cada dia bloqueado."
                }
            )
        return attrs


class AgendaVersionInput(serializers.Serializer):
    id = serializers.IntegerField(min_value=1, required=False)
    version = serializers.IntegerField(min_value=1)
    refresh = serializers.BooleanField(default=False)


class AgendaDeleteInput(serializers.Serializer):
    id = serializers.IntegerField(min_value=1, required=False)
    version = serializers.IntegerField(min_value=1)


class AgendaOutput(serializers.Serializer):
    configurations = serializers.ListField(child=serializers.JSONField())
    archived_configurations = serializers.ListField(child=serializers.JSONField())
    archived_configuration = serializers.JSONField(allow_null=True)
    configuration = serializers.JSONField(allow_null=True)
    templates = serializers.ListField(child=serializers.JSONField())
    default_columns = serializers.JSONField()


def catalog(unit):
    config = MetaConfiguration.objects.filter(
        unit=unit, validation_state="valid"
    ).first()
    return (config, config.templates) if config else (None, [])


def output(unit, selected=None):
    configs = list(
        OracleAgenda.objects.filter(unit=unit)
        .select_related("rule__template")
        .order_by("id")
    )
    active = [serialize_config(c) for c in configs if not c.deleted_at]
    archived_rows = [
        {
            "id": c.pk,
            "name": c.name,
            "version": c.version,
            "view_name": c.view_name,
            "deleted_at": c.deleted_at,
        }
        for c in configs
        if c.deleted_at
    ]
    config = (
        next((c for c in configs if c.pk == selected), None)
        if selected
        else (configs[0] if len(configs) == 1 else None)
    )
    rows = []
    _, templates = catalog(unit)
    for t in templates:
        try:
            keys, reason = template_keys(t), ""
        except ValueError as exc:
            keys, reason = [], str(exc)
        rows.append(
            {
                **t,
                "parameter_keys": keys,
                "supported": not reason,
                "unsupported_reason": reason,
            }
        )
    archived = None
    if config and config.deleted_at:
        archived = {
            "id": config.pk,
            "version": config.version,
            "view_name": config.view_name,
            "deleted_at": config.deleted_at,
        }
        config = None
    value = serialize_config(config) if config else None
    return {
        "configurations": active,
        "archived_configurations": archived_rows,
        "configuration": value,
        "archived_configuration": archived,
        "templates": rows,
        "default_columns": DEFAULT_COLUMNS,
    }


def serialize_config(config):
    days = window_dates(config, timezone.now())
    imports = list(
        config.days.filter(version=config.version, date__in=days)
        .order_by("date")
        .values("date", "row_count", "appointment_count", "completed_at")
    )
    value = {
        "name": config.name,
        "kind": config.kind,
        "id": config.pk,
        "version": config.version,
        "view_name": config.view_name,
        "columns": config.columns,
        "column_mapping": config.column_mapping,
        "template_id": config.template_id,
        "template_name": config.rule.template.name,
        "template_snapshot": config.template_snapshot,
        "parameter_mapping": config.parameter_mapping,
        "horizon_days": config.horizon_days,
        "days_before": config.days_before,
        "send_time": config.send_time,
        "send_weekdays": config.send_weekdays,
        "blocked_day_policy": config.blocked_day_policy,
        "enabled": config.enabled,
        "last_state": config.last_state,
        "last_error": config.last_error,
        "last_started_at": config.last_started_at,
        "last_completed_at": config.last_completed_at,
        "window_start": days[0],
        "window_end": days[-1],
        "days": imports,
        "appointment_count": sum(d["appointment_count"] for d in imports),
        "covered_days": len(imports),
        "sending_enabled": False,
    }
    return value


def selected_config(unit, data, lock=True):
    rows = OracleAgenda.objects.filter(unit=unit)
    if lock:
        rows = rows.select_for_update()
    if data.get("id"):
        config = rows.filter(pk=data["id"]).first()
        if not config:
            raise ValidationError("Configuração não encontrada nesta unidade.")
        return config
    if rows.count() != 1:
        raise ValidationError("Informe a configuração da agenda.")
    return rows.first()


def validate_mappings(data, columns, template):
    available = {c["name"] for c in columns}
    m = data["column_mapping"]
    if not isinstance(m, dict) or set(m) - set(DEFAULT_COLUMNS):
        raise ValidationError("Mapeamento de colunas inválido.")
    required = {"external_id", "patient", "date", "time", "phone_columns"}
    if not required <= set(m):
        raise ValidationError("Mapeie identificador, paciente, data, hora e telefones.")
    for key, value in m.items():
        if key == "phone_columns":
            if (
                not isinstance(value, list)
                or not 1 <= len(value) <= 10
                or any(not isinstance(v, str) for v in value)
                or len(set(value)) != len(value)
            ):
                raise ValidationError("Selecione de 1 a 10 colunas de telefone.")
            if any(not isinstance(v, str) or v not in available for v in value):
                raise ValidationError("Coluna de telefone não encontrada.")
        elif (
            not isinstance(value, str)
            or (value and value not in available)
            or (key in required and not value)
        ):
            raise ValidationError("Coluna de origem não encontrada.")
    try:
        keys = template_keys(template)
    except ValueError as exc:
        raise ValidationError(
            "Template não suportado nesta integração: " + str(exc)
        ) from None
    params = data["parameter_mapping"]
    if not isinstance(params, dict) or set(params) != set(keys):
        raise ValidationError("Mapeie todos os parâmetros do template selecionado.")
    for value in params.values():
        if not isinstance(value, dict) or set(value) != {"column", "format"}:
            raise ValidationError("Informe coluna e formato de cada parâmetro.")
        if (
            not isinstance(value["column"], str)
            or value["column"] not in available
            or not isinstance(value["format"], str)
            or value["format"] not in {"text", "date", "time"}
        ):
            raise ValidationError("Coluna ou formato de parâmetro inválido.")
    return keys


class OracleAgendaViewSet(viewsets.GenericViewSet):
    serializer_class = AgendaOutput

    def admin_unit(self):
        if self.request.auth is not None:
            from core.models import InstanceAccessKey

            if isinstance(self.request.auth, InstanceAccessKey):
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Configure a origem na própria instância.")
        return get_unit(self.request, ["admin"])

    def list(self, request):
        return Response(output(self.admin_unit()))

    @extend_schema(request=InspectInput, responses=InspectOutput)
    @action(detail=False, methods=["post"])
    def inspect(self, request):
        unit = self.admin_unit()
        serializer = InspectInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            columns = describe(unit, serializer.validated_data["view_name"])
        except Exception as exc:  # noqa: BLE001 - Oracle errors must never expose credentials or SQL
            raise ValidationError(
                "Não foi possível consultar a view: " + safe_error(exc)
            ) from None
        return Response({"columns": columns})

    @extend_schema(request=TestPatientInput, responses=TestPatientOutput)
    @action(detail=False, methods=["post"])
    def test_patient(self, request):
        unit = self.admin_unit()
        serializer = TestPatientInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        patient_id = data["patient_external_id"].strip()
        view = data.get("view_name", "").strip()
        column_mapping = data.get("column_mapping") or {}
        parameter_mapping = data.get("parameter_mapping") or {}

        agenda = selected_config(unit, data, lock=False) if data.get("id") else None
        values = {}
        oracle_error = ""
        source = "oracle"

        if view:
            try:
                from scheduling.oracle_agendas import IDENTIFIER, safe_view, scalar

                safe_view(view)
                patient_col = column_mapping.get("patient_external_id") or "CD_PACIENTE"
                if not IDENTIFIER.fullmatch(patient_col):
                    patient_col = "CD_PACIENTE"

                requested = set()
                for c in column_mapping.values():
                    if isinstance(c, str) and c and IDENTIFIER.fullmatch(c):
                        requested.add(c)
                    elif isinstance(c, list):
                        for item in c:
                            if isinstance(item, str) and IDENTIFIER.fullmatch(item):
                                requested.add(item)
                for binding in parameter_mapping.values():
                    if isinstance(binding, dict):
                        c = binding.get("column")
                        if isinstance(c, str) and c and IDENTIFIER.fullmatch(c):
                            requested.add(c)
                requested.add(patient_col)
                names = sorted(requested)

                from scheduling.connectors import OracleSource

                with OracleSource(unit).connect() as connection:
                    try:
                        with connection.cursor() as cursor:
                            cursor.execute("SET TRANSACTION READ ONLY")
                            cursor.execute(
                                f"SELECT {', '.join(names)} FROM {view} WHERE {patient_col} = :patient_id AND ROWNUM = 1",
                                patient_id=patient_id,
                            )
                            row = cursor.fetchone()
                            if row:
                                values = dict(zip(names, [scalar(v) for v in row]))
                    finally:
                        connection.rollback()
            except Exception as exc:  # noqa: BLE001 - sanitized connector errors only
                oracle_error = safe_error(exc)

        if not values and agenda and view.strip().upper() == agenda.view_name:
            from scheduling.models import Appointment

            appointments = Appointment.objects.filter(unit=unit)
            if agenda:
                appointments = appointments.filter(
                    source="oracle-agenda:" + str(agenda.pk)
                )
            elif not view:
                raise ValidationError("Informe uma view ou configuração.")
            app = (
                appointments.filter(patient_external_id=patient_id)
                .order_by("-scheduled_at")
                .first()
            )
            if not app and patient_id.isdigit():
                app = appointments.filter(id=patient_id).first()
            if not app:
                app = (
                    appointments.filter(patient__icontains=patient_id)
                    .order_by("-scheduled_at")
                    .first()
                )
            if app:
                source = "local"
                date_str = app.scheduled_at.date().isoformat()
                time_str = app.scheduled_at.time().strftime("%H:%M")
                values = {
                    column_mapping.get("external_id") or "CD_AGENDA": app.external_id,
                    column_mapping.get("patient_external_id")
                    or "CD_PACIENTE": app.patient_external_id,
                    column_mapping.get("patient") or "PACIENTE": app.patient,
                    column_mapping.get("date") or "DTA_AGENDA": date_str,
                    column_mapping.get("time") or "HORA_MARCADA": time_str,
                    column_mapping.get("arrival_time")
                    or "HORA_CHEGADA": app.arrival_time or time_str,
                    column_mapping.get("procedure") or "ESPECIALIDADE": app.procedure,
                    column_mapping.get("appointment_type")
                    or "TIPO_CONSULTA": app.appointment_type,
                    column_mapping.get("professional") or "MEDICO": app.professional,
                }
                phone_cols = column_mapping.get("phone_columns") or ["CELULAR"]
                for pcol in phone_cols:
                    values[pcol] = app.phone
                if isinstance(app.source_values, dict):
                    values.update(app.source_values)

                # Fallback aliases so testing with unmapped or custom column names works cleanly in local dev
                alias_defaults = {
                    "NM_PACIENTE": app.patient,
                    "NOME_PACIENTE": app.patient,
                    "PACIENTE": app.patient,
                    "NOME": app.patient,
                    "CD_PACIENTE": app.patient_external_id,
                    "COD_PACIENTE": app.patient_external_id,
                    "DT_AGENDA": date_str,
                    "DTA_AGENDA": date_str,
                    "DATA": date_str,
                    "HR_AGENDA": time_str,
                    "HORA": time_str,
                    "HORA_AGENDA": time_str,
                    "HORA_CHEGADA": app.arrival_time or time_str,
                    "DS_LOCAL": "Ambulatório Central - Sala 04",
                    "LOCAL": "Ambulatório Central - Sala 04",
                    "DS_ESPECIALIDADE": app.procedure or "Consulta Geral",
                    "ESPECIALIDADE": app.procedure or "Consulta Geral",
                    "NM_MEDICO": app.professional or "Dr(a). Médico(a)",
                    "MEDICO": app.professional or "Dr(a). Médico(a)",
                    "TELEFONE": app.phone,
                    "CELULAR": app.phone,
                    "NR_TELEFONE": app.phone,
                }
                for k, v in alias_defaults.items():
                    if k not in values and v:
                        values[k] = v

        if not values:
            return Response(
                {
                    "found": False,
                    "message": "Falha ao consultar a view: " + oracle_error
                    if oracle_error
                    else "Nenhum agendamento encontrado.",
                }
            )

        formatted_params = {}
        from scheduling.oracle_agendas import format_value

        normalized_values = {
            k.strip().upper(): v for k, v in values.items() if isinstance(k, str)
        }
        for key, binding in parameter_mapping.items():
            if isinstance(binding, dict):
                col = (binding.get("column") or "").strip()
                fmt = binding.get("format", "text")
                val = values.get(col)
                if val is None and col.upper() in normalized_values:
                    val = normalized_values[col.upper()]
                if val is None:
                    val = ""
                try:
                    formatted_params[key] = format_value(val, fmt)
                except (ValueError, TypeError):
                    formatted_params[key] = str(val) if val is not None else ""

        return Response(
            {
                "found": True,
                "source": source,
                "patient_external_id": patient_id,
                "values": values,
                "parameters": formatted_params,
            }
        )

    @extend_schema(request=AgendaInput, responses=AgendaOutput)
    @action(detail=False, methods=["post"])
    def configure(self, request):
        unit = self.admin_unit()
        serializer = AgendaInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        # Metadata read only; no patient rows and no SQL supplied by client.
        try:
            safe_view(values["view_name"])
            columns = describe(unit, values["view_name"])
        except Exception as exc:  # noqa: BLE001 - Oracle errors must never expose credentials or SQL
            raise ValidationError(
                "Não foi possível consultar a view: " + safe_error(exc)
            ) from None

        def execute():
            current = (
                selected_config(unit, values)
                if values.get("id") or values["version"]
                else None
            )
            if (current.version if current else 0) != values["version"]:
                raise Conflict()
            values.setdefault(
                "send_weekdays", current.send_weekdays if current else list(range(7))
            )
            values.setdefault(
                "blocked_day_policy", current.blocked_day_policy if current else {}
            )
            values["send_weekdays"] = sorted(values["send_weekdays"])
            values["blocked_day_policy"] = {
                str(d): values["blocked_day_policy"].get(str(d), "previous")
                for d in range(7)
                if d not in values["send_weekdays"]
            }
            meta, templates = catalog(unit)
            remote = next(
                (t for t in templates if t.get("id") == values["template_id"]), None
            )
            if not meta or not remote:
                raise ValidationError(
                    "Selecione um template do catálogo Meta validado desta unidade."
                )
            keys = validate_mappings(values, columns, remote)
            body = next(c["text"] for c in remote["components"] if c["type"] == "BODY")
            fields = [
                "oracle:"
                + values["parameter_mapping"][k]["column"]
                + ":"
                + values["parameter_mapping"][k]["format"]
                for k in keys
            ]
            template, _ = Template.objects.select_for_update().get_or_create(
                unit=unit,
                name=remote["name"],
                language=remote["language"],
                defaults={
                    "body": body,
                    "fields": fields,
                    "components": remote["components"],
                    "purpose": "appointment",
                },
            )
            rule = (
                current.rule
                if current
                else Rule(
                    unit=unit,
                    code="oracle-window-" + uuid4().hex[:20],
                    name=values["name"],
                    kind=values["kind"],
                )
            )
            if current and current.kind != values["kind"]:
                raise ValidationError(
                    "O tipo de uma origem existente não pode ser alterado. Crie outra configuração."
                )
            rule.name = values["name"]
            rule.kind = values["kind"]
            rule.template = template
            rule.days_before, rule.send_time = (
                values["days_before"],
                values["send_time"],
            )
            rule.enabled, rule.weekdays = False, values["send_weekdays"]
            if current:
                rule.version += 1
                Message.objects.filter(
                    rule=rule, state__in=["preview", "queued", "blocked"]
                ).update(state="cancelled")
                from responses.models import Issue

                Issue.objects.filter(
                    message__rule=rule,
                    message__state="cancelled",
                    category="send_calendar_after_appointment",
                    resolved_at__isnull=True,
                ).update(
                    resolved_at=timezone.now(),
                    resolution="Programação invalidada por alteração da agenda.",
                )
            rule.save()
            current = current or OracleAgenda(unit=unit, rule=rule, version=0)
            for key in [
                "name",
                "kind",
                "view_name",
                "column_mapping",
                "template_id",
                "parameter_mapping",
                "horizon_days",
                "days_before",
                "send_time",
                "send_weekdays",
                "blocked_day_policy",
                "enabled",
            ]:
                setattr(current, key, values[key])
            current.columns = columns
            current.template_snapshot = {
                **remote,
                "waba_id": meta.waba_id,
                "phone_number_id": meta.phone_number_id,
            }
            current.version += 1
            current.deleted_at = None
            current.last_state, current.last_error = "pending", ""
            current.save()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="oracle_agenda.configured",
                object_id=str(current.pk),
                details={"version": current.version},
            )
            return output(unit, current.pk)

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"path": request.path, "data": values},
                execute,
            )
        )

    @extend_schema(request=AgendaVersionInput, responses=AgendaOutput)
    @action(detail=False, methods=["post"])
    def synchronize(self, request):
        unit = self.admin_unit()
        serializer = AgendaVersionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        def execute():
            config = selected_config(unit, data)
            if not config or config.deleted_at or config.version != data["version"]:
                raise Conflict()
            if (
                config.last_state in {"scheduled", "running"}
                and config.last_started_at
                and config.last_started_at > timezone.now() - timedelta(minutes=15)
            ):
                raise Conflict("Importação em andamento.")
            config.last_state, config.last_started_at = "scheduled", timezone.now()
            config.save(update_fields=["last_state", "last_started_at"])
            from scheduling.tasks import sync_oracle_agenda

            transaction.on_commit(
                lambda: sync_oracle_agenda.delay(config.pk, refresh=data["refresh"])
            )
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="oracle_agenda.requested",
                object_id=str(config.pk),
                details={"version": config.version, "refresh": data["refresh"]},
            )
            return output(unit)

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"path": request.path, "data": data},
                execute,
            )
        )

    @extend_schema(request=AgendaDeleteInput, responses=AgendaOutput)
    @action(detail=False, methods=["post"])
    def remove(self, request):
        return self.change_archive(request, restore=False)

    @extend_schema(request=AgendaDeleteInput, responses=AgendaOutput)
    @action(detail=False, methods=["post"])
    def restore(self, request):
        return self.change_archive(request, restore=True)

    def change_archive(self, request, restore):
        unit = self.admin_unit()
        serializer = AgendaDeleteInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        def execute():
            config = selected_config(unit, data)
            if (
                not config
                or config.version != data["version"]
                or bool(config.deleted_at) != restore
            ):
                raise Conflict()
            config.deleted_at = None if restore else timezone.now()
            config.enabled = False
            config.version += 1
            config.last_state, config.last_error = "pending", ""
            config.save()
            rule = config.rule
            rule.enabled = False
            rule.version += 1
            rule.save(update_fields=["enabled", "version"])
            Message.objects.filter(
                rule=rule, state__in=["preview", "queued", "blocked"]
            ).update(state="cancelled")
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="oracle_agenda.restored" if restore else "oracle_agenda.removed",
                object_id=str(config.pk),
                details={"version": config.version},
            )
            return output(unit)

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"path": request.path, "data": data},
                execute,
            )
        )
