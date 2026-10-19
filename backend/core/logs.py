"""Read-only operational history, projected from existing unit-scoped records.

Only explicitly selected metadata is returned: never credentials, message bodies,
report contents or unrestricted audit details.
"""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import CharField, DateTimeField, Exists, F, OuterRef, Q, Value
from django.db.models.functions import Cast, Coalesce
from drf_spectacular.utils import extend_schema
from messaging.models import Attempt, Message, ProviderEvent
from operations.models import FlowRun, ReportRequest, SheetImport
from rest_framework import serializers, viewsets
from scheduling.models import ImportRun

from core.models import Audit
from core.permissions import get_unit


class LogFilter(serializers.Serializer):
    category = serializers.ChoiceField(
        choices=["audit", "imports", "messages", "attempts", "flows", "cross", "reports", "events"],
        required=False,
    )
    start = serializers.DateField(required=False)
    end = serializers.DateField(required=False)
    status = serializers.CharField(max_length=80, required=False)
    search = serializers.CharField(max_length=100, required=False)

    def validate(self, data):
        if data.get("start") and data.get("end") and data["end"] < data["start"]:
            raise serializers.ValidationError("O fim do período deve ser posterior ao início.")
        return data


class LogSerializer(serializers.Serializer):
    id = serializers.CharField()
    category = serializers.CharField()
    occurred_at = serializers.DateTimeField()
    status = serializers.CharField()
    title = serializers.CharField()
    reference = serializers.CharField()
    recipient = serializers.CharField()
    provider_id = serializers.CharField()
    actor = serializers.CharField()
    error_code = serializers.CharField()
    count = serializers.IntegerField()
    completed_at = serializers.DateTimeField(allow_null=True)


class LogViewSet(viewsets.GenericViewSet):
    serializer_class = LogSerializer
    http_method_names = ["get", "head", "options"]

    @extend_schema(parameters=[LogFilter], responses=LogSerializer(many=True))
    def list(self, request):
        unit = get_unit(request)
        inputs = LogFilter(data=request.query_params)
        inputs.is_valid(raise_exception=True)
        filters = inputs.validated_data

        def text(value):
            return Value(value, output_field=CharField())

        # kind, model, unit lookup, timestamp, state, title, reference, actor, error, count, completed
        sources = [
            (
                "audit",
                Audit,
                "unit",
                "created_at",
                text("recorded"),
                F("action"),
                F("object_id"),
                Coalesce("actor__username", text("Sistema")),
                text(""),
                Value(0),
                Value(None, output_field=DateTimeField()),
            ),
            (
                "imports",
                ImportRun,
                "unit",
                "started_at",
                F("status"),
                F("rule__name"),
                Cast("rule_id", CharField()),
                text("Sistema"),
                F("error"),
                F("imported"),
                F("completed_at"),
            ),
            (
                "messages",
                Message,
                "unit",
                "updated_at",
                F("state"),
                F("template_name"),
                Cast("pk", CharField()),
                text("Sistema"),
                F("error_code"),
                F("attempt_count"),
                F("delivered_at"),
            ),
            (
                "events",
                ProviderEvent,
                None,
                "occurred_at",
                F("event_type"),
                F("event_type"),
                F("provider_id"),
                text("Meta"),
                text(""),
                Value(0),
                Value(None, output_field=DateTimeField()),
            ),
            (
                "attempts",
                Attempt,
                "message__unit",
                "started_at",
                F("outcome"),
                F("message__template_name"),
                Cast("message_id", CharField()),
                text("Sistema"),
                F("error_code"),
                F("number"),
                F("completed_at"),
            ),
            (
                "flows",
                FlowRun,
                "unit",
                "started_at",
                F("state"),
                F("rule__name"),
                Cast("rule_id", CharField()),
                text("Sistema"),
                F("error_code"),
                F("count"),
                F("completed_at"),
            ),
            (
                "cross",
                SheetImport,
                "unit",
                "created_at",
                F("state"),
                F("layout__name"),
                Cast("pk", CharField()),
                F("created_by__username"),
                text(""),
                F("duplicates"),
                Value(None, output_field=DateTimeField()),
            ),
            (
                "reports",
                ReportRequest,
                "unit",
                "created_at",
                F("state"),
                F("report__name"),
                Cast("pk", CharField()),
                F("requester__username"),
                F("error_code"),
                Value(0),
                F("completed_at"),
            ),
        ]
        queries = []
        for category, model, scope, stamp, state, title, reference, actor, error, count, completed in sources:
            if filters.get("category") and filters["category"] != category:
                continue
            if scope:
                qs = model.objects.filter(**{scope: unit}).order_by()
            else:
                matches = Message.objects.filter(
                    unit=unit, provider_id=OuterRef("provider_id"), channel_id=OuterRef("channel_id")
                )
                qs = ProviderEvent.objects.filter(Exists(matches)).order_by()
            for key, lookup, offset in [("start", "gte", 0), ("end", "lt", 1)]:
                if filters.get(key):
                    boundary = datetime.combine(
                        filters[key] + timedelta(days=offset), time.min, ZoneInfo(unit.timezone)
                    )
                    qs = qs.filter(**{f"{stamp}__{lookup}": boundary})
            # Prefix aliases avoid colliding with fields on source models.
            qs = qs.annotate(
                log_id=Cast("pk", CharField()),
                log_category=text(category),
                log_at=F(stamp),
                log_status=state,
                log_title=title,
                log_reference=reference,
                log_actor=actor,
                log_error=error,
                log_count=count,
                log_completed=completed,
            )
            qs = qs.annotate(
                log_recipient=F("recipient")
                if model is Message
                else F("message__recipient")
                if model is Attempt
                else text(""),
                log_provider=Coalesce("provider_id", text(""))
                if model in (Message, ProviderEvent)
                else Coalesce("message__provider_id", text(""))
                if model is Attempt
                else text(""),
            )
            if filters.get("status"):
                qs = qs.filter(log_status=filters["status"])
            if filters.get("search"):
                term = filters["search"]
                qs = qs.filter(
                    Q(log_title__icontains=term)
                    | Q(log_reference__icontains=term)
                    | Q(log_error__icontains=term)
                    | Q(log_actor__icontains=term)
                    | Q(log_recipient__icontains=term)
                    | Q(log_provider__icontains=term)
                )
            queries.append(
                qs.values_list(
                    "log_id",
                    "log_category",
                    "log_at",
                    "log_status",
                    "log_title",
                    "log_reference",
                    "log_actor",
                    "log_error",
                    "log_count",
                    "log_completed",
                    "log_recipient",
                    "log_provider",
                )
            )
        rows = queries[0].union(*queries[1:], all=True).order_by("-log_at", "log_category", "log_id")
        page = self.paginate_queryset(rows)
        keys = [
            "id",
            "category",
            "occurred_at",
            "status",
            "title",
            "reference",
            "actor",
            "error_code",
            "count",
            "completed_at",
            "recipient",
            "provider_id",
        ]
        return self.get_paginated_response(
            self.get_serializer([dict(zip(keys, row)) for row in page], many=True).data
        )
