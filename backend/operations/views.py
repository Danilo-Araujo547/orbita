import base64
import binascii

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, F, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core.models import Audit, Membership
from core.permissions import get_unit
from messaging.models import Message
from operations import models as m
from operations import serializers as s
from operations.reports import HANDLERS, check_access, validate_parameters
from operations.services import (
    Conflict,
    apply_outcome,
    eligible_operator,
    idempotent,
    lock_case,
    log,
    preview_campaign,
)
from operations.sheets import confirm_sheet, preview_sheet
from responses.models import Issue


class ScopedRead(viewsets.ReadOnlyModelViewSet):
    def get_queryset(self):
        return self.queryset.filter(unit=get_unit(self.request))

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "unit": get_unit(self.request)}

    def once(self, request, execute):
        unit = get_unit(request, ["admin", "operator"])
        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"path": request.path, "data": request.data},
                execute,
            )
        )


class CaseViewSet(ScopedRead):
    queryset = m.Case.objects.select_related("event", "assignee").order_by(
        "priority", "created_at"
    )
    serializer_class = s.CaseSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        from core.access import local_permissions

        policy = local_permissions(self.request.user, get_unit(self.request))
        if policy["campaigns"] == "none":
            allowed = ["appointment", "absence", "movement"]
            if policy["appointments"] != "none":
                allowed += ["waitlist", "summons", "postoperative"]
            qs = qs.filter(purpose__in=allowed)
        for field in [
            "state",
            "purpose",
            "assignee",
            "response_state",
            "outcome",
            "priority",
        ]:
            if self.request.query_params.get(field):
                value = self.request.query_params[field]
                if field == "assignee" and value != "me" and not value.isdigit():
                    raise ValidationError("Responsável inválido.")
                qs = (
                    qs.filter(assignee=self.request.user)
                    if field == "assignee" and value == "me"
                    else qs.filter(**{field: value})
                )
        query = self.request.query_params.get("search", "")
        qs = qs.filter(
            Q(event__patient__icontains=query)
            | Q(event__phone__icontains=query)
            | Q(event__external_id__icontains=query)
        )
        from core.views import date_filter

        return date_filter(qs, self.request, "event__occurred_at")

    @action(detail=False, methods=["get"])
    def operators(self, request):
        unit = get_unit(request)
        users = (
            get_user_model()
            .objects.filter(is_active=True)
            .filter(
                Q(is_superuser=True)
                | Q(membership__unit=unit, membership__role__in=["admin", "operator"])
            )
            .distinct()
            .order_by("username")
        )
        return Response([{"id": u.pk, "username": u.username} for u in users])

    @action(detail=False, methods=["get"])
    def metrics(self, request):
        qs = self.get_queryset()
        return Response(
            {
                "cases": qs.count(),
                "open": qs.exclude(state="closed").count(),
                "high_priority": qs.filter(priority="high")
                .exclude(state="closed")
                .count(),
                "unassigned": qs.filter(assignee=None).exclude(state="closed").count(),
                "by_purpose": list(qs.values("purpose").annotate(total=Count("pk"))),
                "denominator": "Casos correspondentes aos filtros; não representa pacientes únicos.",
            }
        )

    @action(detail=False, methods=["get"])
    def export(self, request):
        import csv
        import io

        qs = self.get_queryset()
        if qs.count() > 10000:
            raise ValidationError("Reduza os filtros para exportar até 10.000 casos.")
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "Paciente",
                "Telefone",
                "Origem",
                "Finalidade",
                "Atendimento",
                "Responsável",
                "Resultado",
            ]
        )
        for case in qs:
            values = [
                case.event.patient,
                case.event.phone,
                case.event.source,
                case.get_purpose_display(),
                case.get_state_display(),
                case.assignee.username if case.assignee else "",
                case.outcome,
            ]
            writer.writerow(
                ["'" + v if v.startswith(("=", "+", "-", "@")) else v for v in values]
            )
        Audit.objects.create(
            unit=get_unit(request),
            actor=request.user,
            action="cases.exported",
            details={"count": qs.count()},
        )
        response = HttpResponse(
            output.getvalue(), content_type="text/csv; charset=utf-8"
        )
        response["Content-Disposition"] = 'attachment; filename="acompanhamentos.csv"'
        response["Cache-Control"] = "no-store"
        return response

    @action(detail=False, methods=["get"])
    def health(self, request):
        unit = get_unit(request)
        now = timezone.now()
        queued = Message.objects.filter(
            unit=unit, state="queued", scheduled_for__lte=now
        )
        oldest = (
            queued.order_by("scheduled_for")
            .values_list("scheduled_for", flat=True)
            .first()
        )
        return Response(
            {
                "queued_due": queued.count(),
                "oldest_due_seconds": int((now - oldest).total_seconds())
                if oldest
                else 0,
                "uncertain": Message.objects.filter(
                    unit=unit, state="uncertain"
                ).count(),
                "unlinked_replies": Issue.objects.filter(
                    unit=unit, category="unlinked_reply", resolved_at__isnull=True
                ).count(),
                "failed_imports": m.FlowRun.objects.filter(
                    unit=unit, state="failed"
                ).count(),
                "stalled_reports": m.ReportRequest.objects.filter(
                    unit=unit,
                    state="pending",
                    created_at__lt=now - timezone.timedelta(minutes=10),
                ).count(),
                "production_enabled": False,
            }
        )

    @extend_schema(responses=s.InteractionSerializer(many=True))
    @action(detail=True, methods=["get"])
    def timeline(self, request, pk=None):
        qs = (
            self.get_object()
            .interactions.select_related("actor")
            .order_by("-occurred_at", "-pk")
        )
        if request.query_params.get("kind"):
            qs = qs.filter(kind=request.query_params["kind"])
        return self.get_paginated_response(
            s.InteractionSerializer(self.paginate_queryset(qs), many=True).data
        )

    @action(detail=True, methods=["get"])
    def communications(self, request, pk=None):
        from core.serializers import MessageSerializer, ReplySerializer
        from responses.models import Reply

        case = self.get_object()
        messages = (
            case.messages.select_related("appointment", "template", "rule")
            .prefetch_related("attempts", "replies__event")
            .order_by("-created_at")[:100]
        )
        replies = (
            Reply.objects.filter(message__case=case)
            .select_related("event", "message__appointment")
            .order_by("-event__occurred_at")[:100]
        )
        return Response(
            {
                "messages": MessageSerializer(messages, many=True).data,
                "replies": ReplySerializer(replies, many=True).data,
            }
        )

    @extend_schema(request=s.CaseActionInput, responses=s.CaseSerializer)
    @action(detail=True, methods=["post"])
    def act(self, request, pk=None):
        values = s.CaseActionInput(data=request.data)
        values.is_valid(raise_exception=True)
        data = values.validated_data

        def execute():
            case = lock_case(self.get_object(), data["version"])
            kind, text = data["action"], data["text"]
            phone = data.get("phone", "")
            if (
                phone
                and not m.Contact.objects.filter(event=case.event, phone=phone).exists()
            ):
                raise ValidationError("Número não pertence a este agendamento.")
            if (
                kind in {"call", "classify"}
                and not phone
                and m.Contact.objects.filter(event=case.event).count() > 1
            ):
                raise ValidationError("Selecione o número utilizado.")
            if kind == "call":
                if data.get("call_result") not in {"answered", "not_answered"}:
                    raise ValidationError("Informe o resultado da ligação.")
                if data["call_result"] == "answered" and not data.get("interlocutor"):
                    raise ValidationError("Informe a pessoa com quem falou.")
            elif kind == "classify":
                apply_outcome(
                    case, data.get("outcome"), request.user, text, phone=phone
                )
            elif kind == "record_response":
                if case.purpose != "appointment" or case.response_state not in {
                    "pending",
                    "no_response",
                }:
                    raise Conflict(
                        "Já existe resposta neste agendamento. Revise o histórico antes de corrigir."
                    )
                if (
                    not phone
                    or not data.get("interlocutor", "").strip()
                    or not data.get("channel")
                    or data.get("outcome") not in {"confirmed", "declined"}
                ):
                    raise ValidationError(
                        "Informe contato, quem respondeu, canal e confirmação ou recusa."
                    )
                from datetime import timedelta

                occurred_at = data.get("occurred_at", timezone.now())
                if occurred_at > timezone.now() + timedelta(minutes=5):
                    raise ValidationError("Data da resposta não pode estar no futuro.")
                messages = case.messages.filter(
                    recipient=phone, appointment_revision=case.event.revision
                )
                message = (
                    messages.filter(pk=data["message_id"]).first()
                    if data.get("message_id")
                    else messages.order_by("-created_at").first()
                )
                if data.get("message_id") and message is None:
                    raise ValidationError(
                        "Mensagem incompatível com o agendamento e contato."
                    )
                apply_outcome(
                    case,
                    data["outcome"],
                    request.user,
                    text,
                    channel=data["channel"],
                    occurred_at=occurred_at,
                    phone=phone,
                    interlocutor=data["interlocutor"],
                    message_id=message.pk if message else None,
                )
                if message:
                    message.response_state = data["outcome"]
                    message.save(update_fields=["response_state", "updated_at"])
            if "priority" in data:
                case.priority = data["priority"]
            case.save()
            if kind not in {"classify", "record_response"}:
                log(
                    case,
                    kind,
                    text,
                    actor=request.user,
                    interlocutor=data.get("interlocutor", ""),
                    channel="phone" if kind == "call" else "panel",
                    outcome=data.get("call_result", "") if kind == "call" else "",
                    data={"phone": phone},
                )
            Audit.objects.create(
                unit=case.unit,
                actor=request.user,
                action="case." + kind,
                object_id=str(case.pk),
            )
            return s.CaseSerializer(case).data

        return self.once(request, execute)


class ConfigViewSet(ScopedRead, viewsets.GenericViewSet):
    """Configuration revisions are appended; there is no delete endpoint."""

    def create(self, request):
        unit = get_unit(request, ["admin"])

        def execute():
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            unique_field = {
                m.SourceConfiguration: "kind",
                m.PurposePolicy: "purpose",
                m.ReportDefinition: "code",
                m.ReportAccess: "phone",
            }.get(self.queryset.model)
            if (
                unique_field
                and self.queryset.model.objects.filter(
                    unit=unit, **{unique_field: serializer.validated_data[unique_field]}
                ).exists()
            ):
                raise ValidationError(
                    "Cadastro já existente nesta unidade; revise o registro em vez de duplicá-lo."
                )
            extra = {}
            if self.queryset.model in {m.Preparation, m.ImportLayout}:
                from django.db.models import Max

                identity = (
                    {"procedure_code": serializer.validated_data["procedure_code"]}
                    if self.queryset.model is m.Preparation
                    else {"name": serializer.validated_data["name"]}
                )
                extra["version"] = (
                    self.queryset.model.objects.filter(unit=unit, **identity).aggregate(
                        v=Max("version")
                    )["v"]
                    or 0
                ) + 1
            obj = serializer.save(unit=unit, **extra)
            self.validate_config(obj)
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="config.created",
                object_id=str(obj.pk),
                details={"resource": obj._meta.model_name},
            )
            return self.get_serializer(obj).data

        return self.once(request, execute)

    def validate_config(self, obj):
        if isinstance(obj, m.SourceConfiguration):
            import re

            if not re.fullmatch(r"[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*", obj.view_name):
                raise ValidationError("Informe SCHEMA.VIEW, sem SQL livre.")
            if obj.verified and not obj.evidence.strip():
                raise ValidationError("Fonte validada exige referência da evidência.")
        if isinstance(obj, m.FlowRule):
            if (
                obj.source.kind != "postoperative"
                or obj.purpose != "postoperative"
                or obj.template.purpose != obj.purpose
            ):
                raise ValidationError("Contrato de origem ou template incompatível.")
            if (
                not -365 <= obj.days_after <= 365
                or not obj.weekdays
                or any(
                    type(day) is not int or day not in range(7) for day in obj.weekdays
                )
            ):
                raise ValidationError("Janela temporal ou dias da semana inválidos.")
            if obj.enabled and (not obj.evidence.strip() or not obj.source.verified):
                raise ValidationError("Regra exige fonte e evidência homologadas.")
        if isinstance(obj, m.ImportLayout):
            if obj.verified and not obj.evidence.strip():
                raise ValidationError("Layout validado exige referência da evidência.")
            if not isinstance(obj.mapping, dict) or (
                obj.format != "absence_html"
                and not {
                    "external_id",
                    "patient",
                    "phone",
                    "occurred_at",
                }.issubset(obj.mapping)
            ):
                raise ValidationError("Mapeamento de colunas incompleto.")
            if any(
                not isinstance(value, str) or not value.strip() or len(value) > 200
                for value in obj.mapping.values()
            ):
                raise ValidationError("Nomes de coluna inválidos.")
        if (
            isinstance(obj, m.PurposePolicy)
            and obj.enabled
            and not obj.evidence.strip()
        ):
            raise ValidationError("Regra habilitada exige evidência.")
        if isinstance(obj, m.PurposePolicy) and not 1 <= obj.response_hours <= 168:
            raise ValidationError("Prazo deve estar entre 1 e 168 horas.")
        if (
            isinstance(obj, m.ReportDefinition)
            and obj.enabled
            and (obj.handler not in HANDLERS or obj.source != "local")
        ):
            raise ValidationError("Relatório externo ainda não homologado.")
        if isinstance(obj, m.ReportSchedule):
            if (
                obj.access.unit_id != obj.unit_id
                or not obj.access.reports.filter(pk=obj.report_id).exists()
            ):
                raise ValidationError(
                    "Destinatário não autorizado para este relatório."
                )
            if (
                not isinstance(obj.weekdays, list)
                or not obj.weekdays
                or any(type(d) is not int or d not in range(7) for d in obj.weekdays)
            ):
                raise ValidationError("Dias da semana inválidos.")
            validate_parameters(obj.parameters)

    @action(detail=True, methods=["post"])
    def configure(self, request, pk=None):
        get_unit(request, ["admin"])

        def execute():
            obj = self.get_object()
            if isinstance(obj, m.Preparation):
                raise ValidationError(
                    "Use nova versão para preservar o preparo anterior."
                )
            version = request.data.get("version")
            before = self.get_serializer(obj).data
            if type(version) is not int or not type(obj).objects.filter(
                pk=obj.pk, version=version
            ).update(version=F("version") + 1):
                raise Conflict()
            obj.refresh_from_db()
            serializer = self.get_serializer(obj, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            if (
                isinstance(obj, m.ImportLayout)
                and m.SheetImport.objects.filter(layout=obj).exists()
            ):
                raise ValidationError(
                    "Layout já utilizado; cadastre nova versão para preservar as importações."
                )
            obj = serializer.save()
            if isinstance(obj, m.ReportAccess) and (
                obj.phone != before["phone"] or obj.user_id != before["user"]
            ):
                obj.verified_at = None
                obj.save(update_fields=["verified_at"])
            self.validate_config(obj)
            if isinstance(obj, m.SourceConfiguration):
                Message.objects.filter(
                    unit=obj.unit,
                    appointment__kind=obj.kind,
                    state__in=["preview", "queued", "blocked"],
                ).update(state="cancelled")
                Message.objects.filter(
                    unit=obj.unit,
                    case__event__kind=obj.kind,
                    state__in=["preview", "queued", "blocked"],
                ).update(state="cancelled")
            elif isinstance(obj, (m.FlowRule, m.PurposePolicy)):
                Message.objects.filter(
                    unit=obj.unit,
                    purpose=getattr(obj, "purpose", "postoperative"),
                    state__in=["preview", "queued", "blocked"],
                ).update(state="cancelled")
            Audit.objects.create(
                unit=obj.unit,
                actor=request.user,
                action="config.revised",
                object_id=str(obj.pk),
                details={
                    "resource": obj._meta.model_name,
                    "before": before,
                    "version": obj.version,
                },
            )
            return self.get_serializer(obj).data

        return self.once(request, execute)


class ContactViewSet(ScopedRead):
    queryset = m.Contact.objects.select_related("event").order_by("id")
    serializer_class = s.ContactSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        from core.access import local_permissions

        if all(
            local_permissions(self.request.user, get_unit(self.request))[section]
            == "none"
            for section in ["campaigns", "appointments"]
        ):
            qs = qs.filter(event__appointment__isnull=False)
        return (
            qs.filter(event_id=self.request.query_params["event"])
            if self.request.query_params.get("event")
            else qs
        )

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        def execute():
            obj = self.get_object()
            status = request.data.get("status")
            text = str(request.data.get("text", "")).strip()
            if (
                status not in {"verified", "invalid", "wrong_person", "unverified"}
                or not 3 <= len(text) <= 4000
            ):
                raise ValidationError("Informe situação válida e justificativa.")
            version = request.data.get("version")
            if type(version) is not int or not m.Contact.objects.filter(
                pk=obj.pk, version=version
            ).update(status=status, version=F("version") + 1):
                raise Conflict()
            obj.refresh_from_db()
            if obj.patient_phone_id:
                from scheduling.models import PatientPhone

                PatientPhone.objects.filter(pk=obj.patient_phone_id).update(
                    status=status
                )
                m.Contact.objects.filter(patient_phone_id=obj.patient_phone_id).update(
                    status=status
                )
            for case in obj.event.cases.all():
                log(
                    case,
                    "contact_review",
                    text,
                    actor=request.user,
                    data={"status": status, "contact": obj.pk},
                )
            if status in {"invalid", "wrong_person"}:
                Message.objects.filter(
                    unit=obj.unit,
                    case__event=obj.event,
                    recipient=obj.phone,
                    state__in=["preview", "queued", "blocked"],
                ).update(state="cancelled")
            return self.get_serializer(obj).data

        return self.once(request, execute)


class MovementViewSet(ScopedRead):
    queryset = m.Movement.objects.order_by("-created_at")
    serializer_class = s.MovementSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        return (
            qs.filter(case_id=self.request.query_params["case"])
            if self.request.query_params.get("case")
            else qs
        )

    def create(self, request):
        def execute():
            unit = get_unit(request, ["admin", "operator"])
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            case = serializer.validated_data["case"]
            lock_case(case, request.data.get("case_version"))
            if not case.event.appointment_id:
                raise ValidationError("Movimentação exige um agendamento vinculado.")
            obj = serializer.save(
                unit=unit, created_by=request.user, before=case.event.data
            )
            case.state = "waiting_external"
            case.save()
            log(
                case,
                "movement_requested",
                "Alteração solicitada; aguardando execução no hospitalar.",
                actor=request.user,
                data={"movement": obj.pk, "kind": obj.kind},
            )
            return self.get_serializer(obj).data

        return self.once(request, execute)

    @extend_schema(request=s.MovementConfirmInput, responses=s.MovementSerializer)
    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        values = s.MovementConfirmInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            obj = self.get_object()
            data = values.validated_data
            if obj.state != "pending_external" or not m.Movement.objects.filter(
                pk=obj.pk, version=data["version"]
            ).update(version=F("version") + 1):
                raise Conflict()
            if not isinstance(data["final"], dict):
                raise ValidationError("Dados finais devem ser um objeto.")
            if obj.kind != "cancel":
                from django.utils.dateparse import parse_datetime

                stamp = data["final"].get("scheduled_at", "")
                final_date = parse_datetime(stamp) if isinstance(stamp, str) else None
                if not final_date or timezone.is_naive(final_date):
                    raise ValidationError(
                        "Informe scheduled_at final com fuso horário."
                    )
            obj.refresh_from_db()
            obj.state, obj.evidence, obj.final = (
                "confirmed_external",
                data["evidence"],
                data["final"],
            )
            obj.confirmed_by, obj.confirmed_at = request.user, timezone.now()
            obj.save()
            event = m.SourceEvent.objects.select_for_update().get(pk=obj.case.event_id)
            appointment = event.appointment
            appointment.revision += 1
            if obj.kind == "cancel":
                appointment.status = "cancelled"
            else:
                appointment.scheduled_at = final_date
                appointment.arrival_time = str(
                    obj.final.get("arrival_time", appointment.arrival_time)
                )
            appointment.save()
            from operations.services import ensure_appointment_case

            ensure_appointment_case(appointment)
            Message.objects.filter(
                case=obj.case, state__in=["preview", "queued", "blocked"]
            ).update(state="cancelled")
            log(
                obj.case,
                "movement_confirmed",
                obj.evidence,
                actor=request.user,
                data={"movement": obj.pk, "final": obj.final},
            )
            m.Case.objects.filter(pk=obj.case_id).update(
                state="closed"
                if obj.kind == "cancel"
                else "assigned"
                if obj.case.assignee_id
                else "open"
            )
            from messaging.models import Template

            template = Template.objects.filter(
                unit=obj.unit,
                purpose="movement",
                name="cancellation_demo" if obj.kind == "cancel" else "movement_demo",
            ).first()
            if template:
                notice_case, _ = m.Case.objects.get_or_create(
                    unit=obj.unit, event=event, purpose="movement"
                )
                campaign = m.Campaign.objects.create(
                    unit=obj.unit,
                    name=f"Movimentação {obj.pk}",
                    purpose="movement",
                    template=template,
                    scheduled_for=timezone.now(),
                )
                campaign.cases.add(notice_case)
                preview_campaign(campaign)
            return self.get_serializer(obj).data

        return self.once(request, execute)


class PreparationViewSet(ConfigViewSet):
    queryset = m.Preparation.objects.order_by("procedure_code", "-version")
    serializer_class = s.PreparationSerializer

    def validate_config(self, obj):
        previous = m.Preparation.objects.filter(
            unit=obj.unit, procedure_code=obj.procedure_code
        ).exclude(pk=obj.pk)
        from django.db.models import Max

        obj.version = (previous.aggregate(v=Max("version"))["v"] or 0) + 1
        previous.update(active=False)
        obj.save(update_fields=["version"])
        Message.objects.filter(
            unit=obj.unit,
            snapshot__preparation_code=obj.procedure_code,
            state__in=["preview", "queued", "blocked"],
        ).update(state="cancelled")


class LayoutViewSet(ConfigViewSet):
    queryset = m.ImportLayout.objects.order_by("name", "-version")
    serializer_class = s.LayoutSerializer


class PolicyViewSet(ConfigViewSet):
    queryset = m.PurposePolicy.objects.order_by("purpose")
    serializer_class = s.PolicySerializer


class SheetViewSet(ScopedRead):
    queryset = m.SheetImport.objects.select_related(
        "unit", "layout", "template", "campaign"
    ).order_by("-created_at")
    serializer_class = s.SheetSerializer

    @extend_schema(request=s.SheetPreviewInput, responses=s.SheetSerializer)
    def create(self, request):
        values = s.SheetPreviewInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            unit = get_unit(request, ["admin", "operator"])
            data = values.validated_data
            layout = get_object_or_404(m.ImportLayout, unit=unit, pk=data["layout"])
            try:
                content = base64.b64decode(data["content_base64"], validate=True)
            except (ValueError, binascii.Error):
                raise ValidationError("Arquivo codificado inválido.") from None
            return s.SheetSerializer(
                preview_sheet(
                    unit,
                    layout,
                    request.user,
                    data["filename"],
                    content,
                    template_id=data.get("template"),
                    standard_mapping=data.get("standard_mapping"),
                    parameter_fields=data.get("parameter_fields"),
                )
            ).data

        return self.once(request, execute)

    @extend_schema(responses=s.StandardSchemaSerializer)
    @action(
        detail=False, methods=["get"], url_path="schema", url_name="standard-schema"
    )
    def standard_contract(self, request):
        from operations.standardization import DEFAULT_MAPPINGS, STANDARD_FIELDS

        return Response(
            {
                "version": 1,
                "fields": list(STANDARD_FIELDS),
                "default_mappings": DEFAULT_MAPPINGS,
            }
        )

    @extend_schema(responses={(200, "text/csv"): bytes})
    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        from django.http import HttpResponse

        from operations.standardization import csv_standard_rows, display_rows

        batch = self.get_object()
        response = HttpResponse(
            csv_standard_rows(display_rows(batch)),
            content_type="text/csv; charset=utf-8",
        )
        response["Content-Disposition"] = (
            f'attachment; filename="cross-padronizado-{batch.pk}.csv"'
        )
        response["Cache-Control"] = "no-store"
        return response

    @extend_schema(responses=s.StandardRowSerializer(many=True))
    @action(detail=True, methods=["get"])
    def rows(self, request, pk=None):
        batch = self.get_object()
        from operations.standardization import display_rows

        return self.get_paginated_response(self.paginate_queryset(display_rows(batch)))

    @extend_schema(responses=s.CrossRecordSerializer(many=True))
    @action(detail=True, methods=["get"])
    def records(self, request, pk=None):
        from operations.cross_controls import batch_rows

        rows = batch_rows(self.get_object())
        search = request.query_params.get("search", "").strip().casefold()
        if search:
            rows = [
                row
                for row in rows
                if any(
                    search in str(row.get(key, "")).casefold()
                    for key in [
                        "nome_completo",
                        "patient",
                        "codigo",
                        "record_id",
                        "phone_numbers",
                    ]
                )
            ]
        if request.query_params.get("recent_only") == "true":
            rows = [row for row in rows if row["recent_send_count"]]
        if request.query_params.get("enabled") in {"true", "false"}:
            enabled = request.query_params["enabled"] == "true"
            rows = [row for row in rows if row["enabled"] == enabled]
        return self.get_paginated_response(self.paginate_queryset(rows))

    @extend_schema(request=s.CrossBatchControlInput, responses=s.SheetSerializer)
    @action(detail=True, methods=["post"], url_path="activation")
    def activation(self, request, pk=None):
        values = s.CrossBatchControlInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            from operations.cross_controls import set_batch_enabled

            batch = set_batch_enabled(
                self.get_object(), actor=request.user, **values.validated_data
            )
            return self.get_serializer(batch).data

        return self.once(request, execute)

    @extend_schema(request=s.CrossRecordsControlInput, responses=s.SheetSerializer)
    @action(detail=True, methods=["post"], url_path="record-activation")
    def record_activation(self, request, pk=None):
        values = s.CrossRecordsControlInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            from operations.cross_controls import set_records_enabled

            batch = set_records_enabled(
                self.get_object(), actor=request.user, **values.validated_data
            )
            return self.get_serializer(batch).data

        return self.once(request, execute)

    @extend_schema(request=s.SheetConfirmInput)
    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        values = s.SheetConfirmInput(data=request.data)
        values.is_valid(raise_exception=True)
        return self.once(
            request,
            lambda: {
                "cases": confirm_sheet(
                    self.get_object(), values.validated_data["purpose"]
                )
            },
        )


class CampaignViewSet(ScopedRead):
    @extend_schema(request=s.CampaignScheduleInput)
    @action(detail=True, methods=["post"])
    def schedule(self, request, pk=None):
        values = s.CampaignScheduleInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            unit = get_unit(request, ["admin", "operator"])
            campaign = m.Campaign.objects.select_for_update().get(
                pk=self.get_object().pk, unit=unit
            )
            if campaign.version != values.validated_data["version"]:
                raise Conflict()
            if campaign.state != "draft":
                raise ValidationError(
                    "Altere somente um rascunho, antes de gerar a prévia."
                )
            campaign.scheduled_for = values.validated_data["scheduled_for"]
            campaign.name = values.validated_data.get("name", campaign.name)
            campaign.version += 1
            campaign.save(update_fields=["scheduled_for", "name", "version"])
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="campaign.scheduled",
                object_id=str(campaign.pk),
                details={"version": campaign.version},
            )
            return self.get_serializer(campaign).data

        return self.once(request, execute)

    @extend_schema(request=s.CampaignSendingInput)
    @action(detail=True, methods=["post"])
    def sending(self, request, pk=None):
        values = s.CampaignSendingInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            from core.models import Unit

            unit = get_unit(request, ["admin"])
            unit = Unit.objects.select_for_update(no_key=True).get(pk=unit.pk)
            campaign = m.Campaign.objects.select_for_update().get(
                pk=self.get_object().pk, unit=unit
            )
            if campaign.import_batch_id:
                raise ValidationError(
                    "Gerencie esta importação pelos controles do Importa CROSS."
                )
            if campaign.version != values.validated_data["version"]:
                raise Conflict()
            enabled = values.validated_data["enabled"]
            if enabled:
                from messaging.pilot import catalog_template, configuration

                if (
                    campaign.purpose != "absence"
                    or campaign.response_policy != "confirmation_test"
                    or not campaign.template
                    or campaign.template.name != "confirmacao_consulta_sqlite_v1"
                ):
                    raise ValidationError(
                        "Configure o template e a política de teste da campanha."
                    )
                try:
                    catalog_template(configuration(unit), campaign.template.name)
                except ValueError as error:
                    raise ValidationError(str(error)) from None
                if unit.paused:
                    # Preserve old group queues without releasing them when restoring transport.
                    for pending in Message.objects.filter(
                        unit=unit, attempt_count=0, snapshot__manual_group_real=True
                    ):
                        pending.snapshot["manual_group_real"] = False
                        pending.save(update_fields=["snapshot"])
                    unit.paused = False
                    unit.save(update_fields=["paused"])
            campaign.sends_enabled = enabled
            campaign.version += 1
            campaign.save(update_fields=["sends_enabled", "version"])
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="campaign.sending_changed",
                object_id=str(campaign.pk),
                details={"enabled": enabled},
            )
            return self.get_serializer(campaign).data

        return self.once(request, execute)

    @extend_schema(request=s.VersionInput)
    @action(detail=True, methods=["post"])
    def release(self, request, pk=None):
        values = s.VersionInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            from datetime import timedelta

            from core.models import Unit
            from messaging.pilot import prepare

            unit = get_unit(request, ["admin"])
            unit = Unit.objects.select_for_update(no_key=True).get(pk=unit.pk)
            campaign = m.Campaign.objects.select_for_update().get(
                pk=self.get_object().pk, unit=unit
            )
            if campaign.import_batch_id:
                raise ValidationError(
                    "Gerencie esta importação pelos controles do Importa CROSS."
                )
            if campaign.version != values.validated_data["version"]:
                raise Conflict()
            if (
                not campaign.sends_enabled
                or unit.paused
                or campaign.state not in {"draft", "preview"}
            ):
                raise ValidationError(
                    "Ative o envio da campanha e da unidade antes de liberar um rascunho."
                )
            now = timezone.now()
            campaign.scheduled_for = now
            campaign.save(update_fields=["scheduled_for"])
            ids = (
                preview_campaign(campaign)
                if campaign.state == "draft"
                else list(
                    Message.objects.filter(
                        unit=unit, state="preview", snapshot__campaign=campaign.pk
                    ).values_list("pk", flat=True)
                )
            )
            if not ids:
                raise ValidationError("Campanha sem mensagens elegíveis.")
            for index, message in enumerate(
                Message.objects.filter(pk__in=ids)
                .select_related("case__event", "unit")
                .order_by("pk")
            ):
                prepare(message, campaign.template.name)
                message.snapshot["manual_campaign_real"] = True
                message.state = "queued"
                message.scheduled_for = now + timedelta(seconds=index * 5)
                message.expires_at = now + timedelta(days=1)
                message.save()
            campaign.state = "released"
            campaign.version += 1
            campaign.save(update_fields=["state", "version"])
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="campaign.released",
                object_id=str(campaign.pk),
                details={"messages": len(ids), "delay_seconds": 5},
            )
            return {"messages": len(ids), "state": campaign.state}

        return self.once(request, execute)

    queryset = m.Campaign.objects.order_by("-created_at")
    serializer_class = s.CampaignSerializer

    def create(self, request):
        def execute():
            unit = get_unit(request, ["admin", "operator"])
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            purpose = serializer.validated_data["purpose"]
            cases = serializer.validated_data.get("cases", [])
            if not cases or any(c.purpose != purpose for c in cases):
                raise ValidationError("Selecione casos da mesma finalidade.")
            return self.get_serializer(serializer.save(unit=unit)).data

        return self.once(request, execute)

    @extend_schema(request=s.VersionInput)
    @action(detail=True, methods=["post"])
    def preview(self, request, pk=None):
        def execute():
            campaign = self.get_object()
            if request.data.get("version") != campaign.version:
                raise Conflict()
            ids = preview_campaign(campaign)
            return {"messages": ids, "mode": "analysis", "real_sends": False}

        return self.once(request, execute)


class ReportViewSet(ConfigViewSet):
    queryset = m.ReportDefinition.objects.order_by("name")
    serializer_class = s.ReportSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        unit = get_unit(self.request)
        if (
            user.is_superuser
            or Membership.objects.filter(unit=unit, user=user, role="admin").exists()
        ):
            return qs
        return qs.filter(
            reportaccess__unit=unit,
            reportaccess__user=user,
            reportaccess__active=True,
            reportaccess__verified_at__isnull=False,
        ).distinct()


class ReportAccessViewSet(ConfigViewSet):
    queryset = m.ReportAccess.objects.order_by("id")
    serializer_class = s.ReportAccessSerializer

    def get_queryset(self):
        get_unit(self.request)
        return super().get_queryset()

    def validate_config(self, obj):
        from scheduling.connectors import normalize_phone

        try:
            obj.phone = normalize_phone(obj.phone)
        except ValueError:
            raise ValidationError("Número inválido.") from None
        if (
            not eligible_operator(obj.user, obj.unit)
            and not Membership.objects.filter(unit=obj.unit, user=obj.user).exists()
        ):
            raise ValidationError("Usuário sem acesso à unidade.")
        obj.save(update_fields=["phone"])

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        get_unit(request, ["admin"])

        def execute():
            obj = self.get_object()
            evidence = str(request.data.get("evidence", "")).strip()
            if not 5 <= len(evidence) <= 4000:
                raise ValidationError(
                    "Registre como a titularidade do número foi verificada."
                )
            obj.verified_at = timezone.now()
            obj.save(update_fields=["verified_at"])
            Audit.objects.create(
                unit=obj.unit,
                actor=request.user,
                action="report_access.verified",
                object_id=str(obj.pk),
                details={"evidence": evidence},
            )
            return self.get_serializer(obj).data

        return self.once(request, execute)

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        get_unit(request, ["admin"])

        def execute():
            obj = self.get_object()
            obj.active = False
            obj.save(update_fields=["active"])
            Audit.objects.create(
                unit=obj.unit,
                actor=request.user,
                action="report_access.revoked",
                object_id=str(obj.pk),
            )
            return self.get_serializer(obj).data

        return self.once(request, execute)


class ReportRequestViewSet(ScopedRead):
    queryset = m.ReportRequest.objects.select_related(
        "report", "requester", "unit", "access"
    ).order_by("-created_at")
    serializer_class = s.ReportRequestSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        unit = get_unit(self.request)
        if not (
            self.request.user.is_superuser
            or Membership.objects.filter(
                unit=unit, user=self.request.user, role="admin"
            ).exists()
        ):
            qs = qs.filter(requester=self.request.user)
        return qs

    @extend_schema(request=s.ReportInput, responses=s.ReportRequestSerializer)
    def create(self, request):
        values = s.ReportInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            unit = get_unit(request, ["admin", "operator"])
            data = values.validated_data
            report = get_object_or_404(m.ReportDefinition, unit=unit, pk=data["report"])
            params = validate_parameters(data["parameters"])
            job = m.ReportRequest(
                unit=unit,
                report=report,
                requester=request.user,
                parameters=params,
                format=data["format"],
                definition_version=report.version,
            )
            check_access(job)
            job.save()
            from django.conf import settings

            from operations.tasks import run_report

            if settings.ASYNC_TASKS:
                transaction.on_commit(lambda: run_report.delay(str(job.pk)))
            else:
                from operations.reports import generate

                generate(job.pk)
                job.refresh_from_db()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="report.requested",
                object_id=str(job.pk),
            )
            return self.get_serializer(job).data

        return self.once(request, execute)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        job = self.get_object()
        check_access(job)
        if job.state != "ready":
            raise ValidationError("Relatório ainda não está disponível.")
        result = base64.b64decode(job.result) if job.format == "pdf" else job.result
        response = HttpResponse(
            result,
            content_type={
                "pdf": "application/pdf",
                "csv": "text/csv; charset=utf-8",
                "text": "text/plain; charset=utf-8",
            }[job.format],
        )
        response["Content-Disposition"] = (
            f'attachment; filename="relatorio-{job.pk}.{job.format if job.format != "text" else "txt"}"'
        )
        response["Cache-Control"] = "no-store"
        Audit.objects.create(
            unit=job.unit,
            actor=request.user,
            action="report.downloaded",
            object_id=str(job.pk),
        )
        return response

    @action(detail=True, methods=["post"])
    def delivery_preview(self, request, pk=None):
        def execute():
            from operations.reports import prepare_delivery

            job = self.get_object()
            message = prepare_delivery(job)
            Audit.objects.create(
                unit=job.unit,
                actor=request.user,
                action="report.delivery_preview",
                object_id=str(job.pk),
            )
            return {
                "message": str(message.pk),
                "delivery_state": "preview",
                "real_sends": False,
            }

        return self.once(request, execute)


class ReportScheduleViewSet(ConfigViewSet):
    queryset = m.ReportSchedule.objects.order_by("id")
    serializer_class = s.ReportScheduleSerializer

    def get_queryset(self):
        get_unit(self.request, ["admin"])
        return super().get_queryset()


class SourceConfigurationViewSet(ConfigViewSet):
    queryset = m.SourceConfiguration.objects.order_by("kind")
    serializer_class = s.SourceConfigurationSerializer


class FlowRuleViewSet(ConfigViewSet):
    queryset = m.FlowRule.objects.order_by("name")
    serializer_class = s.FlowRuleSerializer


class FlowRunViewSet(ScopedRead):
    queryset = m.FlowRun.objects.order_by("-started_at")
    serializer_class = s.FlowRunSerializer


class UnitViewSet(viewsets.ReadOnlyModelViewSet):
    @action(detail=True, methods=["post"])
    def configure(self, request, pk=None):
        anchor = get_unit(request, ["admin"])

        def execute():
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

            from core.access import local_permissions
            from core.models import Unit

            obj = get_object_or_404(self.get_queryset(), pk=pk)
            if (
                not request.user.is_superuser
                and not Membership.objects.filter(
                    unit=obj, user=request.user, role="admin"
                ).exists()
            ):
                raise ValidationError("Administração da unidade necessária.")
            if not any(
                local_permissions(request.user, obj)[key] == "write"
                for key in ["settings", "operationsAdmin"]
            ):
                raise ValidationError("Sem permissão para editar esta unidade.")
            if type(request.data.get("version")) is not int or not Unit.objects.filter(
                pk=obj.pk, version=request.data["version"]
            ).update(version=F("version") + 1):
                raise Conflict()
            obj.refresh_from_db()
            if "slug" in request.data and request.data["slug"] != obj.slug:
                raise ValidationError("Preserve o identificador da unidade.")
            serializer = self.get_serializer(obj, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            try:
                ZoneInfo(serializer.validated_data.get("timezone", obj.timezone))
            except (ZoneInfoNotFoundError, ValueError):
                raise ValidationError("Fuso horário inválido.") from None
            hours = serializer.validated_data.get("response_hours", obj.response_hours)
            if not 1 <= hours <= 168:
                raise ValidationError("Prazo deve estar entre 1 e 168 horas.")
            obj = serializer.save()
            Audit.objects.create(
                unit=obj,
                actor=request.user,
                action="unit.configured",
                object_id=str(obj.pk),
                details={"version": obj.version},
            )
            return self.get_serializer(obj).data

        return Response(
            idempotent(
                anchor,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"path": request.path, "data": request.data},
                execute,
            )
        )

    from core.serializers import UnitSerializer

    serializer_class = UnitSerializer
    from core.models import Unit

    queryset = Unit.objects.none()

    def get_queryset(self):
        from core.models import Unit

        if self.request.user.is_superuser:
            return Unit.objects.all().order_by("name")
        return Unit.objects.filter(membership__user=self.request.user).order_by("name")

    @transaction.atomic
    def create(self, request):
        unit = get_unit(request, ["admin"])

        def execute():
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            try:
                ZoneInfo(serializer.validated_data.get("timezone", "America/Sao_Paulo"))
            except ZoneInfoNotFoundError:
                raise ValidationError("Fuso horário inválido.") from None
            obj = serializer.save(paused=True)
            Membership.objects.get_or_create(
                unit=obj, user=request.user, defaults={"role": "admin"}
            )
            from operations.catalog import seed_catalog

            seed_catalog(obj)
            Audit.objects.create(
                unit=obj,
                actor=request.user,
                action="unit.created",
                object_id=str(obj.pk),
            )
            return self.get_serializer(obj).data

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"path": request.path, "data": request.data},
                execute,
            )
        )
