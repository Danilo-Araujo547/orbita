"""Unified read model: appointments and CROSS records retain their original storage."""

from django.db.models import F, Q
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core.permissions import get_unit
from core.serializers import (
    AppointmentCommunicationsSerializer,
    AppointmentSerializer,
    MessageSerializer,
)
from operations.models import Campaign, Case, Purpose
from operations.serializers import InteractionSerializer
from scheduling.models import Appointment

PATIENT_PURPOSES = [
    "appointment",
    "waitlist",
    "summons",
    "postoperative",
    "absence",
    "movement",
]


class AgendaTypeSerializer(serializers.Serializer):
    value = serializers.CharField()
    label = serializers.CharField()
    group = serializers.CharField()


class AgendaItemSerializer(AppointmentSerializer):
    id = serializers.CharField(read_only=True)
    record_type = serializers.CharField(read_only=True)
    purpose = serializers.CharField(read_only=True)
    kind_label = serializers.CharField(read_only=True)

    class Meta(AppointmentSerializer.Meta):
        fields = (
            *AppointmentSerializer.Meta.fields,
            "record_type",
            "purpose",
            "kind_label",
        )

    def to_representation(self, case):
        event = case.event
        if event.appointment_id:
            result = dict(
                AppointmentSerializer(event.appointment, context=self.context).data
            )
            return {
                **result,
                "id": str(result["id"]),
                "record_type": "appointment",
                "purpose": "appointment",
                "kind_label": event.appointment.get_kind_display(),
            }
        messages = [
            m for m in case.messages.all() if m.appointment_revision == event.revision
        ]
        interactions = sorted(
            case.interactions.all(), key=lambda i: (i.occurred_at, i.pk), reverse=True
        )
        decisions = {}
        for item in interactions:
            if (
                item.kind == "classification"
                and not item.data.get("historical")
                and item.data.get("revision", event.revision) == event.revision
            ):
                decisions.setdefault(item.data.get("phone", ""), item.outcome)
        saved_contacts = list(event.contact_set.all())
        phones = list(
            dict.fromkeys(
                [c.phone for c in saved_contacts]
                + ([event.phone] if event.phone else [])
                + [m.recipient for m in messages]
            )
        )
        contacts = []
        for phone in phones:
            contact = next((c for c in saved_contacts if c.phone == phone), None)
            deliveries = sorted(
                (m for m in messages if m.recipient == phone),
                key=lambda m: (m.created_at, str(m.pk)),
                reverse=True,
            )
            latest = deliveries[0] if deliveries else None
            response = next(
                (
                    m.response_state
                    for m in deliveries
                    if m.response_state
                    not in {"pending", "no_response", "not_requested"}
                ),
                latest.response_state if latest else "pending",
            )
            contacts.append(
                {
                    "phone": phone,
                    "delivery": latest.state if latest else "not_queued",
                    "response": decisions.get(phone, response),
                    "status": contact.status if contact else "unverified",
                    "opted_out": contact.opted_out if contact else False,
                }
            )
        awaiting = [
            m.delivered_at
            for m in messages
            if m.delivered_at and m.response_state == "pending"
        ]
        data = event.data
        return {
            "id": f"cross-{case.pk}",
            "record_type": "cross",
            "purpose": case.purpose,
            "kind": case.purpose,
            "kind_label": case.get_purpose_display(),
            "external_id": event.external_id,
            "patient": event.patient,
            "phone": event.phone,
            "phone_numbers": phones,
            "patient_external_id": data.get("patient_external_id", ""),
            "professional": data.get("professional", ""),
            "city": data.get("city", ""),
            "procedure": data.get("procedure") or case.get_purpose_display(),
            "scheduled_at": event.occurred_at.isoformat(),
            "arrival_time": data.get("arrival_time", ""),
            "source": event.source,
            "synthetic": event.synthetic,
            "revision": event.revision,
            "tracking": {
                "id": str(case.pk),
                "version": case.version,
                "outcome": case.outcome,
                "response": case.response_state,
                "awaiting_since": min(awaiting).isoformat()
                if awaiting and case.response_state == "pending"
                else None,
                "contacts": contacts,
                "messages": len(messages),
                "corrections": sum(
                    i.resolved_at is None and i.category != "no_response"
                    for i in case.corrections.all()
                ),
                "observations": sum(i.kind in {"note", "call"} for i in interactions),
            },
        }


class AgendaViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AgendaItemSerializer
    queryset = Case.objects.none()

    def get_queryset(self):
        from core.views import date_filter

        unit = get_unit(self.request)
        qs = (
            Case.objects.filter(
                unit=unit, event__unit=unit, purpose__in=PATIENT_PURPOSES
            )
            .filter(
                Q(event__appointment__isnull=True)
                | Q(purpose="appointment", event__appointment__unit=unit)
            )
            .select_related(
                "event", "event__appointment", "event__appointment__sourceevent"
            )
            .prefetch_related(
                "messages",
                "interactions",
                "corrections",
                "event__contact_set",
                "event__appointment__messages",
                "event__appointment__sourceevent__contact_set",
                "event__appointment__sourceevent__cases__interactions",
                "event__appointment__sourceevent__cases__corrections",
            )
            .annotate(
                agenda_date=Coalesce(
                    "event__appointment__scheduled_at", "event__occurred_at"
                )
            )
        )
        params = self.request.query_params
        basis = params.get("date_basis", "appointment")
        field = {
            "appointment": "agenda_date",
            "send": "messages__scheduled_for",
            "reply": "messages__replies__event__occurred_at",
        }.get(basis)
        if field is None:
            raise ValidationError("Período inválido.")
        qs = date_filter(qs, self.request, field)
        if params.get("group"):
            from messaging.models import AppointmentGroup

            group_id = serializers.UUIDField().run_validation(params["group"])
            group = get_object_or_404(AppointmentGroup, pk=group_id, unit=unit)
            qs = qs.filter(
                messages__group=group,
                messages__appointment_revision=F("event__revision"),
            )
        kind = params.get("kind", "")
        if kind:
            if kind.startswith("cross:") and kind[6:] in PATIENT_PURPOSES:
                qs = qs.filter(event__appointment__isnull=True, purpose=kind[6:])
            elif kind in dict(Appointment.Kind.choices):
                qs = qs.filter(purpose="appointment", event__appointment__kind=kind)
            else:
                raise ValidationError("Tipo de agendamento inválido.")
        if params.get("operational_pending") == "true":
            qs = qs.exclude(outcome="confirmed").filter(
                Q(
                    outcome__in=[
                        "declined",
                        "review",
                        "wrong_person",
                        "opt_out",
                        "needs_attention",
                    ]
                )
                | Q(response_state="no_response")
                | Q(corrections__resolved_at__isnull=True, corrections__isnull=False)
                | Q(
                    messages__appointment_revision=F("event__revision"),
                    messages__state__in=["failed", "blocked", "uncertain"],
                )
                | Q(event__contact__status__in=["invalid", "wrong_person"])
                | Q(event__contact__opted_out=True)
            )
        for key, field in {"outcome": "outcome", "response": "response_state"}.items():
            if params.get(key):
                qs = qs.filter(**{field: params[key]})
        if params.get("delivery"):
            qs = qs.filter(
                messages__state=params["delivery"],
                messages__appointment_revision=F("event__revision"),
            )
        if params.get("corrections") == "true":
            qs = qs.filter(
                corrections__resolved_at__isnull=True, corrections__isnull=False
            )
        if params.get("observations") == "true":
            qs = qs.filter(interactions__kind__in=["note", "call"])
        elif params.get("observations") == "false":
            qs = qs.exclude(interactions__kind__in=["note", "call"])
        professional = params.get("professional", "").strip()
        if professional:
            qs = qs.filter(
                Q(event__appointment__professional__iexact=professional)
                | Q(event__data__professional__iexact=professional)
            )
        specialty = params.get("specialty", "").strip()
        if specialty:
            qs = qs.filter(
                Q(event__appointment__procedure__icontains=specialty)
                | Q(event__data__procedure__icontains=specialty)
                | Q(event__data__specialty__icontains=specialty)
            )
        status_filter = params.get("status_filter", "")
        if status_filter:
            if status_filter == "corrections":
                qs = qs.filter(
                    corrections__resolved_at__isnull=True, corrections__isnull=False
                )
            elif status_filter == "observations":
                qs = qs.filter(interactions__kind__in=["note", "call"])
            elif status_filter == "no_observations":
                qs = qs.exclude(interactions__kind__in=["note", "call"])
            elif status_filter in [
                "preview",
                "queued",
                "accepted",
                "delivered",
                "read",
                "failed",
                "uncertain",
                "blocked",
            ]:
                qs = qs.filter(
                    messages__state=status_filter,
                    messages__appointment_revision=F("event__revision"),
                )
        search = params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(event__patient__icontains=search)
                | Q(event__external_id__icontains=search)
                | Q(event__phone__icontains=search)
                | Q(event__contact__phone__icontains=search)
                | Q(event__appointment__patient_external_id__icontains=search)
                | Q(event__data__patient_external_id__icontains=search)
                | Q(event__appointment__professional__icontains=search)
                | Q(event__data__professional__icontains=search)
                | Q(event__appointment__procedure__icontains=search)
                | Q(event__data__procedure__icontains=search)
                | Q(messages__recipient__icontains=search)
            )
        return qs.distinct().order_by("agenda_date", "pk")

    @extend_schema(parameters=[OpenApiParameter("id", str, OpenApiParameter.PATH)])
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(
        parameters=[
            OpenApiParameter("unit", str),
            OpenApiParameter("kind", str),
            OpenApiParameter("start", OpenApiTypes.DATE),
            OpenApiParameter("end", OpenApiTypes.DATE),
            OpenApiParameter("date_basis", str, enum=["appointment", "send", "reply"]),
            OpenApiParameter("search", str),
            OpenApiParameter("response", str),
            OpenApiParameter("outcome", str),
            OpenApiParameter("delivery", str),
            OpenApiParameter("observations", bool),
            OpenApiParameter("corrections", bool),
            OpenApiParameter("operational_pending", bool),
            OpenApiParameter("group", OpenApiTypes.UUID),
        ]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_object(self):
        identifier = self.kwargs["pk"]
        if identifier.startswith("cross-"):
            pk = serializers.UUIDField().run_validation(identifier[6:])
            obj = get_object_or_404(
                self.get_queryset(), pk=pk, event__appointment__isnull=True
            )
        elif identifier.isdigit():
            obj = get_object_or_404(
                self.get_queryset(),
                event__appointment_id=int(identifier),
                purpose="appointment",
            )
        else:
            raise ValidationError("Registro inválido.")
        self.check_object_permissions(self.request, obj)
        return obj

    @extend_schema(responses=AgendaTypeSerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def types(self, request):
        unit = get_unit(request)
        registered = set(
            Campaign.objects.filter(unit=unit).values_list("purpose", flat=True)
        )
        registered.update(
            Case.objects.filter(
                unit=unit, event__unit=unit, event__appointment__isnull=True
            ).values_list("purpose", flat=True)
        )
        result = [
            {"value": value, "label": label, "group": "Agendamentos"}
            for value, label in Appointment.Kind.choices
        ]
        result.extend(
            {"value": f"cross:{purpose}", "label": label, "group": "Importa CROSS"}
            for purpose, label in Purpose.choices
            if purpose in registered and purpose in PATIENT_PURPOSES
        )
        return Response(result)

    @action(detail=False, methods=["get"], pagination_class=None)
    def filter_options(self, request):
        unit = get_unit(request)
        appt_profs = list(
            Appointment.objects.filter(unit=unit)
            .exclude(professional="")
            .values_list("professional", flat=True)
            .distinct()[:200]
        )
        cross_profs = list(
            Case.objects.filter(
                unit=unit, event__unit=unit, event__appointment__isnull=True
            )
            .values_list("event__data__professional", flat=True)
            .distinct()[:200]
        )
        profs = sorted(set(p.strip() for p in (appt_profs + cross_profs) if p and p.strip()))

        appt_specs = list(
            Appointment.objects.filter(unit=unit)
            .exclude(procedure="")
            .values_list("procedure", flat=True)
            .distinct()[:200]
        )
        cross_specs = list(
            Case.objects.filter(
                unit=unit, event__unit=unit, event__appointment__isnull=True
            )
            .values_list("event__data__procedure", flat=True)
            .distinct()[:200]
        )
        specs = sorted(set(s.strip() for s in (appt_specs + cross_specs) if s and s.strip()))

        return Response({
            "professionals": profs,
            "specialties": specs,
        })

    @extend_schema(
        responses=AppointmentCommunicationsSerializer,
        parameters=[OpenApiParameter("id", str, OpenApiParameter.PATH)],
    )
    @action(detail=True, methods=["get"])
    def communications(self, request, pk=None):
        case = self.get_object()
        messages = (
            case.messages.filter(unit=case.unit)
            .select_related("appointment", "case__event", "rule", "template")
            .prefetch_related("attempts", "replies__event")
            .order_by("-created_at", "pk")
        )
        if request.query_params.get("group"):
            messages = messages.filter(group_id=request.query_params["group"])
        page = self.paginate_queryset(messages)
        response = self.get_paginated_response(MessageSerializer(page, many=True).data)
        response.data["manual_responses"] = InteractionSerializer(
            case.interactions.filter(kind="classification", actor__isnull=False)
            .select_related("actor")
            .order_by("-occurred_at", "-pk")[:100],
            many=True,
        ).data
        return response

    @action(detail=False, methods=["get"])
    def export(self, request):
        import csv

        qs = self.get_queryset()
        if qs.count() > 10000:
            raise ValidationError(
                "Restrinja os filtros para exportar até 10.000 registros."
            )
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="agendamentos.csv"'
        response["Cache-Control"] = "no-store"
        response.write("\ufeff")
        writer = csv.writer(response)
        writer.writerow(
            [
                "Código",
                "Paciente",
                "Contatos",
                "Tipo",
                "Procedimento",
                "Data",
                "Resposta",
            ]
        )
        for case in qs:
            row = self.get_serializer(case).data
            values = [
                row["external_id"],
                row["patient"],
                "; ".join(row["phone_numbers"]),
                row["kind_label"],
                row["procedure"],
                row["scheduled_at"],
                row["tracking"]["outcome"],
            ]
            writer.writerow(
                [
                    "'" + str(v) if str(v).startswith(("=", "+", "-", "@")) else v
                    for v in values
                ]
            )
        return response
