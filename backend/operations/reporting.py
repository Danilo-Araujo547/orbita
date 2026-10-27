"""Report catalog authorization and execution, independent from patient notifications."""

import base64
from zoneinfo import ZoneInfo

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from core.access import local_permissions
from core.models import Membership
from operations.models import (
    ReportAutomation,
    ReportDefinition,
    ReportExecution,
    ReportGrant,
)
from operations.report_engine import parameters, render, run_query, sql_contract


def is_admin(user, unit):
    return bool(
        user
        and (
            user.is_superuser
            or Membership.objects.filter(user=user, unit=unit, role="admin").exists()
        )
    )


def readiness(report, seen=None, *, check_external_file=True):
    seen = set(seen or ())
    if report.pk in seen:
        return ["Composição circular"]
    seen.add(report.pk)
    missing = []
    if report.review_queue:
        missing.append("Rotina legada pendente de validação")
    if not report.reviewed:
        missing.append("Revisão da definição pendente")
    if report.handler=="app_operational_v1":
        from operations.app_reporting import manifest
        try:manifest(report)
        except ValidationError as exc:return [str(x) for x in exc.detail]
    if report.canvas_enabled:
        from operations.report_canvas.engine import report_readiness
        return list(dict.fromkeys(missing + report_readiness(report)))
    if report.handler == "bed_snapshots_v1":
        from operations.bed_snapshots import report_readiness
        return list(dict.fromkeys(missing + report_readiness(report)))
    if report.handler == "stock_loans_v1":
        from operations.stock_loans import report_readiness
        missing.extend(report_readiness(report))
    if report.source == "sql":
        if not report.connection_id:
            missing.append("Selecionar conexão")
        elif (
            report.connection.unit_id != report.unit_id
            or not report.connection.enabled
            or not report.connection.validated
        ):
            missing.append("Conexão desativada ou não validada")
        if not report.query_sql.strip():
            missing.append(
                "Consulta Oracle ainda não definida"
                if report.legacy
                else "Cadastrar consulta"
            )
        if report.reviewed and report.query_sql and report.connection_id:
            try:
                sql_contract(
                    report.query_sql, report.parameter_schema, report.connection.engine
                )
            except ValidationError:
                missing.append("Revisar SQL e parâmetros")
    elif report.source == "composite":
        if (
            not isinstance(report.components, list)
            or not report.components
            or len(report.components) > 30
        ):
            missing.append("Definir componentes da composição")
        elif report.reviewed:
            for entry in report.components:
                child = (
                    ReportDefinition.objects.filter(
                        unit=report.unit, code=entry.get("code", "")
                    )
                    .select_related("connection")
                    .first()
                    if isinstance(entry, dict)
                    else None
                )
                if not child or not child.enabled or readiness(child, seen):
                    missing.append(
                        "Componente pendente: " + str(entry.get("code", "?"))
                        if isinstance(entry, dict)
                        else "Componente inválido"
                    )
    elif report.source == "external_file":
        from operations.external_pdf import definition_snapshot, source_name

        try:
            source_name(report)
            if check_external_file:
                definition_snapshot(report)
        except ValidationError as exc:
            missing.extend(str(item) for item in exc.detail)
    elif report.source == "local":
        from operations.reports import HANDLERS

        if report.handler not in HANDLERS:
            missing.append("Integração com dados do SCV Messenger pendente")
    else:
        missing.append("Fonte externa ou integração ainda não implementada")
    if report.legacy and not report.reviewed:
        missing.extend(str(x) for x in report.dependencies)
    return list(dict.fromkeys(missing))


def grant_for(report, recipient, mode):
    if report.catalog_kind != "report":
        raise PermissionDenied("Componentes não possuem envio independente.")
    if (
        recipient.unit_id != report.unit_id
        or not recipient.active
        or not recipient.verified_at
    ):
        raise PermissionDenied("Destinatário inativo ou não verificado.")
    grant = ReportGrant.objects.filter(
        unit=report.unit, report=report, recipient=recipient, active=True
    ).first()
    if (
        not grant
        or not getattr(grant, mode)
        or (mode == "manual" and not recipient.manual_enabled)
    ):
        raise PermissionDenied(
            "Destinatário sem permissão para este relatório e modalidade."
        )
    if (
        grant.legacy.get("record", {}).get("PARAMETRO1") not in (None, "", "<NULL>")
        and not grant.parameters
    ):
        raise PermissionDenied("Mapeie o parâmetro restritivo da permissão legada.")
    return grant


def execution_access(job, *, for_download=False):
    r = job.report
    if r.handler == "occupancy_indicators_v1" and job.origin == "automatic":
        raise PermissionDenied("Programação automática de Informativos ainda não homologada.")
    if (
        r.catalog_kind != "report"
        or not r.enabled
        or r.version != job.definition_version
        or r.unit_id != job.unit_id
        or readiness(r, check_external_file=job.state != "ready")
    ):
        raise PermissionDenied("Relatório desativado, alterado ou com pendências.")
    if r.canvas_enabled:
        from operations.report_canvas.engine import check_snapshot
        check_snapshot(job)
    if not r.canvas_enabled and r.handler == "bed_snapshots_v1":
        from operations.bed_snapshots import check_report_snapshot
        check_report_snapshot(job)
    if not r.canvas_enabled and r.handler == "stock_loans_v1":
        from operations.stock_loans import check_snapshot
        check_snapshot(job)
    if not r.canvas_enabled and r.handler == "medical_indicators_v1":
        from operations.medical_indicators import check_snapshot
        check_snapshot(job)
    if not r.canvas_enabled and r.source == "external_file":
        from operations.external_pdf import check_snapshot
        check_snapshot(job)
    if r.connection_id and job.connection_version != r.connection.version:
        raise PermissionDenied("Conexão alterada.")
    if job.recipient_id:
        g = grant_for(
            r, job.recipient, "automatic" if job.origin == "automatic" else "manual"
        )
        if (
            g.version != job.grant_version
            or job.recipient.version != job.recipient_version
        ):
            raise PermissionDenied("Permissão ou destinatário alterado.")
    if job.requester_id:
        user = job.requester
        if (
            not user.is_active
            or local_permissions(user, job.unit).get("reports", "none") == "none"
        ):
            raise PermissionDenied("Acesso ? seção revogado.")
        if not is_admin(user, job.unit):
            from operations.models import ReportAccess

            allowed = ReportGrant.objects.filter(
                unit=job.unit,
                report=r,
                active=True,
                manual=True,
                recipient__active=True,
                recipient__manual_enabled=True,
                recipient__verified_at__isnull=False,
                recipient__user=user,
            ).exists()
            if r.source == "local":
                allowed = (
                    allowed
                    or ReportAccess.objects.filter(
                        unit=job.unit,
                        user=user,
                        active=True,
                        verified_at__isnull=False,
                        reports=r,
                    ).exists()
                )
            if not r.manual_enabled or not allowed:
                raise PermissionDenied("Relatório não autorizado para o usuário.")
    elif job.origin != "automatic" and not (
        job.origin == "whatsapp"
        and job.recipient_id
        and job.snapshot.get("transport") == "baileys"
    ):
        raise PermissionDenied("Solicitante não identificado.")
    if job.origin == "automatic" and (
        not job.automation_id or not job.automation.enabled
    ):
        raise PermissionDenied("Programação desativada.")


def make_execution(
    report,
    values,
    *,
    user=None,
    recipient=None,
    automation=None,
    origin="panel",
    run_date=None,
    transport=None,
):
    if report.catalog_kind != "report":
        raise ValidationError("Componentes só podem ser executados pelo relatório principal ou em prévia técnica.")
    if report.handler == "occupancy_indicators_v1":
        from operations.occupancy_indicators import prepare_values
        values = prepare_values(report, values, origin=origin, recipient=recipient)
    if report.handler == "medical_indicators_v1":
        from operations.medical_indicators import prepare_values
        values = prepare_values(report, values, origin=origin, recipient=recipient)
    if report.handler == "exams_per_attendance_v1":
        from operations.exams_attendance import prepare_values
        values = prepare_values(report, values, origin=origin, recipient=recipient)
    if report.handler == "lives_indicators_v1":
        from operations.lives_indicators import prepare_values
        values = prepare_values(report, values, origin=origin, recipient=recipient)
    if origin != "automatic" and not report.manual_enabled:
        raise PermissionDenied("Solicitação manual desativada.")
    if user and not is_admin(user, report.unit):
        if recipient and recipient.user_id != user.id:
            raise PermissionDenied("Destinatário não vinculado ao solicitante.")
        if recipient is None:
            grants = list(
                ReportGrant.objects.filter(
                    unit=report.unit,
                    report=report,
                    active=True,
                    manual=True,
                    recipient__active=True,
                    recipient__verified_at__isnull=False,
                    recipient__manual_enabled=True,
                    recipient__user=user,
                ).select_related("recipient")[:2]
            )
            if len(grants) == 1:
                recipient = grants[0].recipient
            elif len(grants) > 1:
                raise ValidationError(
                    "Selecione um destinatário autorizado para a solicitação."
                )
    g = (
        grant_for(report, recipient, "automatic" if origin == "automatic" else "manual")
        if recipient
        else None
    )
    # Per-recipient restrictions cannot be widened by request parameters.
    if g:
        values = {**values, **g.parameters}
    if report.handler == "bed_snapshots_v1":
        from operations.bed_snapshots import prepare_values
        values = prepare_values(report, values)
    elif report.handler == "stock_loans_v1":
        from operations.stock_loans import prepare_values
        values = prepare_values(report, values, origin=origin, recipient=recipient)
    elif report.canvas_enabled:
        from operations.report_canvas.engine import validate_values
        validate_values(report, values)
    elif not report.canvas_enabled and report.source == "local":
        from operations.reports import validate_parameters

        validate_parameters(values)
    else:
        parameters(report, values)
    job = ReportExecution(
        unit=report.unit,
        report=report,
        requester=user,
        recipient=recipient,
        automation=automation,
        origin=origin,
        run_date=run_date,
        parameters=values,
        format=report.output_format,
        definition_version=report.version,
        connection_version=report.connection.version if report.connection_id else None,
        recipient_version=recipient.version if recipient else None,
        grant_version=g.version if g else None,
        snapshot={
            "transport": transport,
            "request_message": report.request_message,
            "parameter_schema": report.parameter_schema,
            "code": report.code,
            "name": report.name,
            "query_sql": report.query_sql,
            "components": report.components,
            "monthly_goals": report.monthly_goals,
            "parameters": values,
            "connection_id": report.connection_id,
        },
        delivery_state="pending_baileys"
        if transport == "baileys" and recipient
        else "blocked_group_transport"
        if recipient and recipient.kind == "group"
        else "blocked_meta_configuration"
        if recipient
        else "not_requested",
    )
    if not report.canvas_enabled and report.handler == "bed_snapshots_v1":
        from operations.bed_snapshots import definition_snapshot
        job.snapshot["bed_history"] = definition_snapshot(report, values)
    if not report.canvas_enabled and report.handler == "medical_indicators_v1":
        from operations.medical_indicators import definition_snapshot
        job.snapshot["medical"] = definition_snapshot(report)
    if not report.canvas_enabled and report.handler == "stock_loans_v1":
        from operations.stock_loans import definition_snapshot
        job.snapshot["stock_loans"] = definition_snapshot(report)
    if not report.canvas_enabled and report.source == "external_file":
        from operations.external_pdf import definition_snapshot
        job.snapshot["external_pdf"] = definition_snapshot(report)
    if report.canvas_enabled:
        from operations.report_canvas.engine import definition_snapshot
        job.snapshot["canvas"] = definition_snapshot(report)
    execution_access(job)
    job.save()
    return job


def collect(report, values, seen=None):
    seen = set(seen or ())
    if report.pk in seen:
        raise ValidationError("Composição circular.")
    seen.add(report.pk)
    if not report.enabled or readiness(report):
        raise ValidationError("Relatório com pendências.")
    if report.source == "sql":
        headers, rows = run_query(report, values)
        return [(report.name, headers, rows)]
    if report.source == "composite":
        output = []
        for entry in report.components:
            child = ReportDefinition.objects.get(unit=report.unit, code=entry["code"])
            child_values = {
                **{k: v for k, v in values.items() if k in child.parameter_schema},
                **entry.get("parameters", {}),
            }
            output.extend(collect(child, child_values, seen))
        if len(output) > 30:
            raise ValidationError("Composição excede 30 partes.")
        return output
    # Existing local operational reports keep their original handler and access checks.
    raise ValidationError("Use a geração operacional existente para esta fonte.")


@shared_task(name="operations.catalog_report", soft_time_limit=120, time_limit=150)
def execute_report(job_id):
    with transaction.atomic():
        job = (
            ReportExecution.objects.select_for_update(of=("self",))
            .select_related(
                "report__connection", "recipient", "unit", "requester", "automation"
            )
            .get(pk=job_id)
        )
        if job.state != "pending":
            return
        job.state = "running"
        job.save(update_fields=["state"])
    try:
        execution_access(job)
        if job.report.canvas_enabled:
            from operations.report_canvas.engine import generate as generate_canvas
            result, count = generate_canvas(job)
        elif job.report.handler == "bed_snapshots_v1":
            from operations.bed_snapshots import generate as generate_bed_history
            result, count = generate_bed_history(job)
        elif job.report.handler == "stock_loans_v1":
            from operations.stock_loans import generate as generate_stock_loans
            result, count = generate_stock_loans(job)
        elif job.report.handler == "medical_indicators_v1":
            if job.format != "pdf":
                raise ValidationError("Indicadores Médicos exigem formato PDF.")
            from operations.medical_indicators import generate as generate_medical
            result, count = generate_medical(job)
        elif job.report.source == "external_file":
            from operations.external_pdf import generate as generate_external_pdf
            result, count = generate_external_pdf(job)
        elif job.report.source == "local":
            from operations.models import ReportRequest
            from operations.reports import generate

            if job.recipient_id and job.snapshot.get("transport") == "baileys":
                from operations.reports import local_report_content

                result, count = local_report_content(job)
            else:
                if not job.requester:
                    raise ValidationError(
                        "Relatório operacional exige usuário vinculado."
                    )
                original = ReportRequest.objects.create(
                    unit=job.unit,
                    report=job.report,
                    requester=job.requester,
                    parameters=job.parameters,
                    format=job.format,
                    definition_version=job.definition_version,
                )
                generate(original.pk)
                original.refresh_from_db()
                if original.state != "ready":
                    raise ValidationError("Falha no relatório operacional.")
                result, count = original.result, 0
        else:
            sections = collect(job.report, job.parameters)
            count = sum(len(x[2]) for x in sections)
            if job.format == "pdf" and len(sections) > 1:
                import io

                from pypdf import PdfReader, PdfWriter

                writer = PdfWriter()
                for name, headers, rows in sections:
                    writer.append(
                        PdfReader(
                            io.BytesIO(
                                base64.b64decode(render(name, headers, rows, "pdf"))
                            )
                        )
                    )
                out = io.BytesIO()
                writer.write(out)
                result = base64.b64encode(out.getvalue()).decode()
            elif job.format == "xlsx":
                from operations.report_engine import render_workbook
                result = render_workbook(sections)
            elif len(sections) == 1:
                name, headers, rows = sections[0]
                result = render(name, headers, rows, job.format)
            else:
                result = "\n\n".join(
                    name + "\n" + render(name, headers, rows, job.format)
                    for name, headers, rows in sections
                )
        no_data = count == 0 and job.snapshot.get("transport") == "baileys"
        if no_data:
            result = ""
        if len(result.encode()) > 10 * 1024 * 1024:
            raise ValidationError("Resultado excede 10 MB.")
        job.refresh_from_db()
        execution_access(job)
        if no_data:
            job.snapshot["no_data"] = True
            job.save(update_fields=["snapshot"])
        job.result, job.row_count, job.state = result, count, "ready"
    except PermissionDenied:
        job.state, job.error_code = "blocked", "access_changed"
    except ValidationError:
        job.state, job.error_code = "failed", "definition_or_parameters_invalid"
    except Exception:  # noqa: BLE001 - do not expose driver credentials or source data
        job.state, job.error_code = "failed", "query_failed"
    job.completed_at = timezone.now()
    job.save(
        update_fields=["result", "row_count", "state", "error_code", "completed_at"]
    )

    from operations.report_whatsapp import enqueue_delivery

    enqueue_delivery(job)


def enqueue(job):
    if settings.ASYNC_TASKS:
        transaction.on_commit(lambda: execute_report.delay(str(job.pk)))
    else:
        execute_report(job.pk)


def tick_reports():
    for pk in ReportAutomation.objects.filter(
        enabled=True, report__enabled=True, report__catalog_kind="report"
    ).values_list("pk", flat=True):
        with transaction.atomic():
            item = (
                ReportAutomation.objects.select_for_update(of=("self",))
                .select_related("unit", "report__connection", "recipient")
                .get(pk=pk)
            )
            now = timezone.localtime(timezone.now(), ZoneInfo(item.unit.timezone))
            if (
                not item.enabled
                or now.weekday() not in item.weekdays
                or now.time().replace(tzinfo=None) < item.send_time
                or ReportExecution.objects.filter(
                    automation=item, run_date=now.date()
                ).exists()
            ):
                continue
            from operations.models import ReportWhatsAppConfiguration
            from operations.report_whatsapp import allowed

            config = ReportWhatsAppConfiguration.objects.filter(unit=item.unit).first()
            if not allowed(config, "automatic"):
                continue
            try:
                job = make_execution(
                    item.report,
                    item.parameters,
                    recipient=item.recipient,
                    automation=item,
                    origin="automatic",
                    run_date=now.date(),
                    transport="baileys",
                )
            except (ValidationError, PermissionDenied):
                continue
            enqueue(job)


def inbound_catalog(event, unit):
    """Explicit commands only; group identity must come from provider metadata."""
    from operations.models import ReportRecipient

    text = str(event.data.get("text", "")).strip()
    if not text.upper().startswith("RELATORIO "):
        return False
    # Cloud API has no native group addressing. No sender-to-group inference.
    sender = str(event.data.get("sender", ""))
    recipients = ReportRecipient.objects.filter(
        unit=unit,
        kind="phone",
        active=True,
        manual_enabled=True,
        verified_at__isnull=False,
        address=sender,
    )
    if not recipients.exists():
        return False  # Preserve the existing operational report command handler.
    command = text[len("RELATORIO ") :].strip()
    result = "unavailable"
    try:
        keyword, _, raw = command.partition(" {")
        values = __import__("json").loads("{" + raw) if raw else {}
        candidates = []
        for grant in ReportGrant.objects.filter(
            unit=unit,
            recipient__in=recipients,
            active=True,
            manual=True,
            report__enabled=True,
            report__manual_enabled=True,
            report__catalog_kind="report",
        ).select_related("report__connection", "recipient__user"):
            if any(
                k.casefold() == keyword.casefold()
                for k in [grant.report.keyword, *grant.report.keywords]
                if k
            ):
                candidates.append(grant)
        if len(candidates) == 1:
            grant = candidates[0]
            user = grant.recipient.user
            if (
                user
                and user.is_active
                and not ReportExecution.objects.filter(
                    snapshot__inbound_event=str(event.pk), unit=unit
                ).exists()
            ):
                job = make_execution(
                    grant.report,
                    values,
                    user=user,
                    recipient=grant.recipient,
                    origin="whatsapp",
                )
                job.snapshot["inbound_event"] = str(event.pk)
                job.save(update_fields=["snapshot"])
                enqueue(job)
                result = "requested"
    except Exception:  # noqa: BLE001 - do not expose driver credentials or source data
        result = "unavailable"
    event.data = {**event.data, "report_command_result": result}
    event.processed = True
    event.save(update_fields=["data", "processed"])
    return True
