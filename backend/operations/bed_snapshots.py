"""Daily Oracle bed positions, archived locally. Collection never invokes transport."""
import base64
import hashlib
import io
import json
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from core.models import Audit
from operations.models import BedSnapshotRow, ReportSnapshotConfiguration, ReportSnapshotRun, ReportSnapshotDataRow
from operations.report_engine import parameters, run_query, sql_contract

HANDLER = "bed_snapshots_v1"
HEADERS = ["CD_UNID_INT", "DS_UNID_INT", "QUANTIDADE", "DATA"]
STATES = {"pending", "running", "ready", "failed", "missed"}


class SnapshotError(ValidationError):
    def __init__(self, code, message):
        self.snapshot_code = code
        super().__init__(message, code=code)


def definition(config, *, require_source=False):
    from operations.snapshot_datasets import contract
    contract(config, require_source=require_source)
    source = config.source_report
    conn = source.connection
    if (source.unit_id != config.unit_id or config.output_report.unit_id != config.unit_id
        or source.catalog_kind != "component" or source.source != "sql" or not conn
        or conn.unit_id != config.unit_id or conn.engine != "oracle"):
        raise SnapshotError("invalid_source", "Selecione um componente Oracle da mesma unidade, sem parâmetros.")
    if require_source and (not source.enabled or not source.reviewed or not conn.enabled or not conn.validated):
        raise SnapshotError("source_unavailable", "Componente ou conexão Oracle indisponível.")
    if config.dataset_kind == "beds" and config.output_report.handler != HANDLER:
        raise SnapshotError("invalid_report", "Selecione o relatório de histórico de leitos.")
    if source.query_sql.strip():
        sql_contract(source.query_sql, source.parameter_schema, "oracle")
    elif require_source or config.dataset_kind != "capacity":
        raise SnapshotError("source_unavailable", "Cadastre uma query de coleta validada.")
    data = {"unit": config.unit_id, "configuration": config.pk, "source": source.pk,
            "sql": source.query_sql, "connection": conn.pk, "host": conn.host,
            "port": conn.port, "database": conn.database, "environment": config.environment,
            "timezone": config.unit.timezone, "username": conn.username, "options": conn.options}
    if config.dataset_kind != "beds":
        data.update(dataset_kind=config.dataset_kind, reference_offset_days=config.reference_offset_days)
    key = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    return {**data, "dataset_key": key, "source_version": source.version, "connection_version": conn.version}


def config_for(report):
    config = ReportSnapshotConfiguration.objects.select_related(
        "unit", "source_report__connection", "output_report"
    ).filter(unit_id=report.unit_id, output_report=report).first()
    if not config:
        raise SnapshotError("missing_configuration", "Configure a coleta diária de leitos.")
    return config


def report_readiness(report):
    try:
        definition(config_for(report))
        if report.output_format != "xlsx":
            return ["A exportação de leitos exige formato XLSX"]
    except ValidationError as exc:
        return [str(exc.detail)]
    return []


def definition_snapshot(report, values=None):
    config = config_for(report)
    if values is not None:
        _, runs = export_selection(report, values)
        if runs[0].origin == "legacy":
            return {"configuration": config.pk, "dataset_key": runs[0].dataset_key,
                    "environment": "production", "origin": "legacy"}
    manifest = definition(config)
    return {"configuration": config.pk, "dataset_key": manifest["dataset_key"], "environment": config.environment}


def check_report_snapshot(job):
    if job.snapshot.get("bed_history") != definition_snapshot(job.report, job.parameters):
        raise PermissionDenied("A origem do histórico foi alterada.")


def missing_dates(config, runs, start, end):
    weekdays = list(range(7)) if runs and runs[0].origin == "legacy" else config.weekdays
    expected = {start + timedelta(days=i) for i in range((end-start).days+1)
                if (start+timedelta(days=i)).weekday() in weekdays}
    return sorted(expected - {run.reference_date for run in runs})


def export_selection(report, values):
    parsed = parameters(report, values)
    start, end = parsed.get("WPA_DATA_INICIAL"), parsed.get("WPA_DATA_FINAL")
    config = config_for(report)
    today = timezone.localtime(timezone.now(), ZoneInfo(config.unit.timezone)).date()
    if not start or not end or end < start or (end-start).days > 366 or end > today:
        raise ValidationError("Informe um período de até 366 dias, sem datas futuras.")
    base = ReportSnapshotRun.objects.filter(unit_id=report.unit_id, configuration=config,
        reference_date__range=(start, end), state="ready")
    key = definition(config)["dataset_key"]
    current = list(base.filter(dataset_key=key, origin__in=["manual", "scheduled"]).order_by("reference_date"))
    archived = list(base.filter(origin="legacy", source_snapshot__kind="legacy_import",
        source_snapshot__environment="production").order_by("reference_date"))
    if current and archived:
        raise SnapshotError("mixed_sources", "O período reúne homologação e legado de produção. Consulte os períodos separadamente.")
    runs = archived or current
    if archived and len({run.dataset_key for run in archived}) != 1:
        raise SnapshotError("mixed_sources", "O período reúne arquivos de origens diferentes.")
    missing = missing_dates(config, runs, start, end)
    if missing and not archived:
        raise SnapshotError("missing_snapshots", "Sem snapshot nas datas: " + ", ".join(d.strftime("%d/%m/%Y") for d in missing[:8]) + ("…" if len(missing)>8 else ""))
    if not runs:
        raise SnapshotError("missing_snapshots", "Não existem snapshots nesse período.")
    if sum(run.row_count for run in runs) > 100000:
        raise ValidationError("Período excede 100.000 linhas.")
    return config, runs


def prepare_values(report, values):
    export_selection(report, values)
    return values


def generate(job):
    check_report_snapshot(job)
    config, runs = export_selection(job.report, job.parameters)
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    book = Workbook()
    sheet = book.active
    sheet.title = "LEITOS_SISTEMA"
    sheet.append(HEADERS)
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "A2"
    sheet.sheet_properties.tabColor = "145A86"
    sheet.row_dimensions[1].height = 28
    for cell in sheet[1]:
        cell.font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="145A86")
        cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    boundary = Side(style="thin", color="8EB6D0")
    previous_date, band = None, -1
    rows = BedSnapshotRow.objects.filter(unit_id=job.unit_id, run__in=runs).select_related("run").order_by("run__reference_date", "ward_code")
    count = 0
    for index, row in enumerate(rows.iterator(chunk_size=1000), 2):
        sheet.append([row.ward_code, row.ward_name, row.quantity, datetime.combine(row.run.reference_date, time.min)])
        # Explicit strings prevent a renamed ward from becoming a spreadsheet formula.
        sheet.cell(index, 2).data_type = "s"
        sheet.cell(index, 4).number_format = "dd/mm/yyyy"
        new_day = row.run.reference_date != previous_date
        if new_day:
            band += 1
        for column in range(1, 5):
            cell = sheet.cell(index, column)
            cell.font = Font(name="Arial", size=10, color="253949", bold=new_day and column == 4)
            cell.fill = PatternFill("solid", fgColor="EDF5FB" if band % 2 == 0 else "FFFFFF")
            cell.alignment = Alignment(horizontal="left" if column == 2 else "center", vertical="center", indent=1 if column == 2 else 0)
            if new_day:
                cell.border = Border(top=boundary)
        sheet.row_dimensions[index].height = 21
        previous_date = row.run.reference_date
        count += 1
    sheet.auto_filter.ref = f"A1:D{sheet.max_row}"
    sheet.print_title_rows = "1:1"
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = "portrait"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    for column, width in zip("ABCD", (17, 46, 17, 17)):
        sheet.column_dimensions[column].width = width
    out = io.BytesIO()
    book.save(out)
    job.snapshot["snapshot_runs"] = [{"id": str(r.pk), "date": r.reference_date.isoformat(),
        "captured_at": r.captured_at.isoformat() if r.captured_at else None, "source_at": r.source_at.isoformat() if r.source_at else None,
        "imported_at": r.requested_at.isoformat() if r.origin == "legacy" else None} for r in runs]
    legacy = runs[0].origin == "legacy"
    job.snapshot["data_environment"] = "production" if legacy else config.environment
    job.snapshot["data_origin"] = "legacy" if legacy else "current"
    parsed = parameters(job.report, job.parameters)
    job.snapshot["missing_dates"] = [day.isoformat() for day in missing_dates(config, runs, parsed["WPA_DATA_INICIAL"], parsed["WPA_DATA_FINAL"])]
    job.save(update_fields=["snapshot"])
    return base64.b64encode(out.getvalue()).decode(), count


def parse_rows(headers, values, config, reference_date):
    if [str(h).upper() for h in headers] != HEADERS or not values:
        raise SnapshotError("invalid_result", "A coleta exige as quatro colunas de leitos e ao menos uma linha.")
    zone = ZoneInfo(config.unit.timezone)
    seen, rows = set(), []
    for code, name, quantity, source_at in values:
        try:
            code_value, qty = Decimal(str(code)), Decimal(str(quantity))
            if not code_value.is_finite() or not qty.is_finite() or code_value != code_value.to_integral() or qty != qty.to_integral():
                raise ValueError()
            code_value, qty = int(code_value), int(qty)
            if not 1 <= code_value <= 2147483647 or not 0 <= qty <= 2147483647 or code_value in seen:
                raise ValueError()
            stamp = datetime.fromisoformat(str(source_at))
            if timezone.is_naive(stamp): stamp = stamp.replace(tzinfo=zone)
            if stamp.astimezone(zone).date() != reference_date: raise ValueError()
            if not isinstance(name, str) or not name.strip() or len(name) > 150: raise ValueError()
        except (ValueError, TypeError, InvalidOperation, OverflowError):
            raise SnapshotError("invalid_result", "Unidade, quantidade, data ou duplicidade inválida na origem.") from None
        seen.add(code_value)
        rows.append(BedSnapshotRow(unit_id=config.unit_id, ward_code=code_value, ward_name=name, quantity=qty, source_at=stamp))
    return rows


def allowed_actor(user, unit):
    if user is None: return True
    from django.contrib.auth import get_user_model
    user = get_user_model().objects.filter(pk=user.pk).first()
    if user is None: return False
    from core.access import local_permissions
    from operations.reporting import is_admin
    return user.is_active and is_admin(user, unit) and local_permissions(user, unit).get("reports") == "write"


def enqueue_collection(run_id):
    if settings.ASYNC_TASKS:
        collect_snapshot.delay(str(run_id))
    else:
        collect_snapshot(str(run_id))


@transaction.atomic
def queue_collection(config_id, *, origin="manual", user=None, now=None, dispatch=True):
    now = now or timezone.now()
    config = ReportSnapshotConfiguration.objects.select_for_update(of=("self",)).select_related(
        "unit", "source_report__connection", "output_report").get(pk=config_id)
    if not allowed_actor(user, config.unit): raise PermissionDenied("Sem acesso à coleta.")
    if origin == "scheduled" and not config.enabled: return None
    manifest = definition(config, require_source=True)
    local = timezone.localtime(now, ZoneInfo(config.unit.timezone))
    scheduled = datetime.combine(local.date(), config.collection_time, ZoneInfo(config.unit.timezone))
    if origin == "scheduled" and (local.weekday() not in config.weekdays or local < scheduled): return None
    expired = local > scheduled + timedelta(minutes=config.window_minutes)
    run, created = ReportSnapshotRun.objects.select_for_update(of=("self",)).get_or_create(
        configuration=config, dataset_key=manifest["dataset_key"], reference_date=local.date()+timedelta(days=config.reference_offset_days),
        defaults={"unit_id": config.unit_id, "origin": origin, "requester": user,
                  "configuration_version": config.version, "source_snapshot": manifest, "scheduled_for": scheduled})
    if run.state == "ready": return run
    stale = (now - (run.started_at or run.requested_at)).total_seconds() > 300
    if not created and run.state in {"pending", "running"} and not stale: return run
    if origin == "scheduled" and expired:
        run.state, run.error_code = "missed", "collection_window_missed"
        run.completed_at = now
        run.save(update_fields=["state", "error_code", "completed_at"])
        return run
    if origin == "scheduled" and not created and (run.attempt_count >= 3 or (now-run.requested_at).total_seconds() < 300): return run
    run.state, run.error_code = "pending", ""
    run.configuration_version, run.source_snapshot = config.version, manifest
    run.requester, run.origin, run.requested_at = user, origin, now
    run.save()
    if dispatch: transaction.on_commit(lambda: enqueue_collection(run.pk))
    return run


@shared_task(name="operations.collect_bed_snapshot", soft_time_limit=120, time_limit=150)
def collect_snapshot(run_id):
    run_stub = ReportSnapshotRun.objects.get(pk=run_id)
    with transaction.atomic():
        config = ReportSnapshotConfiguration.objects.select_for_update(of=("self",)).select_related(
            "unit", "source_report__connection", "output_report").get(pk=run_stub.configuration_id)
        run = ReportSnapshotRun.objects.select_for_update(of=("self",)).select_related("requester").get(pk=run_id)
        if run.state != "pending": return
        run.state, run.claim_token = "running", uuid.uuid4()
        run.started_at = timezone.now()
        run.attempt_count += 1
        run.save(update_fields=["state", "claim_token", "started_at", "attempt_count"])
        token = run.claim_token
    try:
        manifest = definition(config, require_source=True)
        if run.unit_id != config.unit_id:
            raise SnapshotError("invalid_source", "Unidade incompatível.")
        if manifest != run.source_snapshot or config.version != run.configuration_version:
            raise SnapshotError("source_changed", "Configuração alterada antes da coleta.")
        if not allowed_actor(run.requester, config.unit) or (run.origin == "scheduled" and not config.enabled):
            raise SnapshotError("collection_paused", "Coleta desativada ou acesso revogado.")
        local = timezone.localtime(timezone.now(), ZoneInfo(config.unit.timezone))
        if (not run.scheduled_for or local.date() != run.scheduled_for.astimezone(ZoneInfo(config.unit.timezone)).date()
            or local.date()+timedelta(days=config.reference_offset_days) != run.reference_date
            or (run.origin == "scheduled" and local > run.scheduled_for + timedelta(minutes=config.window_minutes))):
            raise SnapshotError("collection_window_missed", "Janela de coleta encerrada.")
        binds = {"data_alvo": run.reference_date.isoformat()} if config.dataset_kind == "lives" else {}
        headers, values = run_query(config.source_report, binds)
        if config.dataset_kind == "beds":
            rows = parse_rows(headers, values, config, run.reference_date)
        else:
            from operations.snapshot_datasets import parse_rows as parse_dataset_rows
            rows = parse_dataset_rows(headers, values, config, run.reference_date)
        captured = timezone.now()
        if timezone.localtime(captured, ZoneInfo(config.unit.timezone)).date() != local.date():
            raise SnapshotError("collection_window_missed", "A coleta atravessou a mudança de dia.")
        with transaction.atomic():
            fresh = ReportSnapshotConfiguration.objects.select_for_update(of=("self",)).select_related(
                "unit", "source_report__connection", "output_report").get(pk=config.pk)
            current = ReportSnapshotRun.objects.select_for_update(of=("self",)).get(pk=run_id)
            if current.state != "running" or current.claim_token != token: return
            if (fresh.version != run.configuration_version or definition(fresh, require_source=True) != manifest
                or not allowed_actor(run.requester, fresh.unit) or (run.origin == "scheduled" and not fresh.enabled)):
                raise SnapshotError("source_changed", "Configuração alterada durante a coleta.")
            for row in rows: row.run = current
            (BedSnapshotRow if config.dataset_kind == "beds" else ReportSnapshotDataRow).objects.bulk_create(rows)
            current.state, current.captured_at, current.completed_at = "ready", captured, timezone.now()
            current.source_at = min(r.source_at for r in rows) if config.dataset_kind == "beds" else datetime.combine(run.reference_date, time.min, ZoneInfo(config.unit.timezone))
            current.row_count = len(rows)
            current.error_code = ""
            current.save()
            Audit.objects.create(unit_id=config.unit_id, actor=run.requester, action="report_snapshot.collected",
                object_id=str(run_id), details={"configuration": config.pk, "rows": len(rows), "environment": config.environment})
    except Exception as exc:
        error = exc.snapshot_code if isinstance(exc, SnapshotError) else "source_query_failed"
        with transaction.atomic():
            current = ReportSnapshotRun.objects.select_for_update(of=("self",)).get(pk=run_id)
            if current.state == "running" and current.claim_token == token:
                current.state, current.error_code, current.completed_at = "failed", error, timezone.now()
                current.save(update_fields=["state", "error_code", "completed_at"])
                Audit.objects.create(unit_id=config.unit_id, actor=run.requester, action="report_snapshot.failed",
                    object_id=str(run_id), details={"configuration": config.pk, "error_code": error})


@shared_task(name="operations.tick_bed_snapshots")
def tick_snapshots():
    for pk in ReportSnapshotConfiguration.objects.filter(enabled=True).values_list("pk", flat=True):
        try:
            queue_collection(pk, origin="scheduled")
        except Exception:
            # One unavailable source must not prevent other units from collecting.
            unit_id = ReportSnapshotConfiguration.objects.get(pk=pk).unit_id
            if not Audit.objects.filter(unit_id=unit_id, action="report_snapshot.scheduler_failed", object_id=str(pk),
                created_at__gte=timezone.now()-timedelta(minutes=5)).exists():
                Audit.objects.create(unit_id=unit_id, action="report_snapshot.scheduler_failed", object_id=str(pk), details={"error_code": "source_unavailable"})
