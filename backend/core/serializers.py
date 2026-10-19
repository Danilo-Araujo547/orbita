import re

from messaging.models import Attempt, Message, Template
from responses.models import Issue, Reply
from rest_framework import serializers
from scheduling.models import Appointment, ImportRun, Rule

from core.models import Audit, Unit


class UnitSerializer(serializers.ModelSerializer):
    effective_recipients = serializers.SerializerMethodField()

    def get_effective_recipients(self, obj) -> list[str]:
        from messaging.pilot import authorized_recipients

        return list(authorized_recipients(obj))

    def validate_authorized_recipients(self, value):
        from scheduling.connectors import normalize_phone

        if value is None:
            return None
        if (
            not isinstance(value, list)
            or len(value) > 200
            or any(not isinstance(phone, str) for phone in value)
        ):
            raise serializers.ValidationError("Informe uma lista de até 200 telefones.")
        try:
            return sorted(set(normalize_phone(phone) for phone in value))
        except ValueError:
            raise serializers.ValidationError("Telefone inválido na lista autorizada.") from None

    class Meta:
        model = Unit
        fields = [
            "id",
            "slug",
            "name",
            "timezone",
            "paused",
            "response_hours",
            "version",
            "authorized_recipients",
            "effective_recipients",
        ]
        read_only_fields = ["version"]


class AppointmentSerializer(serializers.ModelSerializer):
    tracking = serializers.SerializerMethodField()

    def get_tracking(self, obj) -> dict:
        event = getattr(obj, "sourceevent", None)
        case = next((c for c in event.cases.all() if c.purpose == "appointment"), None) if event else None
        messages = list(obj.messages.all())
        current = [m for m in messages if m.appointment_revision == obj.revision]
        phones = obj.phone_numbers or [obj.phone]
        actions = (
            sorted(case.interactions.all(), key=lambda i: (i.occurred_at, i.pk), reverse=True) if case else []
        )
        decisions = {}
        for item in actions:
            if (
                item.kind == "classification"
                and not item.data.get("historical")
                and item.data.get("revision", obj.revision) == obj.revision
            ):
                decisions.setdefault(item.data.get("phone", ""), item.outcome)
        contact_info = {c.phone: c for c in event.contact_set.all()} if event else {}

        contacts = []
        for phone in phones:
            deliveries = sorted(
                (m for m in current if m.recipient == phone), key=lambda m: m.created_at, reverse=True
            )
            latest = deliveries[0] if deliveries else None
            response = next(
                (
                    m.response_state
                    for m in deliveries
                    if m.response_state not in {"pending", "no_response", "not_requested"}
                ),
                latest.response_state if latest else "pending",
            )
            contacts.append(
                {
                    "phone": phone,
                    "delivery": latest.state if latest else "not_queued",
                    "response": decisions.get(phone, response),
                    "status": contact_info[phone].status if phone in contact_info else "unverified",
                    "opted_out": contact_info[phone].opted_out if phone in contact_info else False,
                }
            )
        return {
            "id": str(case.pk) if case else None,
            "version": case.version if case else None,
            "outcome": case.outcome if case else "",
            "response": case.response_state if case else "pending",
            "awaiting_since": min(
                (m.delivered_at for m in current if m.delivered_at and m.response_state == "pending"),
                default=None,
            ).isoformat()
            if any(m.delivered_at and m.response_state == "pending" for m in current)
            and (not case or case.response_state == "pending")
            else None,
            "contacts": contacts,
            "messages": len(current),
            "corrections": sum(
                1
                for issue in case.corrections.all()
                if issue.resolved_at is None and issue.category != "no_response"
            )
            if case
            else 0,
            "observations": sum(1 for i in case.interactions.all() if i.kind in {"note", "call"})
            if case
            else 0,
        }

    class Meta:
        model = Appointment
        fields = [
            "id",
            "external_id",
            "kind",
            "patient",
            "phone",
            "phone_numbers",
            "patient_record",
            "patient_external_id",
            "professional",
            "city",
            "tracking",
            "procedure",
            "procedure_code",
            "appointment_type",
            "scheduled_at",
            "arrival_time",
            "status",
            "synthetic",
            "revision",
            "source",
            "last_seen_at",
            "data_issue",
        ]


class AttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attempt
        fields = ["id", "number", "outcome", "error_code", "started_at", "completed_at"]


class MessageSerializer(serializers.ModelSerializer):
    sender_phone = serializers.SerializerMethodField()
    sent_at = serializers.DateTimeField(source="last_attempt_at", read_only=True)
    responses = serializers.SerializerMethodField()

    def get_sender_phone(self, obj) -> str:
        return obj.snapshot.get("sender_phone", "")

    def get_responses(self, obj) -> list[dict]:
        return [
            {
                "id": r.pk,
                "text": r.text,
                "classification": r.classification,
                "occurred_at": r.event.occurred_at.isoformat(),
                "sender": r.sender,
                "responded_by": r.event.data.get("sender_name", ""),
                "channel": "whatsapp",
            }
            for r in obj.replies.all()
        ]

    patient = serializers.SerializerMethodField()
    kind = serializers.SerializerMethodField()
    procedure = serializers.SerializerMethodField()
    appointment_at = serializers.SerializerMethodField()
    synthetic = serializers.SerializerMethodField()
    rule_name = serializers.CharField(source="rule.name", default="Campanha", read_only=True)
    attempts = AttemptSerializer(many=True, read_only=True)

    def get_patient(self, obj) -> str:
        return (
            obj.appointment.patient if obj.appointment_id else obj.case.event.patient if obj.case_id else ""
        )

    def get_synthetic(self, obj) -> bool:
        return (
            obj.appointment.synthetic
            if obj.appointment_id
            else bool(obj.case_id and obj.case.event.synthetic)
        )

    def get_kind(self, obj) -> str:
        return obj.appointment.kind if obj.appointment_id else obj.case.event.kind if obj.case_id else ""

    def get_procedure(self, obj) -> str:
        return (
            obj.appointment.procedure
            if obj.appointment_id
            else obj.case.event.data.get("procedure", "")
            if obj.case_id
            else ""
        )

    def get_appointment_at(self, obj) -> str:
        return (
            obj.appointment.scheduled_at
            if obj.appointment_id
            else obj.case.event.occurred_at
            if obj.case_id
            else obj.scheduled_for
        ).isoformat()

    class Meta:
        model = Message
        fields = [
            "id",
            "appointment",
            "case",
            "purpose",
            "snapshot",
            "sender_phone",
            "sent_at",
            "responses",
            "patient",
            "kind",
            "procedure",
            "appointment_at",
            "synthetic",
            "rule_name",
            "recipient",
            "template_name",
            "template_language",
            "parameters",
            "body",
            "state",
            "response_state",
            "scheduled_for",
            "expires_at",
            "delivered_at",
            "attempt_count",
            "error_code",
            "provider_id",
            "channel_id",
            "created_at",
            "attempts",
        ]


class AppointmentCommunicationsSerializer(serializers.Serializer):
    from operations.serializers import InteractionSerializer

    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = MessageSerializer(many=True)
    manual_responses = InteractionSerializer(many=True)


class ReplySerializer(serializers.ModelSerializer):
    occurred_at = serializers.DateTimeField(source="event.occurred_at", read_only=True)
    patient = serializers.SerializerMethodField()

    def get_patient(self, obj) -> str:
        return MessageSerializer().get_patient(obj.message) if obj.message_id else "Sem vínculo"

    class Meta:
        model = Reply
        fields = ["id", "message", "sender", "text", "classification", "patient", "occurred_at", "created_at"]


class IssueSerializer(serializers.ModelSerializer):
    appointment = serializers.IntegerField(source="message.appointment_id", default=None, read_only=True)
    sender = serializers.CharField(source="reply.sender", default="", read_only=True)
    patient = serializers.SerializerMethodField()

    def get_patient(self, obj) -> str:
        return MessageSerializer().get_patient(obj.message) if obj.message_id else "Sem vínculo"

    reply_text = serializers.CharField(source="reply.text", default="", read_only=True)

    class Meta:
        model = Issue
        fields = [
            "id",
            "message",
            "case",
            "contact_phone",
            "appointment",
            "reply",
            "sender",
            "patient",
            "reply_text",
            "category",
            "description",
            "resolution",
            "resolved_at",
            "created_at",
        ]


class TemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Template
        fields = [
            "id",
            "name",
            "language",
            "body",
            "fields",
            "approved_for_test",
            "purpose",
            "components",
            "version",
        ]
        read_only_fields = ["version"]

    def validate(self, attrs):
        fields = attrs.get("fields", self.instance.fields if self.instance else [])
        body = attrs.get("body", self.instance.body if self.instance else "")
        allowed = {
            "patient",
            "appointment_type",
            "procedure",
            "date",
            "arrival_time",
            "protocol",
            "surgery",
            "professional",
            "preparation",
            "report_name",
        }
        if not isinstance(fields, list) or not fields or any(field not in allowed for field in fields):
            raise serializers.ValidationError("Mapa de variáveis inválido.")
        markers = {int(value) for value in re.findall(r"\{\{(\d+)\}\}", body)}
        if markers != set(range(1, len(fields) + 1)):
            raise serializers.ValidationError("O texto deve conter todas as variáveis numeradas do mapa.")
        from operations.models import Purpose

        if (
            attrs.get("purpose", self.instance.purpose if self.instance else "appointment")
            not in Purpose.values
        ):
            raise serializers.ValidationError("Finalidade inválida.")
        components = attrs.get("components", self.instance.components if self.instance else [])
        if not isinstance(components, list) or len(components) > 4:
            raise serializers.ValidationError("Componentes inválidos.")
        for component in components:
            if not isinstance(component, dict) or component.get("type") not in {"button", "header"}:
                raise serializers.ValidationError("Somente componentes de botão ou cabeçalho são aceitos.")
        return attrs


class RuleSerializer(serializers.ModelSerializer):
    template_name = serializers.CharField(source="template.name", read_only=True)

    class Meta:
        model = Rule
        fields = [
            "id",
            "code",
            "name",
            "kind",
            "days_before",
            "refresh_interval_minutes",
            "response_condition",
            "validity_hours",
            "evidence",
            "send_time",
            "weekdays",
            "enabled",
            "version",
            "template",
            "template_name",
            "legacy_report_id",
            "legacy_scheduler_id",
        ]
        read_only_fields = ["code", "version", "legacy_report_id", "legacy_scheduler_id"]

    def validate_weekdays(self, value):
        if (
            not isinstance(value, list)
            or not value
            or any(type(day) is not int or day not in range(7) for day in value)
        ):
            raise serializers.ValidationError("Informe os dias da semana de 0 (segunda) a 6 (domingo).")
        return sorted(set(value))

    def validate_template(self, template):
        if template.unit_id != self.context["unit"].id:
            raise serializers.ValidationError("Template de outra unidade.")
        if template.purpose != "appointment":
            raise serializers.ValidationError("Regra de agenda exige template de agendamento.")
        return template

    def validate_days_before(self, value):
        if not 1 <= value <= 365:
            raise serializers.ValidationError("Antecedência deve estar entre 1 e 365 dias.")
        return value

    def validate_refresh_interval_minutes(self, value):
        if not 1 <= value <= 1440:
            raise serializers.ValidationError("Atualização deve estar entre 1 e 1440 minutos.")
        return value

    def validate_validity_hours(self, value):
        if not 1 <= value <= 168:
            raise serializers.ValidationError("Validade deve estar entre 1 e 168 horas.")
        return value


class ImportRunSerializer(serializers.ModelSerializer):
    rule_name = serializers.CharField(source="rule.name", read_only=True)

    class Meta:
        model = ImportRun
        fields = [
            "id",
            "rule_name",
            "run_date",
            "status",
            "imported",
            "error",
            "legacy_exclusion",
            "started_at",
            "completed_at",
        ]


class AuditSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.username", default="Sistema", read_only=True)

    class Meta:
        model = Audit
        fields = ["id", "actor_name", "action", "object_id", "details", "created_at"]
