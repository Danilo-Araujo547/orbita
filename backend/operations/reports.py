import base64
import csv
import io
from datetime import date

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from core.models import Membership
from operations.models import Case, ReportRequest

HANDLERS = {
    "confirmed",
    "declined",
    "no_response",
    "failures",
    "contacts",
    "not_confirmed",
    "not_sent",
    "combined",
}


def check_access(job):
    report, user = job.report, job.requester
    membership = Membership.objects.filter(unit=job.unit, user=user).first()
    if not user.is_active or not (user.is_superuser or membership):
        raise PermissionDenied("Acesso à unidade revogado.")
    if (
        report.catalog_kind != "report"
        or not report.enabled
        or report.unit_id != job.unit_id
        or report.version != job.definition_version
    ):
        raise PermissionDenied("Definição indisponível ou alterada.")
    if job.access_id:
        access = job.access
        if (
            not access.active
            or not access.verified_at
            or access.user_id != user.id
            or access.unit_id != job.unit_id
            or not access.reports.filter(pk=report.pk).exists()
        ):
            raise PermissionDenied("Autorização de relatório revogada.")
    elif not (user.is_superuser or membership.role == "admin"):
        if not user.reportaccess_set.filter(
            unit=job.unit, active=True, verified_at__isnull=False, reports=report
        ).exists():
            raise PermissionDenied("Relatório não autorizado.")


def validate_parameters(values):
    if not isinstance(values, dict) or set(values) - {"start", "end"}:
        raise ValidationError("Use somente os parâmetros start e end.")
    for value in values.values():
        try:
            date.fromisoformat(value)
        except (TypeError, ValueError):
            raise ValidationError("Parâmetros de data devem usar AAAA-MM-DD.") from None
    if values.get("start") and values.get("end"):
        delta = date.fromisoformat(values["end"]) - date.fromisoformat(values["start"])
        if delta.days < 0 or delta.days > 366:
            raise ValidationError("Período inválido ou superior a 366 dias.")
    return values


def local_report_content(job):
    """Render unit-scoped data after the caller has verified report access."""
    if job.report.handler not in HANDLERS or job.report.source != "local":
        raise ValidationError("Fonte externa ainda não homologada.")
    headers, rows = local_report_data(job.report, job.parameters)
    if job.format == "pdf":
        from xml.sax.saxutils import escape

        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle

        output = io.BytesIO()
        style = getSampleStyleSheet()["BodyText"]
        style.fontSize, style.leading = 7, 9
        table = Table(
            [
                [Paragraph(escape(str(v)), style) for v in row]
                for row in [headers, *rows]
            ],
            repeatRows=1,
            colWidths=[140, 80, 100, 115, 70, 70, 80, 65],
        )
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#8AD0E7")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                ]
            )
        )
        SimpleDocTemplate(
            output, pagesize=landscape(A4), leftMargin=10, rightMargin=10
        ).build(
            [Paragraph(escape(job.report.name), getSampleStyleSheet()["Title"]), table]
        )
        result = base64.b64encode(output.getvalue()).decode()
    elif job.format == "text":
        result = "\n".join(" | ".join(row) for row in [headers, *rows])
    else:
        output = io.StringIO()
        writer = csv.writer(output)
        # Prevent spreadsheet formulas in patient/source-controlled cells.
        writer.writerows(
            [
                ["'" + v if str(v).startswith(("=", "+", "-", "@")) else v for v in row]
                for row in [headers, *rows]
            ]
        )
        result = output.getvalue()
    if len(result.encode()) > 10 * 1024 * 1024:
        raise ValidationError("Resultado excede 10 MB.")
    return result, len(rows)


@transaction.atomic
def generate(job_id):
    job = (
        ReportRequest.objects.select_for_update(of=("self",))
        .select_related("report", "requester", "unit", "access")
        .get(pk=job_id)
    )
    if job.state != "pending":
        return
    try:
        check_access(job)
        result, _ = local_report_content(job)
        job.result, job.state = result, "ready"
    except PermissionDenied:
        job.state, job.error_code = "blocked", "access_revoked"
    except ValidationError:
        job.state, job.error_code = "failed", "report_validation_failed"
    except Exception:  # noqa: BLE001 - preserve failure status without exposing report data
        job.state, job.error_code = "failed", "report_generation_failed"
    job.completed_at = timezone.now()
    job.save()
    if job.state == "ready" and job.access_id and job.format == "pdf":
        prepare_delivery(job)


@transaction.atomic
def prepare_delivery(job):
    from datetime import timedelta

    from messaging.models import Message, Template
    from operations.models import Case, Contact, SourceEvent

    check_access(job)
    if job.state != "ready" or job.format != "pdf" or not job.access_id:
        raise ValidationError(
            "Entrega exige PDF disponível e número autorizado vinculado à solicitação."
        )
    if job.notification_id:
        return job.notification
    event, _ = SourceEvent.objects.get_or_create(
        unit=job.unit,
        source="report",
        kind="report",
        external_id=str(job.pk),
        defaults={
            "patient": job.requester.username,
            "phone": job.access.phone,
            "occurred_at": job.created_at,
            "data": {"report_name": job.report.name},
        },
    )
    case, _ = Case.objects.get_or_create(unit=job.unit, event=event, purpose="report")
    Contact.objects.get_or_create(unit=job.unit, event=event, phone=job.access.phone)
    template, _ = Template.objects.get_or_create(
        unit=job.unit,
        name="report_notification_demo",
        language="pt_BR",
        defaults={
            "purpose": "report",
            "body": "Relatório {{1}} disponível.",
            "fields": ["report_name"],
        },
    )
    message = Message.objects.create(
        unit=job.unit,
        case=case,
        purpose="report",
        rule_version=1,
        appointment_revision=1,
        notification_key=f"report:{job.pk}",
        template=template,
        template_name=template.name,
        template_language=template.language,
        parameters=[job.report.name],
        body=f"Relatório {job.report.name} disponível.",
        recipient=job.access.phone,
        state="preview",
        scheduled_for=timezone.now(),
        expires_at=timezone.now() + timedelta(days=1),
        snapshot={
            "report_request": str(job.pk),
            "definition_version": job.definition_version,
            "template_version": template.version,
        },
    )
    job.notification, job.delivery_state = message, "preview"
    job.save(update_fields=["notification", "delivery_state"])
    return message


def local_report_data(report, values):
    """Shared rows for the original renderer and editable Canvas; identical filters."""
    queryset = Case.objects.filter(unit=report.unit).select_related("event", "assignee")
    from datetime import datetime, time, timedelta
    from zoneinfo import ZoneInfo

    zone = ZoneInfo(report.unit.timezone)
    params = validate_parameters(values)
    if params.get("start"):
        queryset = queryset.filter(
            event__occurred_at__gte=datetime.combine(
                date.fromisoformat(params["start"]), time.min, zone
            )
        )
    if params.get("end"):
        queryset = queryset.filter(
            event__occurred_at__lt=datetime.combine(
                date.fromisoformat(params["end"]) + timedelta(days=1), time.min, zone
            )
        )
    handler = report.handler
    if handler == "confirmed":
        queryset = queryset.filter(purpose="appointment", outcome="confirmed")
    elif handler == "declined":
        queryset = queryset.filter(purpose="appointment", outcome="declined")
    elif handler == "no_response":
        queryset = queryset.filter(response_state="no_response")
    elif handler == "not_confirmed":
        queryset = queryset.filter(purpose="appointment").exclude(outcome="confirmed")
    elif handler == "not_sent":
        queryset = queryset.filter(purpose="appointment").exclude(
            messages__state__in=["accepted", "sent", "delivered", "read"]
        )
    elif handler == "combined":
        queryset = queryset.filter(purpose="appointment").exclude(outcome="confirmed")
    elif handler == "failures":
        queryset = queryset.filter(
            messages__state__in=["failed", "blocked", "uncertain"]
        ).distinct()
    if queryset.count() > 10000:
        raise ValidationError("Limite de 10.000 linhas excedido; reduza o período.")
    rows = [
        [
            c.event.patient,
            c.event.phone,
            c.get_purpose_display(),
            c.event.occurred_at.isoformat(),
            c.response_state,
            c.outcome,
            c.state,
            c.assignee.username if c.assignee else "",
        ]
        for c in queryset.order_by("event__occurred_at")
    ]
    headers = [
        "Paciente",
        "Telefone",
        "Finalidade",
        "Data",
        "Resposta",
        "Resultado",
        "Atendimento",
        "Responsável",
    ]
    return headers, rows
