"""Run via Django shell. Read-only homologation metadata/counts, never imports rows."""
import json
import os
from datetime import datetime, time, timedelta

from django.utils import timezone
from core.models import Unit
from core.oracle_credentials import connection_payload
from scheduling.connectors import OracleSource
from scheduling.models import OracleAgenda
from scheduling.oracle_agendas import IDENTIFIER, safe_error, safe_view, window_dates


def check():
    unit = Unit.objects.get(slug=os.environ.get("ORBITA_REGRESSION_UNIT", "sansaude"))
    payload = connection_payload(unit)
    if not payload or not any(word in payload["identifier"].upper() for word in ("HML", "HOMOLOG")):
        raise ValueError("homologation_target_required")
    agendas = OracleAgenda.objects.filter(unit=unit, deleted_at__isnull=True)
    if not agendas.exists():
        raise ValueError("oracle_agenda_not_configured")
    results = []
    for agenda in agendas:
        view = safe_view(agenda.view_name)
        date_column = agenda.column_mapping["date"]
        id_column = agenda.column_mapping["external_id"]
        if not all(IDENTIFIER.fullmatch(name) for name in (date_column, id_column)):
            raise ValueError("invalid_source_column")
        dates = window_dates(agenda, timezone.now())
        with OracleSource(unit).connect() as db:
            try:
                with db.cursor() as cursor:
                    cursor.execute("SET TRANSACTION READ ONLY")
                    cursor.execute(f"SELECT * FROM {view} WHERE 1=0")
                    columns = {col[0] for col in cursor.description}
                    mapped = {v for v in agenda.column_mapping.values() if isinstance(v, str) and v}
                    mapped.update(agenda.column_mapping["phone_columns"])
                    mapped.update(v["column"] for v in agenda.parameter_mapping.values())
                    if not mapped <= columns:
                        raise ValueError("source_column_missing")
                    cursor.execute(f"SELECT COUNT(*), COUNT(DISTINCT {id_column}) FROM {view} WHERE {date_column} >= :start_day AND {date_column} < :end_day", start_day=datetime.combine(dates[0], time.min), end_day=datetime.combine(dates[-1] + timedelta(days=1), time.min))
                    rows, unique = cursor.fetchone()
            finally:
                db.rollback()
        results.append({"agenda_id":agenda.pk, "view":view, "window_start":dates[0].isoformat(), "window_end":dates[-1].isoformat(), "mapped_columns":len(mapped), "source_rows":rows, "unique_appointments":unique, "read_only":True, "rollback":True})
    return {"status":"ok", "unit":unit.slug, "homologation":True, "agendas":results, "patient_rows_exported":0, "imports_created":0}

try:
    print(json.dumps(check(), ensure_ascii=False))
except Exception as exc:
    code = "homologation_target_required" if str(exc) == "homologation_target_required" else safe_error(exc)
    print(json.dumps({"status":"failed", "code":code}))
    raise SystemExit(1) from None
