"""Oracle-only medical report: bounded queries, one read-only transaction, versioned art."""
import base64
import hashlib
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from operations.report_engine import connect, parameters, run_query

HANDLER = "medical_indicators_v1"
PARTS = ("stays", "attendances", "exams", "opinions_months", "opinions_days")
ASSET_VERSION = "v1"

def asset_root():
    return Path(getattr(settings, "REPORT_FILES_ROOT", "/app/files")) / "reports" / "indicadores-medicos" / ASSET_VERSION

def children(report):
    from operations.models import ReportDefinition
    entries = report.components
    if [e.get("code") for e in entries] != ["medical-" + p.replace("_", "-") for p in PARTS]:
        raise ValidationError("Revisar componentes dos Indicadores Médicos.")
    output = []
    for part, entry in zip(PARTS, entries):
        child = ReportDefinition.objects.select_related("connection").filter(unit=report.unit, code=entry["code"]).first()
        if not child or child.source != "sql" or child.connection_id != report.connection_id or child.connection.engine != "oracle":
            raise ValidationError("Indicadores Médicos exigem a mesma conexão Oracle nos componentes.")
        output.append((part, child))
    return output

def definition_snapshot(report):
    manifest = {"handler": HANDLER, "assets": ASSET_VERSION, "children": []}
    for part, child in children(report):
        manifest["children"].append({"part": part, "id": child.pk, "version": child.version, "connection": child.connection_id, "connection_version": child.connection.version})
    manifest["asset_hashes"] = {}
    for name in ("first-background.jpg", "last-background.jpg", "logo.png", "arial.ttf", "arialbd.ttf", "layout.json"):
        p = asset_root() / name
        if not p.is_file():
            raise ValidationError("Arquivo do layout dos Indicadores Médicos indisponível.")
        manifest["asset_hashes"][name] = hashlib.sha256(p.read_bytes()).hexdigest()
    return manifest

def check_snapshot(job):
    if job.snapshot.get("medical") != definition_snapshot(job.report):
        raise PermissionDenied("Consultas ou arquivos do relatório foram alterados.")

def prepare_values(report, values, *, origin, recipient):
    if not ((origin == "panel" and recipient is None) or (origin == "whatsapp" and recipient is not None)):
        raise PermissionDenied("Indicadores Médicos: geração manual no painel ou pelo WhatsApp autorizado; programação automática bloqueada.")
    parsed = parameters(report, values)
    today = timezone.localtime(timezone.now(), ZoneInfo(report.unit.timezone)).date()
    ref = parsed.get("data_referencia") or today
    if ref > today or ref.year < 2023:
        raise ValidationError("Data de referência inválida.")
    return {"data_referencia": ref.isoformat()}

def records(headers, rows):
    return [dict(zip(headers, row)) for row in rows]

def collect_data(report, values):
    ref = parameters(report, values)["data_referencia"]
    if ref is None:
        raise ValidationError("Data de referência obrigatória na execução.")
    binds = {"inicio": date(ref.year - 1, 1, 1).isoformat(), "fim_exclusivo": ref.isoformat()}
    parts = children(report)
    if not report.connection.enabled or not report.connection.validated:
        raise ValidationError("Conexão Oracle indisponível.")
    data = {}
    # All sections use the same Oracle snapshot; no Firebird, procedures or intermediate patient cache.
    with connect(report.connection) as session:
        for part, child in parts:
            headers, rows = run_query(child, binds, session=session)
            data[part] = records(headers, rows)
    for name in ("attendances", "exams"):
        days = [{"DATA": r["DIA"][:10], "QUANTIDADE": r["TOTAL"]} for r in data[name]]
        data[name + "_days"] = days
        from collections import defaultdict
        sums = defaultdict(int)
        for r in days:
            d = date.fromisoformat(r["DATA"]);sums[(d.year, d.month)] += int(r["QUANTIDADE"])
        data[name] = [{"ANO": y, "MES": m, "QUANTIDADE": n} for (y, m), n in sorted(sums.items())]
    latest = {
        "internacao": max((r["ULTIMA_DATA"][:10] for r in data["stays"]), default=None),
        "atendimentos": max((r["DATA"] for r in data["attendances_days"]), default=None),
        "exames": max((r["DATA"] for r in data["exams_days"]), default=None),
        "parecer": max((r["DATA"] for r in data["opinions_days"]), default=None),
    }
    if any(v is None for v in latest.values()):
        raise ValidationError("Fonte sem dados no período; revisar antes de gerar o relatório.")
    data["freshness"] = {k: [{"ULTIMA_ALTA" if k == "internacao" else "ULTIMA_DATA": v}] for k, v in latest.items()}
    data["clock"] = [{"DB_TIMESTAMP": datetime.combine(ref, datetime.min.time()).isoformat()}]
    data["generated_at"] = timezone.localtime(timezone.now(), ZoneInfo(report.unit.timezone)).isoformat()
    return data

def generate(job):
    from operations.medical_layout import render_medical_pdf
    check_snapshot(job)
    data = collect_data(job.report, job.parameters)
    result = render_medical_pdf(data, asset_root())
    job.snapshot["data_environment"] = "homologacao"
    job.snapshot["source_dates"] = data["freshness"]
    job.snapshot["asset_version"] = ASSET_VERSION
    job.save(update_fields=["snapshot"])
    return base64.b64encode(result).decode(), sum(len(data[p]) for p in PARTS)
