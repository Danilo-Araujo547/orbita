import uuid

from django.conf import settings
from django.db import models


class Purpose(models.TextChoices):
    APPOINTMENT = "appointment", "Confirmação de agendamento"
    WAITLIST = "waitlist", "Permanência na fila CDR"
    SUMMONS = "summons", "Convocação CDR"
    POSTOPERATIVE = "postoperative", "Acompanhamento pós-cirúrgico"
    ABSENCE = "absence", "Motivo da ausência"
    MOVEMENT = "movement", "Movimentação de agenda"
    REPORT = "report", "Relatório"


class SourceEvent(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    source = models.CharField(max_length=80)
    external_id = models.CharField(max_length=200)
    kind = models.CharField(max_length=30)
    patient = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    occurred_at = models.DateTimeField()
    revision = models.PositiveIntegerField(default=1)
    data = models.JSONField(default=dict)
    synthetic = models.BooleanField(default=False)
    appointment = models.OneToOneField("scheduling.Appointment", null=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "source", "kind", "external_id"], name="source_event_identity"
            )
        ]


class Case(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    event = models.ForeignKey(SourceEvent, related_name="cases", on_delete=models.PROTECT)
    purpose = models.CharField(max_length=30, choices=Purpose.choices)
    state = models.CharField(
        max_length=30,
        default="open",
        choices=[
            (x, y)
            for x, y in [
                ("open", "Aberto"),
                ("assigned", "Em atendimento"),
                ("waiting_external", "Aguardando ação externa"),
                ("closed", "Concluído"),
            ]
        ],
    )
    priority = models.CharField(
        max_length=15, default="normal", choices=[("normal", "Normal"), ("high", "Alta")]
    )
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT)
    outcome = models.CharField(max_length=40, blank=True)
    response_state = models.CharField(max_length=30, default="pending")
    last_response_at = models.DateTimeField(null=True)
    due_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["event", "purpose"], name="case_event_purpose")]
        indexes = [models.Index(fields=["unit", "state", "priority", "created_at"])]


class Interaction(models.Model):
    case = models.ForeignKey(Case, related_name="interactions", on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    kind = models.CharField(max_length=30)
    text = models.TextField(max_length=4000)
    interlocutor = models.CharField(max_length=200, blank=True)
    channel = models.CharField(max_length=30, default="panel")
    outcome = models.CharField(max_length=40, blank=True)
    data = models.JSONField(default=dict)
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)


class Contact(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    event = models.ForeignKey(SourceEvent, on_delete=models.PROTECT)
    phone = models.CharField(max_length=40)
    status = models.CharField(max_length=30, default="unverified")
    opted_out = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    patient_phone = models.ForeignKey("scheduling.PatientPhone", null=True, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["event", "phone"], name="contact_event_phone")]


class ActionReceipt(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    key = models.CharField(max_length=100)
    fingerprint = models.CharField(max_length=64)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["unit", "actor", "key"], name="operation_idempotency")]


class Movement(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    case = models.ForeignKey(Case, related_name="movements", on_delete=models.PROTECT)
    kind = models.CharField(
        max_length=25,
        choices=[("cancel", "Cancelamento"), ("reschedule", "Reagendamento"), ("transfer", "Transferência")],
    )
    before = models.JSONField(default=dict)
    requested = models.JSONField(default=dict)
    final = models.JSONField(default=dict)
    state = models.CharField(max_length=30, default="pending_external")
    evidence = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="requested_movements"
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name="confirmed_movements"
    )
    confirmed_at = models.DateTimeField(null=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)


class Preparation(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    procedure_code = models.CharField(max_length=100)
    name = models.CharField(max_length=200)
    text = models.TextField(max_length=12000)
    version = models.PositiveIntegerField(default=1)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["unit", "procedure_code", "version"], name="preparation_revision")
        ]


class ImportLayout(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    version = models.PositiveIntegerField(default=1)
    mapping = models.JSONField(default=dict)
    verified = models.BooleanField(default=False)
    evidence = models.TextField(blank=True)


class SheetImport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    layout = models.ForeignKey(ImportLayout, on_delete=models.PROTECT)
    digest = models.CharField(max_length=64)
    state = models.CharField(max_length=20, default="preview")
    rows = models.JSONField(default=list)
    errors = models.JSONField(default=list)
    duplicates = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["unit", "layout", "digest"], name="sheet_import_identity")
        ]


class Campaign(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    name = models.CharField(max_length=150)
    purpose = models.CharField(max_length=30, choices=Purpose.choices)
    cases = models.ManyToManyField(Case)
    state = models.CharField(max_length=20, default="draft")
    version = models.PositiveIntegerField(default=1)
    template = models.ForeignKey("messaging.Template", null=True, on_delete=models.PROTECT)
    scheduled_for = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class PurposePolicy(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    purpose = models.CharField(max_length=30, choices=Purpose.choices)
    response_hours = models.PositiveIntegerField(default=24)
    enabled = models.BooleanField(default=False)
    evidence = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["unit", "purpose"], name="purpose_policy_identity")]


class ReportDefinition(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=200)
    keyword = models.CharField(max_length=80)
    source = models.CharField(max_length=80, default="local")
    handler = models.CharField(max_length=80, blank=True)
    parameter_schema = models.JSONField(default=dict)
    enabled = models.BooleanField(default=False)
    unavailable_reason = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["unit", "code"], name="report_unit_code")]


class ReportAccess(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    phone = models.CharField(max_length=40)
    verified_at = models.DateTimeField(null=True)
    active = models.BooleanField(default=True)
    reports = models.ManyToManyField(ReportDefinition)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["unit", "phone"], name="report_authorized_phone")]


class ReportRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    report = models.ForeignKey(ReportDefinition, on_delete=models.PROTECT)
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    access = models.ForeignKey(ReportAccess, null=True, on_delete=models.PROTECT)
    parameters = models.JSONField(default=dict)
    format = models.CharField(max_length=10, default="csv")
    definition_version = models.PositiveIntegerField()
    state = models.CharField(max_length=30, default="pending")
    delivery_state = models.CharField(max_length=30, default="not_requested")
    result = models.TextField(blank=True)
    error_code = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True)
    inbound_event = models.OneToOneField("messaging.ProviderEvent", null=True, on_delete=models.PROTECT)
    notification = models.OneToOneField(
        "messaging.Message", null=True, on_delete=models.PROTECT, related_name="report_request"
    )


class ReportSchedule(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    access = models.ForeignKey(ReportAccess, on_delete=models.PROTECT)
    report = models.ForeignKey(ReportDefinition, on_delete=models.PROTECT)
    send_time = models.TimeField()
    weekdays = models.JSONField(default=list)
    enabled = models.BooleanField(default=False)
    last_run_date = models.DateField(null=True)
    parameters = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)


class SourceConfiguration(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    kind = models.CharField(
        max_length=30,
        choices=[
            ("consultation", "Consulta"),
            ("exam", "Exame"),
            ("lab", "Laboratório"),
            ("postoperative", "Pós-cirúrgico"),
        ],
    )
    view_name = models.CharField(max_length=200)
    verified = models.BooleanField(default=False)
    evidence = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["unit", "kind"], name="source_configuration_identity")]


class FlowRule(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    source = models.ForeignKey(SourceConfiguration, on_delete=models.PROTECT)
    purpose = models.CharField(max_length=30, choices=Purpose.choices)
    days_after = models.IntegerField(default=7)
    send_time = models.TimeField()
    weekdays = models.JSONField(default=list)
    template = models.ForeignKey("messaging.Template", on_delete=models.PROTECT)
    enabled = models.BooleanField(default=False)
    evidence = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["unit", "code"], name="flow_rule_identity")]


class FlowRun(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    rule = models.ForeignKey(FlowRule, on_delete=models.PROTECT)
    run_date = models.DateField()
    state = models.CharField(max_length=20, default="running")
    error_code = models.CharField(max_length=80, blank=True)
    count = models.PositiveIntegerField(default=0)
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["rule", "run_date"], name="flow_daily_run")]
