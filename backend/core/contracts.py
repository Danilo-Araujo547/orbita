from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from scheduling.models import Appointment

from core.serializers import UnitSerializer


class CsrfOutput(serializers.Serializer):
    csrfToken = serializers.CharField()


class AckOutput(serializers.Serializer):
    ok = serializers.BooleanField()


@extend_schema_field({"oneOf": [{"type": "integer"}, {"type": "string"}]})
class SessionUnitId(serializers.CharField):
    pass


class SessionUnitOutput(UnitSerializer):
    id = SessionUnitId()
    remote = serializers.BooleanField(required=False)
    instance_id = serializers.UUIDField(required=False)
    instance_name = serializers.CharField(required=False)
    origin_unit = serializers.CharField(required=False)
    connection_state = serializers.CharField(required=False)
    permissions = serializers.DictField(child=serializers.CharField(), required=False)

    class Meta(UnitSerializer.Meta):
        fields = UnitSerializer.Meta.fields + [
            "remote",
            "instance_id",
            "instance_name",
            "origin_unit",
            "connection_state",
            "permissions",
        ]


class SessionOutput(serializers.Serializer):
    username = serializers.CharField()
    units = SessionUnitOutput(many=True)
    roles = serializers.DictField(child=serializers.CharField())
    permissions = serializers.DictField(child=serializers.DictField(child=serializers.CharField()))
    mode = serializers.CharField()


class ControlInput(serializers.Serializer):
    paused = serializers.BooleanField(required=False)
    response_hours = serializers.IntegerField(min_value=1, max_value=168, required=False)


class ControlOutput(serializers.Serializer):
    appointment_source = serializers.CharField()
    unit = UnitSerializer()
    mode = serializers.CharField()
    test_recipients = serializers.ListField(child=serializers.CharField())
    oracle_configured = serializers.BooleanField()
    meta_configured = serializers.BooleanField()
    production_enabled = serializers.BooleanField()
    legacy_exclusion = serializers.BooleanField()


class IndicatorsOutput(serializers.Serializer):
    appointments = serializers.IntegerField()
    messages = serializers.IntegerField()
    accepted = serializers.IntegerField()
    delivered = serializers.IntegerField()
    confirmed = serializers.IntegerField()
    declined = serializers.IntegerField()
    no_response = serializers.IntegerField()
    issues = serializers.IntegerField()
    synthetic_appointments = serializers.IntegerField()
    states = serializers.DictField(child=serializers.IntegerField())
    responses = serializers.DictField(child=serializers.IntegerField())
    by_kind = serializers.ListField(child=serializers.DictField())
    trend = serializers.ListField(child=serializers.DictField())
    paused = serializers.BooleanField()


class TestAppointmentInput(serializers.Serializer):
    phone = serializers.CharField()
    kind = serializers.ChoiceField(choices=Appointment.Kind.choices, default="consultation")


class ProcessTestInput(serializers.Serializer):
    message_id = serializers.UUIDField()


class SimulateInput(serializers.Serializer):
    event = serializers.ChoiceField(choices=["sent", "delivered", "read", "confirmed", "declined", "review"])


class ResolveInput(serializers.Serializer):
    resolution = serializers.CharField(min_length=5, max_length=4000)
    classification = serializers.ChoiceField(
        choices=[
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
        ],
        required=False,
    )
    message_id = serializers.UUIDField(required=False)


class ImportInput(serializers.Serializer):
    rule_id = serializers.IntegerField()
