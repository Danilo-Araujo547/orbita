import hashlib
import hmac
import json
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.db import transaction
from django.db.models import Count, F, Q
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.views.decorators.http import require_http_methods
from drf_spectacular.utils import extend_schema
from messaging.models import Message, MetaConfiguration, Template
from messaging.services import dispatch, retry_individual
from responses.models import Issue, Reply
from responses.services import apply_reply, apply_status, ingest_webhook, mark_no_response, store_event
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from scheduling.connectors import AppointmentData, OracleSource, normalize_phone
from scheduling.models import Appointment, ImportRun, Rule
from scheduling.services import import_rule, queue_appointment, upsert_appointment

from core.contracts import (
    AckOutput,
    ControlInput,
    ControlOutput,
    CsrfOutput,
    ImportInput,
    IndicatorsOutput,
    ProcessTestInput,
    ResolveInput,
    SessionOutput,
    SimulateInput,
    TestAppointmentInput,
)
from core.models import Audit, Membership, Unit
from core.permissions import get_unit
from core.serializers import (
    AppointmentCommunicationsSerializer,
    AppointmentSerializer,
    AuditSerializer,
    ImportRunSerializer,
    IssueSerializer,
    MessageSerializer,
    ReplySerializer,
    RuleSerializer,
    TemplateSerializer,
    UnitSerializer,
)


def date_filter(queryset, request, field):
    zone = ZoneInfo(get_unit(request).timezone)
    for key, lookup in [("start", "gte"), ("end", "lt")]:
        value = request.query_params.get(key)
        if value:
            try:
                day = datetime.strptime(value, "%Y-%m-%d").date()
            except ValueError:
                raise ValidationError("Data deve usar AAAA-MM-DD.") from None
            if key == "end":
                day += timedelta(days=1)
            queryset = queryset.filter(**{f"{field}__{lookup}": datetime.combine(day, time.min, zone)})
    return queryset


class LoginThrottle(AnonRateThrottle):
    rate = "10/min"


class LoginInput(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    @extend_schema(request=LoginInput, responses={200: dict})
    def post(self, request):
        values = LoginInput(data=request.data)
        values.is_valid(raise_exception=True)
        user = authenticate(request, **values.validated_data)
        if user is None:
            return Response({"detail": "Usuário ou senha inválidos."}, status=400)
        login(request, user)
        return Response({"username": user.username, "csrfToken": get_token(request)})


@extend_schema(responses=CsrfOutput)
@api_view(["GET"])
@permission_classes([AllowAny])
def csrf(request):
    return Response({"csrfToken": get_token(request)})


@extend_schema(methods=["GET"], responses=SessionOutput)
@extend_schema(methods=["POST"], request=None, responses=AckOutput)
@api_view(["GET", "POST"])
def session(request):
    if request.method == "POST":
        logout(request)
        return Response({"ok": True})
    units = (
        Unit.objects.all()
        if request.user.is_superuser
        else Unit.objects.filter(membership__user=request.user)
    )
    roles = dict(Membership.objects.filter(user=request.user).values_list("unit__slug", "role"))
    if request.user.is_superuser:
        roles = {unit.slug: "admin" for unit in units}
    from core.federation import remote_options

    remotes, remote_roles = remote_options(request.user)
    roles.update(remote_roles)
    from core.access import local_permissions

    permissions = {unit.slug: local_permissions(request.user, unit) for unit in units}
    permissions.update({remote["slug"]: remote["permissions"] for remote in remotes})
    return Response(
        {
            "username": request.user.username,
            "units": list(UnitSerializer(units, many=True).data) + remotes,
            "roles": roles,
            "permissions": permissions,
            "mode": settings.SEND_MODE,
        }
    )


@extend_schema(responses=ControlOutput)
@api_view(["GET"])
def workspace(request):
    unit = get_unit(request)
    return Response(
        {
            "unit": UnitSerializer(unit).data,
            "mode": settings.SEND_MODE,
            "test_recipients": [],
            "oracle_configured": False,
            "meta_configured": False,
            "legacy_exclusion": True,
            "production_enabled": False,
        }
    )


class ScopedReadViewSet(viewsets.ReadOnlyModelViewSet):
    def get_queryset(self):
        queryset = self.queryset.filter(unit=get_unit(self.request))
        if self.request.query_params.get("kind"):
            field = "kind" if self.queryset.model is Appointment else "appointment__kind"
            if self.queryset.model in [Appointment, Message]:
                queryset = queryset.filter(**{field: self.request.query_params["kind"]})
        return queryset


class AppointmentViewSet(ScopedReadViewSet):
    queryset = (
        Appointment.objects.select_related("sourceevent")
        .prefetch_related(
            "messages",
            "sourceevent__cases__corrections",
            "sourceevent__cases__interactions",
            "sourceevent__contact_set",
        )
        .order_by("scheduled_at", "pk")
    )
    serializer_class = AppointmentSerializer

    def get_queryset(self):
        basis = self.request.query_params.get("date_basis", "appointment")
        field = {
            "appointment": "scheduled_at",
            "send": "messages__scheduled_for",
            "reply": "messages__replies__event__occurred_at",
        }.get(basis)
        if field is None:
            raise ValidationError("Período inválido.")
        queryset = date_filter(super().get_queryset(), self.request, field)
        params = self.request.query_params
        if params.get("group"):
            from messaging.models import AppointmentGroup

            group_id = serializers.UUIDField().run_validation(params["group"])
            group = get_object_or_404(AppointmentGroup, pk=group_id, unit=get_unit(self.request))
            queryset = queryset.filter(messages__group=group, messages__appointment_revision=F("revision"))
        if params.get("operational_pending") == "true":
            queryset = queryset.exclude(sourceevent__cases__outcome="confirmed").filter(
                Q(sourceevent__cases__outcome__in=["declined", "review", "wrong_person", "opt_out"])
                | Q(sourceevent__cases__response_state="no_response")
                | Q(
                    sourceevent__cases__corrections__resolved_at__isnull=True,
                    sourceevent__cases__corrections__isnull=False,
                )
                | Q(
                    messages__appointment_revision=F("revision"),
                    messages__state__in=["failed", "blocked", "uncertain"],
                )
                | Q(sourceevent__contact__status__in=["invalid", "wrong_person"])
                | Q(sourceevent__contact__opted_out=True)
            )
        for param, field in {
            "kind": "kind",
            "delivery": "messages__state",
            "response": "sourceevent__cases__response_state",
            "outcome": "sourceevent__cases__outcome",
        }.items():
            if params.get(param):
                queryset = queryset.filter(**{field: params[param]})
        if params.get("corrections") == "true":
            queryset = queryset.filter(
                sourceevent__cases__corrections__resolved_at__isnull=True,
                sourceevent__cases__corrections__isnull=False,
            )
        if params.get("observations") == "true":
            queryset = queryset.filter(sourceevent__cases__interactions__kind__in=["note", "call"])
        elif params.get("observations") == "false":
            queryset = queryset.exclude(sourceevent__cases__interactions__kind__in=["note", "call"])
        query = self.request.query_params.get("search", "")
        return queryset.filter(
            Q(patient__icontains=query)
            | Q(external_id__icontains=query)
            | Q(phone__icontains=query)
            | Q(messages__recipient__icontains=query)
            | Q(sourceevent__contact__phone__icontains=query)
            | Q(patient_external_id__icontains=query)
        ).distinct()

    @action(detail=False, methods=["get"])
    def export(self, request):
        import csv

        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="agendamentos.csv"'
        response.write("\ufeff")
        if self.get_queryset().count() > 10000:
            raise ValidationError("Limite de 10.000 registros; restrinja os filtros para exportar.")
        writer = csv.writer(response)
        writer.writerow(["Código", "Paciente", "Contatos", "Procedimento", "Data", "Resposta"])
        for item in self.get_queryset().iterator(chunk_size=500):
            values = [
                item.external_id,
                item.patient,
                "; ".join(item.phone_numbers or [item.phone]),
                item.procedure,
                item.scheduled_at.isoformat(),
                self.get_serializer(item).data["tracking"]["outcome"],
            ]
            writer.writerow(["'" + str(v) if str(v).startswith(("=", "+", "-", "@")) else v for v in values])
        return response

    @extend_schema(responses=AppointmentCommunicationsSerializer)
    @action(detail=True, methods=["get"])
    def communications(self, request, pk=None):
        from operations.serializers import InteractionSerializer

        appointment = self.get_object()
        messages = (
            appointment.messages.select_related("appointment", "rule", "template")
            .prefetch_related("attempts", "replies__event")
            .order_by("-created_at")
        )
        if request.query_params.get("group"):
            messages = messages.filter(group_id=request.query_params["group"])
        page = self.paginate_queryset(messages)
        response = self.get_paginated_response(MessageSerializer(page, many=True).data)
        event = getattr(appointment, "sourceevent", None)
        manual = event.cases.filter(purpose="appointment").first() if event else None
        response.data["manual_responses"] = (
            InteractionSerializer(
                manual.interactions.filter(kind="classification", actor__isnull=False)
                .select_related("actor")
                .order_by("-occurred_at", "-pk")[:100],
                many=True,
            ).data
            if manual
            else []
        )
        return response


class MessageViewSet(ScopedReadViewSet):
    queryset = (
        Message.objects.select_related("appointment", "rule", "template")
        .prefetch_related("attempts", "replies__event")
        .order_by("-created_at")
    )
    serializer_class = MessageSerializer

    def get_queryset(self):
        from django.db.models.functions import Coalesce

        queryset = date_filter(
            super()
            .get_queryset()
            .annotate(event_date=Coalesce("appointment__scheduled_at", "case__event__occurred_at")),
            self.request,
            "event_date",
        )
        for field in ["state", "response_state", "appointment"]:
            if self.request.query_params.get(field):
                value = self.request.query_params[field]
                if field == "state" and value == "delivered_or_read":
                    queryset = queryset.filter(state__in=["delivered", "read"])
                else:
                    queryset = queryset.filter(**{field: value})
        query = self.request.query_params.get("search", "")
        return queryset.filter(
            Q(appointment__patient__icontains=query)
            | Q(case__event__patient__icontains=query)
            | Q(recipient__icontains=query)
        )

    @extend_schema(request=None, responses=MessageSerializer)
    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        get_unit(request, ["admin", "operator"])
        try:
            message = retry_individual(self.get_object(), request.user)
        except ValueError as exc:
            raise ValidationError(str(exc)) from None
        return Response(self.get_serializer(message).data)

    @extend_schema(request=SimulateInput, responses=AckOutput)
    @action(detail=True, methods=["post"])
    def simulate(self, request, pk=None):
        unit = get_unit(request, ["admin", "operator"])
        message = self.get_object()
        if (
            settings.SEND_MODE != "simulated"
            or not (
                message.appointment.synthetic
                if message.appointment_id
                else message.case and message.case.event.synthetic
            )
            or message.channel_id != "simulated"
        ):
            raise ValidationError("Simulação disponível somente para dados sintéticos no modo simulado.")
        event_type = request.data.get("event")
        if event_type not in ["sent", "delivered", "read", "confirmed", "declined", "review"]:
            raise ValidationError("Evento inválido.")
        if not message.provider_id:
            raise ValidationError("Primeiro processe o envio de teste.")
        stamp = int(timezone.now().timestamp())
        if event_type in ["sent", "delivered", "read"]:
            event = store_event("simulated", message.provider_id, event_type, stamp, {})
            apply_status(event)
        else:
            event = store_event(
                "simulated",
                f"sim.reply.{message.pk}.{event_type}.{stamp}",
                "reply",
                stamp,
                {
                    "sender": message.recipient,
                    "text": {"confirmed": "Sim", "declined": "Não", "review": "Preciso de orientação"}[
                        event_type
                    ],
                    "context_id": message.provider_id,
                },
            )
            apply_reply(event, unit)
        Audit.objects.create(
            unit=unit, actor=request.user, action="simulation." + event_type, object_id=str(message.pk)
        )
        return Response({"ok": True})


class ReplyViewSet(ScopedReadViewSet):
    queryset = Reply.objects.select_related("event", "message__appointment").order_by("-event__occurred_at")
    serializer_class = ReplySerializer

    def get_queryset(self):
        appointments = date_filter(
            Appointment.objects.filter(unit=get_unit(self.request)), self.request, "scheduled_at"
        )
        if self.request.query_params.get("kind"):
            appointments = appointments.filter(kind=self.request.query_params["kind"])
        return (
            super().get_queryset().filter(Q(message__appointment__in=appointments) | Q(message__isnull=True))
        )


class IssueViewSet(ScopedReadViewSet):
    queryset = Issue.objects.select_related("message__appointment", "reply").order_by("-created_at")
    serializer_class = IssueSerializer

    def get_queryset(self):
        queryset = super().get_queryset().exclude(category="no_response")
        appointments = date_filter(
            Appointment.objects.filter(unit=get_unit(self.request)), self.request, "scheduled_at"
        )
        if self.request.query_params.get("kind"):
            appointments = appointments.filter(kind=self.request.query_params["kind"])
        queryset = queryset.filter(Q(message__appointment__in=appointments) | Q(message__isnull=True))
        if self.request.query_params.get("resolved") != "all":
            queryset = queryset.filter(resolved_at__isnull=True)
        return queryset

    @extend_schema(request=ResolveInput, responses=IssueSerializer)
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        unit = get_unit(request, ["admin", "operator"])
        resolution = str(request.data.get("resolution", "")).strip()
        if len(resolution) < 5 or len(resolution) > 4000:
            raise ValidationError("Descreva a resolução usando de 5 a 4000 caracteres.")
        classification = request.data.get("classification")
        if classification not in [
            None,
            "confirmed",
            "declined",
            "review",
            "wrong_person",
            "opt_out",
            "stay_waitlist",
            "leave_waitlist",
            "acknowledged",
            "well",
            "needs_attention",
            "reason_received",
        ]:
            raise ValidationError("Classificação inválida.")
        with transaction.atomic():
            issue = Issue.objects.select_for_update().get(pk=self.get_object().pk)
            if issue.resolved_at:
                raise ValidationError("Pendência já resolvida.")
            message = issue.message
            if request.data.get("message_id"):
                message = (
                    Message.objects.select_for_update()
                    .filter(pk=request.data["message_id"], unit=unit)
                    .first()
                )
                if not message or not issue.reply or message.recipient != issue.reply.sender:
                    raise ValidationError("O lembrete deve pertencer à unidade e ao número que respondeu.")
                if message.channel_id != issue.reply.event.channel_id:
                    raise ValidationError("Canal incompatível.")
                issue.message = message
                issue.reply.message = message
                issue.reply.save(update_fields=["message"])
            if classification:
                if not message:
                    raise ValidationError("Vincule um lembrete antes de classificar.")
                if message.case_id:
                    from operations.models import Case
                    from operations.services import apply_outcome

                    case = Case.objects.select_for_update().get(pk=message.case_id)
                    apply_outcome(case, classification, request.user, resolution, reply_id=issue.reply_id)
                message.response_state = classification
                message.save(update_fields=["response_state", "updated_at"])
                # The original automatic classification stays on Reply; manual decisions are append-only case events.
            issue.resolution, issue.resolved_at = resolution, timezone.now()
            issue.save()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="issue.resolved",
                object_id=str(issue.pk),
                details={"classification": classification},
            )
        return Response(self.get_serializer(issue).data)


class RuleViewSet(ScopedReadViewSet):
    queryset = Rule.objects.select_related("template").order_by("send_time")
    serializer_class = RuleSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "unit": get_unit(self.request)}

    @extend_schema(request=RuleSerializer, responses=RuleSerializer)
    def create(self, request):
        import re

        from operations.services import idempotent

        unit = get_unit(request, ["admin"])

        def execute():
            code = request.data.get("code", "")
            if (
                not isinstance(code, str)
                or not re.fullmatch(r"[a-z0-9-]{3,80}", code)
                or Rule.objects.filter(unit=unit, code=code).exists()
            ):
                raise ValidationError("Identificador inválido ou já existente.")
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            rule = serializer.save(unit=unit, code=code, enabled=False)
            Audit.objects.create(unit=unit, actor=request.user, action="rule.created", object_id=str(rule.pk))
            return self.get_serializer(rule).data

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"path": request.path, "data": request.data},
                execute,
            )
        )

    @extend_schema(request=RuleSerializer, responses=RuleSerializer)
    @action(detail=True, methods=["post"])
    def configure(self, request, pk=None):
        unit = get_unit(request, ["admin"])
        with transaction.atomic():
            rule = Rule.objects.select_for_update().get(pk=self.get_object().pk)
            was_enabled = rule.enabled
            if "version" in request.data and request.data["version"] != rule.version:
                from operations.services import Conflict

                raise Conflict()
            serializer = self.get_serializer(rule, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            rule = serializer.save(version=rule.version + 1)
            if rule.enabled and not was_enabled and not rule.legacy_report_id and not rule.evidence.strip():
                raise ValidationError("Habilitação exige referência da evidência de validação.")
            Message.objects.filter(rule=rule, state__in=["queued", "preview", "blocked"]).update(
                state="cancelled"
            )
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="rule.changed",
                object_id=str(rule.pk),
                details={"version": rule.version},
            )
        return Response(self.get_serializer(rule).data)


class TemplateViewSet(ScopedReadViewSet):
    queryset = Template.objects.order_by("name")
    serializer_class = TemplateSerializer

    @extend_schema(request=TemplateSerializer, responses=TemplateSerializer)
    def create(self, request):
        from operations.services import idempotent

        unit = get_unit(request, ["admin"])

        def execute():
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            if Template.objects.filter(
                unit=unit,
                name=serializer.validated_data["name"],
                language=serializer.validated_data.get("language", "pt_BR"),
            ).exists():
                raise ValidationError("Template já cadastrado.")
            obj = serializer.save(unit=unit, approved_for_test=False)
            Audit.objects.create(
                unit=unit, actor=request.user, action="template.created", object_id=str(obj.pk)
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

    @extend_schema(request=TemplateSerializer, responses=TemplateSerializer)
    @action(detail=True, methods=["post"])
    def configure(self, request, pk=None):
        unit = get_unit(request, ["admin"])
        with transaction.atomic():
            template = Template.objects.select_for_update().get(pk=self.get_object().pk)
            if "version" in request.data and request.data["version"] != template.version:
                from operations.services import Conflict

                raise Conflict()
            serializer = self.get_serializer(template, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            content_changed = any(
                key in request.data for key in ["body", "fields", "name", "language", "purpose", "components"]
            )
            template = serializer.save(
                version=template.version + 1, **({"approved_for_test": False} if content_changed else {})
            )
            if content_changed:
                Message.objects.filter(template=template, state__in=["queued", "preview", "blocked"]).update(
                    state="cancelled"
                )
                Rule.objects.filter(template=template).update(version=F("version") + 1)
            Audit.objects.create(
                unit=unit, actor=request.user, action="template.changed", object_id=str(template.pk)
            )
        return Response(self.get_serializer(template).data)


class ImportViewSet(ScopedReadViewSet):
    queryset = ImportRun.objects.select_related("rule").order_by("-started_at")
    serializer_class = ImportRunSerializer

    @extend_schema(request=ImportInput, responses={200: ImportRunSerializer, 202: dict})
    @action(detail=False, methods=["post"])
    def run(self, request):
        unit = get_unit(request, ["admin"])
        rule = (
            Rule.objects.filter(unit=unit, pk=request.data.get("rule_id"))
            .select_related("unit", "template")
            .first()
        )
        if not rule:
            raise ValidationError("Regra não encontrada.")
        if settings.ASYNC_TASKS:
            from scheduling.tasks import run_rule

            try:
                task = run_rule.delay(rule.pk)
            except Exception:
                return Response({"detail": "Fila indisponível; importação não solicitada."}, status=503)
            Audit.objects.create(
                unit=unit, actor=request.user, action="import.queued", object_id=str(rule.pk)
            )
            return Response({"status": "queued", "task_id": task.id}, status=202)
        run = import_rule(rule, OracleSource(unit), retry=True)
        Audit.objects.create(unit=unit, actor=request.user, action="import.requested", object_id=str(rule.pk))
        if run is None:
            return Response({"detail": "Regra fora do dia ou horário previsto."}, status=400)
        return Response(self.get_serializer(run).data)


class AuditViewSet(ScopedReadViewSet):
    queryset = Audit.objects.select_related("actor").order_by("-created_at")
    serializer_class = AuditSerializer


@extend_schema(methods=["GET"], responses=ControlOutput)
@extend_schema(methods=["POST"], request=ControlInput, responses=ControlOutput)
@api_view(["GET", "POST"])
def control(request):
    from core.models import OracleConfiguration
    from scheduling.connectors import OracleSource

    unit = get_unit(request, ["admin"] if request.method == "POST" else None)
    if request.method == "POST":
        with transaction.atomic():
            unit = Unit.objects.select_for_update().get(pk=unit.pk)
            if "paused" in request.data:
                if type(request.data["paused"]) is not bool:
                    raise ValidationError("paused deve ser booleano.")
                unit.paused = request.data["paused"]
            if "response_hours" in request.data:
                hours = request.data["response_hours"]
                if type(hours) is not int or not 1 <= hours <= 168:
                    raise ValidationError("Prazo deve estar entre 1 e 168 horas.")
                unit.response_hours = hours
            unit.save()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="unit.control",
                details={"paused": unit.paused, "response_hours": unit.response_hours},
            )
    return Response(
        {
            "unit": UnitSerializer(unit).data,
            "mode": settings.SEND_MODE,
            "test_recipients": settings.TEST_RECIPIENTS,
            "oracle_configured": OracleConfiguration.objects.filter(unit=unit).exists()
            or all(OracleSource(unit).credentials()),
            "meta_configured": MetaConfiguration.objects.filter(
                unit=unit, waba_id__gt="", phone_number_id__gt="", token_ciphertext__gt=""
            ).exists(),
            "legacy_exclusion": True,
            "production_enabled": False,
        }
    )


@extend_schema(responses=IndicatorsOutput)
@api_view(["GET"])
def indicators(request):
    unit = get_unit(request)
    appointments = date_filter(Appointment.objects.filter(unit=unit), request, "scheduled_at")
    if request.query_params.get("kind"):
        appointments = appointments.filter(kind=request.query_params["kind"])
    messages = Message.objects.filter(appointment__in=appointments)
    states = dict(messages.values("state").annotate(total=Count("id")).values_list("state", "total"))
    responses = dict(
        messages.values("response_state").annotate(total=Count("id")).values_list("response_state", "total")
    )
    accepted_states = ["accepted", "sent", "delivered", "read"]
    delivered = states.get("delivered", 0) + states.get("read", 0)
    trend = []
    today = timezone.localdate()
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        subset = messages.filter(created_at__date=day)
        trend.append(
            {
                "day": day.isoformat(),
                "messages": subset.count(),
                "delivered": subset.filter(state__in=["delivered", "read"]).count(),
            }
        )
    return Response(
        {
            "appointments": appointments.count(),
            "messages": messages.count(),
            "states": states,
            "responses": responses,
            "accepted": sum(states.get(state, 0) for state in accepted_states),
            "delivered": delivered,
            "confirmed": responses.get("confirmed", 0),
            "declined": responses.get("declined", 0),
            "no_response": responses.get("no_response", 0),
            "issues": Issue.objects.filter(unit=unit, resolved_at__isnull=True)
            .exclude(category="no_response")
            .filter(Q(message__in=messages) | Q(message=None))
            .count(),
            "by_kind": list(appointments.values("kind").annotate(total=Count("id"))),
            "trend": trend,
            "synthetic_appointments": appointments.filter(synthetic=True).count(),
            "paused": unit.paused,
        }
    )


@extend_schema(request=TestAppointmentInput, responses={201: MessageSerializer})
@api_view(["POST"])
def test_appointment(request):
    unit = get_unit(request, ["admin", "operator"])
    try:
        phone = normalize_phone(request.data.get("phone", ""))
    except ValueError:
        raise ValidationError("Telefone inválido.") from None
    if phone not in settings.TEST_RECIPIENTS:
        raise ValidationError("Número fora da lista autorizada. Configure TEST_RECIPIENTS no ambiente.")
    kind = request.data.get("kind", "consultation")
    rule = Rule.objects.filter(unit=unit, kind=kind, enabled=True).select_related("unit", "template").first()
    if not rule:
        raise ValidationError("Regra não encontrada para este tipo.")
    now = timezone.now()
    import uuid

    data = AppointmentData(
        external_id="TEST-" + uuid.uuid4().hex[:12],
        kind=kind,
        patient="PACIENTE FICTÍCIO — TESTE",
        phone=phone,
        procedure="PROCEDIMENTO DE TESTE",
        appointment_type="DO SEU AGENDAMENTO DE TESTE",
        scheduled_at=now + timedelta(days=rule.days_before),
        arrival_time="10:00",
        source="synthetic",
        synthetic=True,
    )
    with transaction.atomic():
        appointment = upsert_appointment(unit, data)
        message = queue_appointment(appointment, rule, now)
        Audit.objects.create(unit=unit, actor=request.user, action="test.created", object_id=str(message.pk))
    return Response(MessageSerializer(message).data, status=status.HTTP_201_CREATED)


@extend_schema(request=ProcessTestInput, responses=MessageSerializer)
@api_view(["POST"])
def process_test(request):
    get_unit(request, ["admin", "operator"])
    unit = get_unit(request)
    message = Message.objects.filter(unit=unit, pk=request.data.get("message_id")).first()
    if not message:
        raise ValidationError("Mensagem não encontrada.")
    if not (
        message.appointment.synthetic
        if message.appointment_id
        else message.case and message.case.event.synthetic
    ):
        raise ValidationError("Somente agendamentos sintéticos podem ser processados.")
    dispatch(message.pk)
    mark_no_response()
    message.refresh_from_db()
    Audit.objects.create(unit=unit, actor=request.user, action="test.processed", object_id=str(message.pk))
    return Response(MessageSerializer(message).data)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def webhook(request):
    if request.method == "GET":
        if (
            settings.META_VERIFY_TOKEN
            and request.GET.get("hub.mode") == "subscribe"
            and hmac.compare_digest(request.GET.get("hub.verify_token", ""), settings.META_VERIFY_TOKEN)
        ):
            return HttpResponse(request.GET.get("hub.challenge", ""), content_type="text/plain")
        return JsonResponse({"detail": "Verificação recusada."}, status=403)
    if not settings.META_APP_SECRET:
        return JsonResponse({"detail": "Webhook não configurado."}, status=503)
    signature = (
        "sha256=" + hmac.new(settings.META_APP_SECRET.encode(), request.body, hashlib.sha256).hexdigest()
    )
    if not hmac.compare_digest(request.headers.get("X-Hub-Signature-256", ""), signature):
        return JsonResponse({"detail": "Assinatura inválida."}, status=403)
    try:
        payload = json.loads(request.body)
        ingest_webhook(payload)
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"detail": "Evento inválido."}, status=400)
    return JsonResponse({"ok": True})


@require_http_methods(["GET"])
def health(request):
    from django.db import connection

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        return JsonResponse({"status": "unavailable"}, status=503)
    return JsonResponse({"status": "ok", "mode": settings.SEND_MODE, "database": connection.vendor})
