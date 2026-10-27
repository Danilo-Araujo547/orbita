from django.db import models


class Patient(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    source = models.CharField(max_length=80)
    external_id = models.CharField(max_length=100)
    name = models.CharField(max_length=200)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "source", "external_id"], name="patient_source_identity"
            )
        ]


class PatientPhone(models.Model):
    patient = models.ForeignKey(
        Patient, related_name="contacts", on_delete=models.PROTECT
    )
    phone = models.CharField(max_length=40)
    status = models.CharField(max_length=30, default="unverified")
    opted_out = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["patient", "phone"], name="patient_phone_identity"
            )
        ]


class Appointment(models.Model):
    class Kind(models.TextChoices):
        CONSULTATION = "consultation", "Consulta"
        EXAM = "exam", "Exame"
        LAB = "lab", "Laboratório"
        POSTPROCEDURE = "postprocedure", "Busca ativa - pós procedimento"

    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    source = models.CharField(max_length=30, default="oracle")
    external_id = models.CharField(max_length=100)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    patient = models.CharField(max_length=200)
    patient_record = models.ForeignKey(
        Patient,
        null=True,
        blank=True,
        related_name="appointments",
        on_delete=models.PROTECT,
    )
    patient_external_id = models.CharField(max_length=100, blank=True)
    source_values = models.JSONField(default=dict)
    phone_numbers = models.JSONField(default=list)
    professional = models.CharField(max_length=200, blank=True)
    city = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    procedure = models.CharField(max_length=200)
    procedure_code = models.CharField(max_length=100, blank=True)
    appointment_type = models.TextField(blank=True)
    scheduled_at = models.DateTimeField()
    arrival_time = models.CharField(max_length=200)
    status = models.CharField(max_length=20, default="scheduled")
    synthetic = models.BooleanField(default=False)
    revision = models.PositiveIntegerField(default=1)
    data_issue = models.CharField(max_length=50, blank=True)
    last_seen_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["unit", "source", "kind", "external_id"],
                name="appointment_identity",
            )
        ]
        indexes = [models.Index(fields=["unit", "scheduled_at"])]


class Rule(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=180)
    kind = models.CharField(max_length=20, choices=Appointment.Kind.choices)
    days_before = models.PositiveIntegerField(default=5)
    refresh_interval_minutes = models.PositiveIntegerField(default=5)
    send_time = models.TimeField()
    weekdays = models.JSONField(default=list)
    enabled = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)
    response_condition = models.CharField(
        max_length=20,
        default="any",
        choices=[
            ("any", "Qualquer resposta"),
            ("unanswered", "Sem resposta"),
            ("confirmed", "Confirmados"),
        ],
    )
    validity_hours = models.PositiveIntegerField(default=24)
    evidence = models.TextField(blank=True)
    template = models.ForeignKey("messaging.Template", on_delete=models.PROTECT)
    legacy_report_id = models.PositiveIntegerField(null=True, blank=True)
    legacy_scheduler_id = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["unit", "code"], name="rule_identity")
        ]


class ImportRun(models.Model):
    unit = models.ForeignKey("core.Unit", on_delete=models.PROTECT)
    rule = models.ForeignKey(Rule, on_delete=models.PROTECT)
    run_date = models.DateField()
    status = models.CharField(max_length=20, default="running")
    imported = models.PositiveIntegerField(default=0)
    error = models.CharField(max_length=100, blank=True)
    legacy_exclusion = models.BooleanField(default=True)
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["rule", "run_date"], name="import_daily_identity"
            )
        ]


def all_send_weekdays():
    return list(range(7))


class OracleAgenda(models.Model):
    send_weekdays = models.JSONField(default=all_send_weekdays)
    blocked_day_policy = models.JSONField(default=dict)
    name = models.CharField(max_length=120, default="Agenda Oracle")
    kind = models.CharField(
        max_length=30,
        choices=[
            ("consultation", "Consulta"),
            ("exam", "Exame"),
            ("lab", "Laboratório"),
            ("postprocedure", "Busca ativa - pós procedimento"),
        ],
        default="consultation",
    )
    deleted_at = models.DateTimeField(null=True, blank=True)
    unit = models.ForeignKey(
        "core.Unit", on_delete=models.PROTECT, related_name="oracle_agendas"
    )
    view_name = models.CharField(max_length=200)
    columns = models.JSONField(default=list)
    column_mapping = models.JSONField(default=dict)
    template_id = models.CharField(max_length=40)
    template_snapshot = models.JSONField(default=dict)
    parameter_mapping = models.JSONField(default=dict)
    days_after = models.PositiveIntegerField(default=10)
    date_format = models.CharField(
        max_length=20,
        default="native",
        choices=[
            ("native", "DATE / TIMESTAMP"),
            ("br_date", "dd/mm/aaaa"),
            ("iso_date", "aaaa-mm-dd"),
        ],
    )
    horizon_days = models.PositiveIntegerField(default=10)
    days_before = models.PositiveIntegerField(default=5)
    send_time = models.TimeField(default="09:00")
    enabled = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    rule = models.OneToOneField(
        Rule, on_delete=models.PROTECT, related_name="oracle_agenda"
    )
    last_state = models.CharField(max_length=30, default="pending")
    last_error = models.CharField(max_length=80, blank=True)
    last_started_at = models.DateTimeField(null=True)
    last_completed_at = models.DateTimeField(null=True)
    updated_at = models.DateTimeField(auto_now=True)


class OracleAgendaDay(models.Model):
    agenda = models.ForeignKey(
        OracleAgenda, on_delete=models.PROTECT, related_name="days"
    )
    version = models.PositiveIntegerField()
    date = models.DateField()
    row_count = models.PositiveIntegerField(default=0)
    appointment_count = models.PositiveIntegerField(default=0)
    completed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["agenda", "version", "date"], name="oracle_agenda_day_identity"
            )
        ]
