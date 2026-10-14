from rest_framework import serializers

from operations import models


class ScopedSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        unit = self.context.get("unit")
        for value in attrs.values():
            for item in value if isinstance(value, list) else [value]:
                if hasattr(item, "unit_id") and unit and item.unit_id != unit.id:
                    raise serializers.ValidationError("Referência de outra unidade.")
        return attrs


class EventSerializer(ScopedSerializer):
    class Meta:
        model = models.SourceEvent
        fields = "__all__"
        read_only_fields = ["unit", "revision", "appointment", "synthetic"]


class InteractionSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.username", default="Sistema", read_only=True)

    class Meta:
        model = models.Interaction
        fields = "__all__"


class CaseSerializer(serializers.ModelSerializer):
    event = EventSerializer(read_only=True)
    assignee_name = serializers.CharField(source="assignee.username", default="", read_only=True)
    purpose_label = serializers.CharField(source="get_purpose_display", read_only=True)
    state_label = serializers.CharField(source="get_state_display", read_only=True)

    class Meta:
        model = models.Case
        fields = "__all__"


def model_serializer(model, readonly=()):
    return type(
        f"{model.__name__}Serializer",
        (ScopedSerializer,),
        {
            "Meta": type(
                "Meta",
                (),
                {"model": model, "fields": "__all__", "read_only_fields": ["unit", "created_at", *readonly]},
            )
        },
    )


ContactSerializer = model_serializer(models.Contact, ["version"])
MovementSerializer = model_serializer(
    models.Movement,
    ["before", "final", "state", "evidence", "created_by", "confirmed_by", "confirmed_at", "version"],
)
PreparationSerializer = model_serializer(models.Preparation, ["version"])
LayoutSerializer = model_serializer(models.ImportLayout, ["version"])
PolicySerializer = model_serializer(models.PurposePolicy, ["version"])
CampaignSerializer = model_serializer(models.Campaign, ["state", "version"])
ReportSerializer = model_serializer(models.ReportDefinition, ["version"])


class ReportAccessSerializer(model_serializer(models.ReportAccess, ["verified_at", "version"])):
    def validate_phone(self, value):
        from scheduling.connectors import normalize_phone

        try:
            return normalize_phone(value)
        except ValueError:
            raise serializers.ValidationError("Número inválido.") from None


ReportScheduleSerializer = model_serializer(models.ReportSchedule, ["last_run_date", "version"])
SourceConfigurationSerializer = model_serializer(models.SourceConfiguration, ["version"])
FlowRuleSerializer = model_serializer(models.FlowRule, ["version"])
FlowRunSerializer = model_serializer(models.FlowRun)


class SheetSerializer(serializers.ModelSerializer):
    row_count = serializers.SerializerMethodField()

    def get_row_count(self, obj) -> int:
        return len(obj.rows)

    class Meta:
        model = models.SheetImport
        fields = ["id", "layout", "state", "row_count", "errors", "duplicates", "created_at"]


class ReportRequestSerializer(serializers.ModelSerializer):
    report_name = serializers.CharField(source="report.name", read_only=True)

    class Meta:
        model = models.ReportRequest
        exclude = ["result"]
        read_only_fields = [
            "unit",
            "requester",
            "access",
            "definition_version",
            "state",
            "delivery_state",
            "error_code",
            "completed_at",
        ]


class CaseActionInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=["note", "call", "classify", "record_response"])
    text = serializers.CharField(min_length=3, max_length=4000)
    assignee = serializers.IntegerField(required=False)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    outcome = serializers.CharField(max_length=40, required=False)
    interlocutor = serializers.CharField(max_length=200, required=False, allow_blank=True)
    call_result = serializers.ChoiceField(choices=["answered", "not_answered"], required=False)
    priority = serializers.ChoiceField(choices=["normal", "high"], required=False)
    channel = serializers.ChoiceField(choices=["phone", "whatsapp"], required=False)
    occurred_at = serializers.DateTimeField(required=False)
    message_id = serializers.UUIDField(required=False)


class VersionInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class MovementConfirmInput(VersionInput):
    evidence = serializers.CharField(min_length=5, max_length=4000)
    final = serializers.JSONField(required=False, default=dict)


class SheetPreviewInput(serializers.Serializer):
    layout = serializers.IntegerField()
    filename = serializers.CharField(max_length=200)
    content_base64 = serializers.CharField(max_length=7 * 1024 * 1024)


class SheetConfirmInput(serializers.Serializer):
    purpose = serializers.ChoiceField(choices=["waitlist", "summons"])


class ReportInput(serializers.Serializer):
    report = serializers.IntegerField()
    parameters = serializers.JSONField(default=dict)
    format = serializers.ChoiceField(choices=["csv", "pdf", "text"], default="csv")
