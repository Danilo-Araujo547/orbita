import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


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
    appointment = models.OneToOneField(
        "scheduling.Appointment", null=True, on_delete=models.PROTECT
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "source", "kind", "external_id"],
                name="source_event_identity",
            )
        ]


class Case(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    event = models.ForeignKey(
        SourceEvent, related_name="cases", on_delete=models.PROTECT
    )
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
        max_length=15,
        default="normal",
        choices=[("normal", "Normal"), ("high", "Alta")],
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT
    )
    outcome = models.CharField(max_length=40, blank=True)
    response_state = models.CharField(max_length=30, default="pending")
    last_response_at = models.DateTimeField(null=True)
    due_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["event", "purpose"], name="case_event_purpose"
            )
        ]
        indexes = [models.Index(fields=["unit", "state", "priority", "created_at"])]


class Interaction(models.Model):
    case = models.ForeignKey(
        Case, related_name="interactions", on_delete=models.PROTECT
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT
    )
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
    patient_phone = models.ForeignKey(
        "scheduling.PatientPhone", null=True, on_delete=models.PROTECT
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["event", "phone"], name="contact_event_phone"
            )
        ]


class ActionReceipt(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    key = models.CharField(max_length=100)
    fingerprint = models.CharField(max_length=64)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "actor", "key"], name="operation_idempotency"
            )
        ]


class Movement(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    case = models.ForeignKey(Case, related_name="movements", on_delete=models.PROTECT)
    kind = models.CharField(
        max_length=25,
        choices=[
            ("cancel", "Cancelamento"),
            ("reschedule", "Reagendamento"),
            ("transfer", "Transferência"),
        ],
    )
    before = models.JSONField(default=dict)
    requested = models.JSONField(default=dict)
    final = models.JSONField(default=dict)
    state = models.CharField(max_length=30, default="pending_external")
    evidence = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="requested_movements",
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.PROTECT,
        related_name="confirmed_movements",
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
            models.UniqueConstraint(
                fields=["unit", "procedure_code", "version"],
                name="preparation_revision",
            )
        ]


class ImportLayout(models.Model):
    standard_mapping = models.JSONField(default=dict, blank=True)
    default_template = models.ForeignKey(
        "messaging.Template",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="cross_layouts",
    )
    parameter_fields = models.JSONField(default=list, blank=True)
    format = models.CharField(
        max_length=30,
        choices=[
            ("table", "CSV/XLSX"),
            ("absence_html", "Ausentes HTML (.xls)"),
            ("cross_demand_csv", "Demanda por recurso CROSS (.csv)"),
        ],
        default="table",
    )
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    version = models.PositiveIntegerField(default=1)
    mapping = models.JSONField(default=dict)
    verified = models.BooleanField(default=False)
    evidence = models.TextField(blank=True)


class SheetImport(models.Model):
    version = models.PositiveIntegerField(default=1)
    disabled_records = models.JSONField(default=list, blank=True)
    filename = models.CharField(max_length=200, blank=True)
    template = models.ForeignKey(
        "messaging.Template",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="cross_imports",
    )
    configuration = models.JSONField(default=dict, blank=True)
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
            models.UniqueConstraint(
                fields=["unit", "layout", "digest"], name="sheet_import_identity"
            )
        ]


class Campaign(models.Model):
    import_batch = models.OneToOneField(
        "SheetImport",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="campaign",
    )
    sends_enabled = models.BooleanField(default=False)
    next_send_at = models.DateTimeField(null=True, blank=True)
    response_policy = models.CharField(
        max_length=40,
        default="contextual",
        choices=[
            ("contextual", "Por finalidade"),
            ("confirmation_test", "Teste: SIM e NÃO confirmam"),
        ],
    )
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    name = models.CharField(max_length=150)
    purpose = models.CharField(max_length=30, choices=Purpose.choices)
    cases = models.ManyToManyField(Case)
    state = models.CharField(max_length=20, default="draft")
    version = models.PositiveIntegerField(default=1)
    template = models.ForeignKey(
        "messaging.Template", null=True, on_delete=models.PROTECT
    )
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
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "purpose"], name="purpose_policy_identity"
            )
        ]


class ReportConnection(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    name = models.CharField(max_length=150)
    engine = models.CharField(
        max_length=20,
        choices=[(x, x) for x in ["oracle", "sqlite", "firebird", "mysql", "postgres"]],
    )
    host = models.CharField(max_length=253, blank=True)
    port = models.PositiveIntegerField(default=1521)
    database = models.CharField(max_length=500, blank=True)
    username = models.CharField(max_length=128, blank=True)
    options = models.JSONField(default=dict)
    ciphertext = models.TextField(blank=True)
    enabled = models.BooleanField(default=False)
    validated = models.BooleanField(default=False)
    checked_at = models.DateTimeField(null=True)
    validation_error = models.CharField(max_length=80, blank=True)
    timeout_seconds = models.PositiveIntegerField(default=30)
    max_rows = models.PositiveIntegerField(default=1000)
    version = models.PositiveIntegerField(default=1)
    legacy = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "name"], name="report_connection_name"
            )
        ]


class ReportApplicationConnection(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT, related_name="report_app_connections")
    name = models.CharField(max_length=150)
    mode = models.CharField(max_length=10, choices=[("local", "Instância local"), ("remote", "Instância remota")], default="local")
    local_unit = models.ForeignKey("core.Unit", null=True, blank=True, on_delete=models.PROTECT, related_name="report_app_sources")
    remote_instance = models.ForeignKey("core.RemoteInstance", null=True, blank=True, on_delete=models.PROTECT)
    enabled = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["unit", "name"], name="report_app_connection_name")]


class ReportDefinition(models.Model):
    app_connection = models.ForeignKey(ReportApplicationConnection, null=True, blank=True, on_delete=models.PROTECT)

    catalog_kind = models.CharField(
        max_length=12, default="report",
        choices=[("report", "Relatório"), ("component", "Componente")],
        db_index=True,
    )
    request_message = models.TextField(blank=True, default="", max_length=2000)
    review_queue = models.BooleanField(default=False)
    connection = models.ForeignKey(
        ReportConnection, null=True, blank=True, on_delete=models.PROTECT
    )
    query_sql = models.TextField(blank=True)
    reviewed = models.BooleanField(default=False)
    manual_enabled = models.BooleanField(default=True)
    output_format = models.CharField(
        max_length=10,
        default="pdf",
        choices=[("pdf", "PDF"), ("csv", "CSV"), ("xlsx", "XLSX"), ("text", "Texto")],
    )
    keywords = models.JSONField(default=list)
    legacy = models.JSONField(default=dict)
    components = models.JSONField(default=list)
    monthly_goals = models.JSONField(default=list, blank=True)
    canvas_layout = models.JSONField(default=dict, blank=True)
    canvas_enabled = models.BooleanField(default=False)
    dependencies = models.JSONField(default=list)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=200)
    keyword = models.CharField(max_length=80, blank=True, default="")
    source = models.CharField(max_length=80, default="local")
    handler = models.CharField(max_length=80, blank=True)
    parameter_schema = models.JSONField(default=dict)
    enabled = models.BooleanField(default=False)
    unavailable_reason = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["unit", "code"], name="report_unit_code")
        ]


class ReportAccess(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    phone = models.CharField(max_length=40)
    verified_at = models.DateTimeField(null=True)
    active = models.BooleanField(default=True)
    reports = models.ManyToManyField(ReportDefinition)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "phone"], name="report_authorized_phone"
            )
        ]


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
    inbound_event = models.OneToOneField(
        "messaging.ProviderEvent", null=True, on_delete=models.PROTECT
    )
    notification = models.OneToOneField(
        "messaging.Message",
        null=True,
        on_delete=models.PROTECT,
        related_name="report_request",
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
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "kind"], name="source_configuration_identity"
            )
        ]


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
        constraints = [
            models.UniqueConstraint(fields=["unit", "code"], name="flow_rule_identity")
        ]


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
        constraints = [
            models.UniqueConstraint(fields=["rule", "run_date"], name="flow_daily_run")
        ]


class ReportRecipient(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    legacy_key = models.CharField(max_length=80, blank=True, default="")
    name = models.CharField(max_length=200)
    address = models.CharField(max_length=100)
    kind = models.CharField(
        max_length=10,
        choices=[("phone", "Telefone"), ("group", "Grupo")],
        default="phone",
    )
    active = models.BooleanField(default=False)
    manual_enabled = models.BooleanField(default=True)
    verified_at = models.DateTimeField(null=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT
    )
    version = models.PositiveIntegerField(default=1)
    legacy = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "legacy_key"],
                condition=~models.Q(legacy_key=""),
                name="report_recipient_legacy",
            )
        ]


class ReportGrant(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    report = models.ForeignKey(
        ReportDefinition, on_delete=models.PROTECT, related_name="recipient_grants"
    )
    recipient = models.ForeignKey(
        ReportRecipient, on_delete=models.PROTECT, related_name="grants"
    )
    active = models.BooleanField(default=False)
    manual = models.BooleanField(default=True)
    automatic = models.BooleanField(default=True)
    parameters = models.JSONField(default=dict)
    legacy = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["report", "recipient"], name="report_recipient_grant"
            )
        ]


class ReportAutomation(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    report = models.ForeignKey(ReportDefinition, on_delete=models.PROTECT)
    recipient = models.ForeignKey(ReportRecipient, on_delete=models.PROTECT)
    send_time = models.TimeField()
    weekdays = models.JSONField(default=list)
    parameters = models.JSONField(default=dict)
    enabled = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    legacy = models.JSONField(default=dict)


class ReportExecution(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    report = models.ForeignKey(ReportDefinition, on_delete=models.PROTECT)
    recipient = models.ForeignKey(
        ReportRecipient, null=True, blank=True, on_delete=models.PROTECT
    )
    automation = models.ForeignKey(
        ReportAutomation, null=True, on_delete=models.PROTECT
    )
    run_date = models.DateField(null=True)
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT
    )
    origin = models.CharField(max_length=15, default="panel")
    parameters = models.JSONField(default=dict)
    definition_version = models.PositiveIntegerField()
    recipient_version = models.PositiveIntegerField(null=True)
    grant_version = models.PositiveIntegerField(null=True)
    connection_version = models.PositiveIntegerField(null=True)
    state = models.CharField(max_length=20, default="pending")
    format = models.CharField(max_length=10, default="pdf")
    result = models.TextField(blank=True)
    row_count = models.PositiveIntegerField(default=0)
    error_code = models.CharField(max_length=100, blank=True)
    delivery_state = models.CharField(max_length=60, default="not_requested")
    snapshot = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["automation", "run_date"], name="report_automation_day"
            )
        ]


class ReportWhatsAppConfiguration(models.Model):
    menu_title = models.CharField(max_length=60, default="Relatórios")
    menu_button = models.CharField(max_length=20, default="Ver relatórios")
    menu_section = models.CharField(max_length=24, default="Disponíveis para você")

    unit = models.OneToOneField("core.Unit", on_delete=models.PROTECT)
    version = models.PositiveIntegerField(default=1)
    sends_enabled = models.BooleanField(default=False)
    manual_enabled = models.BooleanField(default=False)
    automatic_enabled = models.BooleanField(default=False)
    greeting = models.CharField(max_length=1000, default="Selecione um relatório:")


class ReportConversation(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    address = models.CharField(max_length=100)
    is_group = models.BooleanField(default=False)
    data = models.JSONField(default=dict)
    expires_at = models.DateTimeField()
    last_timestamp = models.BigIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "address"], name="report_conversation_identity"
            )
        ]


class ReportInboundReceipt(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    message_id = models.CharField(max_length=180)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "message_id"], name="report_baileys_inbound_identity"
            )
        ]



def snapshot_weekdays():
    return list(range(7))


class ReportSnapshotConfiguration(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    code = models.SlugField(max_length=80)
    name = models.CharField(max_length=150)
    dataset_kind = models.CharField(max_length=20, default="beds", choices=[("beds", "Leitos totais"), ("capacity", "Capacidade SUS/convênio"), ("lives", "Vidas Sansaúde")])
    reference_offset_days = models.SmallIntegerField(default=0)
    consumers = models.ManyToManyField(ReportDefinition, blank=True, related_name="snapshot_dependencies")
    source_report = models.ForeignKey(ReportDefinition, on_delete=models.PROTECT, related_name="snapshot_sources")
    output_report = models.OneToOneField(ReportDefinition, on_delete=models.PROTECT, related_name="snapshot_configuration")
    environment = models.CharField(max_length=20, choices=[("homologation", "Homologação"), ("production", "Produção")])
    collection_time = models.TimeField()
    weekdays = models.JSONField(default=snapshot_weekdays)
    window_minutes = models.PositiveIntegerField(default=60)
    enabled = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["unit", "code"], name="snapshot_configuration_code")]


class ReportSnapshotRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    configuration = models.ForeignKey(ReportSnapshotConfiguration, on_delete=models.PROTECT, related_name="runs")
    reference_date = models.DateField()
    dataset_key = models.CharField(max_length=64)
    period_type = models.CharField(max_length=8, default="day", choices=[("day", "Diário"), ("month", "Mensal")])
    origin = models.CharField(max_length=12)
    state = models.CharField(max_length=12, default="pending", choices=[(s, s) for s in ("pending", "running", "ready", "failed", "missed")])
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    configuration_version = models.PositiveIntegerField()
    source_snapshot = models.JSONField(default=dict)
    scheduled_for = models.DateTimeField(null=True)
    requested_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(null=True)
    captured_at = models.DateTimeField(null=True)
    source_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)
    attempt_count = models.PositiveIntegerField(default=0)
    claim_token = models.UUIDField(null=True)
    row_count = models.PositiveIntegerField(default=0)
    error_code = models.CharField(max_length=80, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["configuration", "dataset_key", "reference_date"], name="snapshot_dataset_day")]
        indexes = [models.Index(fields=["unit", "reference_date", "state"], name="snapshot_unit_date_state")]


class BedSnapshotRow(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    run = models.ForeignKey(ReportSnapshotRun, on_delete=models.PROTECT, related_name="rows")
    ward_code = models.PositiveIntegerField()
    ward_name = models.CharField(max_length=150)
    quantity = models.PositiveIntegerField()
    source_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["run", "ward_code"], name="snapshot_run_ward")]


class ReportCanvasAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    report = models.ForeignKey(ReportDefinition, on_delete=models.CASCADE, related_name="canvas_assets")
    filename = models.CharField(max_length=160)
    data = models.BinaryField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)


class ReportSnapshotDataRow(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    run = models.ForeignKey(ReportSnapshotRun, on_delete=models.PROTECT, related_name="data_rows")
    record_key = models.CharField(max_length=200)
    payload = models.JSONField(default=dict)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["run", "record_key"], name="snapshot_data_run_key")]
