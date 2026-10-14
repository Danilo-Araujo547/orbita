import uuid

from django.db import models


class MetaConfiguration(models.Model):
    unit = models.OneToOneField("core.Unit", on_delete=models.PROTECT)
    waba_id = models.CharField(max_length=40, blank=True)
    phone_number_id = models.CharField(max_length=40, blank=True)
    business_id = models.CharField(max_length=40, blank=True)
    app_id = models.CharField(max_length=40, blank=True)
    api_version = models.CharField(max_length=12, default="v24.0")
    token_ciphertext = models.TextField(blank=True, editable=False)
    app_secret_ciphertext = models.TextField(blank=True, editable=False)
    verify_token_ciphertext = models.TextField(blank=True, editable=False)
    version = models.PositiveIntegerField(default=1)
    checked_at = models.DateTimeField(null=True)
    validation_state = models.CharField(max_length=30, default="not_checked")
    validation_code = models.CharField(max_length=60, blank=True)
    account_name = models.CharField(max_length=255, blank=True)
    display_phone_number = models.CharField(max_length=80, blank=True)
    verified_name = models.CharField(max_length=255, blank=True)
    templates = models.JSONField(default=list)
    templates_synced_at = models.DateTimeField(null=True)
    updated_at = models.DateTimeField(auto_now=True)


class Template(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    name = models.CharField(max_length=100)
    language = models.CharField(max_length=15, default="pt_BR")
    body = models.TextField()
    fields = models.JSONField(default=list)
    approved_for_test = models.BooleanField(default=False)
    purpose = models.CharField(max_length=30, default="appointment")
    components = models.JSONField(default=list)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["unit", "name", "language"], name="template_identity")]


class Notification(models.Model):
    key = models.CharField(max_length=250, unique=True)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    appointment = models.ForeignKey(
        "scheduling.Appointment", null=True, on_delete=models.PROTECT, related_name="notifications"
    )
    purpose = models.CharField(max_length=30, default="appointment")
    revision = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class AppointmentGroup(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    kind = models.CharField(max_length=30)
    appointment_date = models.DateField()
    rule = models.ForeignKey("scheduling.Rule", on_delete=models.PROTECT)
    rule_version = models.PositiveIntegerField()
    scheduled_for = models.DateTimeField()
    delay_seconds = models.PositiveIntegerField(default=5)
    schedule_overridden = models.BooleanField(default=False)
    next_send_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "kind", "appointment_date", "rule", "rule_version"],
                name="appointment_group_identity",
            )
        ]
        ordering = ["appointment_date", "scheduled_for", "id"]


class Message(models.Model):
    class State(models.TextChoices):
        PREVIEW = "preview", "Somente análise"
        QUEUED = "queued", "Na fila"
        SENDING = "sending", "Enviando"
        ACCEPTED = "accepted", "Aceita pela API"
        SENT = "sent", "Enviada"
        DELIVERED = "delivered", "Entregue"
        READ = "read", "Lida"
        FAILED = "failed", "Falha"
        UNCERTAIN = "uncertain", "Resultado incerto"
        BLOCKED = "blocked", "Bloqueada"
        EXPIRED = "expired", "Vencida"
        CANCELLED = "cancelled", "Invalidada"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    group = models.ForeignKey(
        AppointmentGroup, null=True, blank=True, related_name="messages", on_delete=models.PROTECT
    )
    notification = models.ForeignKey(
        Notification, null=True, blank=True, related_name="deliveries", on_delete=models.PROTECT
    )
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    appointment = models.ForeignKey(
        "scheduling.Appointment", related_name="messages", null=True, blank=True, on_delete=models.PROTECT
    )
    case = models.ForeignKey(
        "operations.Case", null=True, blank=True, related_name="messages", on_delete=models.PROTECT
    )
    purpose = models.CharField(max_length=30, default="appointment")
    snapshot = models.JSONField(default=dict)
    notification_key = models.CharField(max_length=200, unique=True, null=True, blank=True)
    rule = models.ForeignKey("scheduling.Rule", null=True, blank=True, on_delete=models.PROTECT)
    rule_version = models.PositiveIntegerField()
    appointment_revision = models.PositiveIntegerField()
    template = models.ForeignKey(Template, on_delete=models.PROTECT)
    template_name = models.CharField(max_length=100)
    template_language = models.CharField(max_length=15)
    parameters = models.JSONField(default=list)
    body = models.TextField()
    recipient = models.CharField(max_length=40)
    scheduled_for = models.DateTimeField()
    expires_at = models.DateTimeField()
    state = models.CharField(max_length=20, choices=State.choices, default=State.PREVIEW)
    response_state = models.CharField(max_length=20, default="not_requested")
    provider_id = models.CharField(max_length=200, null=True, blank=True, unique=True)
    channel_id = models.CharField(max_length=100, default="simulated")
    delivered_at = models.DateTimeField(null=True, blank=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    attempt_count = models.PositiveIntegerField(default=0)
    error_code = models.CharField(max_length=80, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["appointment", "rule", "rule_version", "appointment_revision", "recipient"],
                name="reminder_identity",
            ),
            models.UniqueConstraint(
                fields=["notification", "recipient"], name="notification_recipient_identity"
            ),
        ]
        indexes = [models.Index(fields=["unit", "state", "scheduled_for"])]


class Attempt(models.Model):
    message = models.ForeignKey(Message, related_name="attempts", on_delete=models.PROTECT)
    number = models.PositiveIntegerField()
    outcome = models.CharField(max_length=30, default="started")
    error_code = models.CharField(max_length=80, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True)


class ProviderEvent(models.Model):
    key = models.CharField(max_length=64, unique=True)
    channel_id = models.CharField(max_length=100)
    provider_id = models.CharField(max_length=200)
    event_type = models.CharField(max_length=30)
    occurred_at = models.DateTimeField()
    data = models.JSONField(default=dict)
    processed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
