from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from core.models import Audit
from core.permissions import get_unit
from django.db.models import Count, F, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from operations.services import Conflict, idempotent
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from messaging.models import AppointmentGroup

SENT = ["accepted", "sent", "delivered", "read"]
EDITABLE = ["preview", "queued", "blocked"]


class GroupSerializer(serializers.ModelSerializer):
    rule_name = serializers.CharField(source="rule.name", read_only=True)
    appointments_total = serializers.IntegerField(read_only=True)
    appointments_sent = serializers.IntegerField(read_only=True)
    messages_total = serializers.IntegerField(read_only=True)
    messages_sent = serializers.IntegerField(read_only=True)
    messages_delivered = serializers.IntegerField(read_only=True)
    messages_pending = serializers.IntegerField(read_only=True)
    paused = serializers.BooleanField(source="unit.paused", read_only=True)

    class Meta:
        model = AppointmentGroup
        fields = [
            "id",
            "kind",
            "appointment_date",
            "rule_name",
            "rule_version",
            "scheduled_for",
            "delay_seconds",
            "version",
            "appointments_total",
            "appointments_sent",
            "messages_total",
            "messages_sent",
            "messages_delivered",
            "messages_pending",
            "paused",
        ]


class GroupScheduleInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    scheduled_for = serializers.DateTimeField()
    delay_seconds = serializers.IntegerField(min_value=0, max_value=3600)


class AppointmentGroupViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AppointmentGroup.objects.none()
    serializer_class = GroupSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        unit = get_unit(self.request)
        current = Q(messages__appointment_revision=F("messages__appointment__revision"))
        sent = current & Q(messages__state__in=SENT)
        qs = (
            AppointmentGroup.objects.filter(unit=unit)
            .select_related("rule", "unit")
            .annotate(
                appointments_total=Count("messages__appointment", distinct=True, filter=current),
                appointments_sent=Count("messages__appointment", distinct=True, filter=sent),
                messages_total=Count("messages", distinct=True, filter=current),
                messages_sent=Count("messages", distinct=True, filter=sent),
                messages_delivered=Count(
                    "messages", distinct=True, filter=current & Q(messages__state__in=["delivered", "read"])
                ),
                messages_pending=Count(
                    "messages", distinct=True, filter=current & Q(messages__state__in=EDITABLE)
                ),
            )
        )
        if self.action == "list":
            qs = qs.filter(appointments_total__gt=0)
        for key, field in (
            ("kind", "kind"),
            ("start", "appointment_date__gte"),
            ("end", "appointment_date__lte"),
        ):
            value = self.request.query_params.get(key)
            if value:
                if key in {"start", "end"}:
                    try:
                        value = datetime.strptime(value, "%Y-%m-%d").date()
                    except ValueError:
                        raise ValidationError("Data de filtro inválida.") from None
                qs = qs.filter(**{field: value})
        return qs.order_by("appointment_date", "scheduled_for", "id")

    @extend_schema(request=GroupScheduleInput, responses=GroupSerializer)
    @action(detail=True, methods=["post"])
    def schedule(self, request, pk=None):
        unit = get_unit(request, ["admin"])
        values = GroupScheduleInput(data=request.data)
        values.is_valid(raise_exception=True)
        data = values.validated_data
        # Scoped lookup also handles foreign units consistently with the detail endpoint.
        self.get_object()

        def execute():
            group = AppointmentGroup.objects.select_for_update().get(pk=pk, unit=unit)
            if group.version != data["version"]:
                raise Conflict()
            stamp = data["scheduled_for"]
            if stamp <= timezone.now():
                raise ValidationError("Escolha uma data e hora de envio futuras.")
            messages = list(
                group.messages.select_related("appointment").filter(
                    appointment_revision=F("appointment__revision"),
                    state__in=EDITABLE,
                )
            )
            limit = min((m.appointment.scheduled_at for m in messages), default=None)
            local = stamp.astimezone(ZoneInfo(unit.timezone))
            if local.date() > group.appointment_date or (limit and stamp >= limit):
                raise ValidationError("O envio precisa ocorrer antes do atendimento.")
            before = {"scheduled_for": group.scheduled_for.isoformat(), "delay_seconds": group.delay_seconds}
            group.scheduled_for = stamp
            group.delay_seconds = data["delay_seconds"]
            group.schedule_overridden = True
            group.version += 1
            # Preserve the existing cooldown: editing a schedule cannot bypass an in-flight send.
            group.save()
            day_end = datetime.combine(local.date() + timedelta(days=1), time.min, ZoneInfo(unit.timezone))
            for message in messages:
                message.scheduled_for = stamp
                message.expires_at = min(
                    day_end,
                    stamp + timedelta(hours=message.snapshot.get("validity_hours", 24)),
                    message.appointment.scheduled_at,
                )
                message.save(update_fields=["scheduled_for", "expires_at"])
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="appointment_group.scheduled",
                object_id=str(group.pk),
                details={
                    "before": before,
                    "after": {
                        "scheduled_for": stamp.isoformat(),
                        "delay_seconds": group.delay_seconds,
                        "version": group.version,
                    },
                    "pending_messages_updated": len(messages),
                },
            )
            return dict(self.get_serializer(self.get_queryset().get(pk=group.pk)).data)

        result = idempotent(
            unit,
            request.user,
            request.headers.get("Idempotency-Key"),
            {"path": request.path, "data": request.data},
            execute,
        )
        return Response(result)
