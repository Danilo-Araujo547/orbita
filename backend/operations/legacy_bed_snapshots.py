"""Import real Firebird daily positions without inventing their capture timestamps."""
import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.models import Audit
from operations.models import BedSnapshotRow, ReportSnapshotConfiguration, ReportSnapshotRun
from operations.bed_snapshots import HEADERS, definition, parse_rows


def canonical_hash(rows, reference_date):
    data = [[row.ward_code, row.ward_name, row.quantity, reference_date.isoformat()]
            for row in sorted(rows, key=lambda row: row.ward_code)]
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


@transaction.atomic
def import_history(configuration, payload, *, checksum, actor=None):
    config = ReportSnapshotConfiguration.objects.select_for_update(of=("self",)).select_related(
        "unit", "source_report__connection", "output_report").get(pk=configuration.pk, unit_id=configuration.unit_id)
    definition(config)  # Validate the unit/report relationship; never connect to Oracle.
    if (not isinstance(payload, dict) or payload.get("environment") != "production"
        or payload.get("source_table") != "LEITOS_SISTEMA" or payload.get("captured_time_known") is not False
        or not payload.get("source_host") or not payload.get("source_database")):
        raise ValidationError("Identifique a origem real e a ausência do horário de captura no legado.")
    try:
        start, end = date.fromisoformat(payload["start"]), date.fromisoformat(payload["end"])
    except (KeyError, TypeError, ValueError):
        raise ValidationError("Período da importação inválido.") from None
    from zoneinfo import ZoneInfo
    today = timezone.localtime(timezone.now(), ZoneInfo(config.unit.timezone)).date()
    if end < start or end >= today or (end-start).days > 365:
        raise ValidationError("Use até 366 dias anteriores a hoje.")
    raw = payload.get("rows")
    if not isinstance(raw, list) or not raw or len(raw) > 100000:
        raise ValidationError("Arquivo sem dados ou acima do limite de linhas.")
    grouped = defaultdict(list)
    for item in raw:
        if not isinstance(item, dict) or set(item) != set(HEADERS):
            raise ValidationError("Colunas incompatíveis com o histórico de leitos.")
        try: day = date.fromisoformat(str(item["DATA"])[:10])
        except (ValueError, TypeError): raise ValidationError("Data histórica inválida.") from None
        if not start <= day <= end: raise ValidationError("Registro fora do período declarado.")
        grouped[day].append([item[key] for key in HEADERS])
    validated = {day: parse_rows(HEADERS, values, config, day) for day, values in grouped.items()}
    identity = {"unit": config.unit_id, "configuration": config.pk, "kind": "legacy_import",
        "environment": "production", "source_host": str(payload["source_host"]),
        "source_database": str(payload["source_database"]), "source_table": "LEITOS_SISTEMA"}
    dataset_key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    now = timezone.now()
    inserted, unchanged, absent, total = 0, 0, [], 0
    for index in range((end-start).days+1):
        day = start + timedelta(days=index)
        rows = validated.get(day, [])
        row_hash = canonical_hash(rows, day)
        manifest = {**identity, "dataset_key": dataset_key, "source_file_sha256": checksum,
            "content_sha256": row_hash, "captured_time_known": False, "expected_weekdays": list(range(7))}
        run, created = ReportSnapshotRun.objects.select_for_update(of=("self",)).get_or_create(
            configuration=config, unit_id=config.unit_id, dataset_key=dataset_key, reference_date=day,
            defaults={"origin": "legacy", "requester": actor, "configuration_version": config.version,
                      "source_snapshot": manifest, "scheduled_for": None, "requested_at": now})
        if run.origin != "legacy": raise ValidationError("Conflito com outra origem de coleta.")
        if run.state == "ready":
            existing = list(run.rows.filter(unit_id=config.unit_id))
            if canonical_hash(existing, day) != row_hash or len(existing) != len(rows):
                raise ValidationError("O arquivo conflita com uma snapshot já preservada: " + day.isoformat())
            unchanged += 1; total += len(rows)
            continue
        if run.rows.exists(): raise ValidationError("Snapshot incompleta exige revisão antes da importação.")
        if rows:
            for row in rows: row.run = run
            BedSnapshotRow.objects.bulk_create(rows)
            run.state, run.error_code = "ready", ""
            inserted += 1; total += len(rows)
        else:
            run.state, run.error_code = "missed", "legacy_snapshot_unavailable"
            absent.append(day.isoformat())
        run.source_snapshot, run.row_count = manifest, len(rows)
        run.scheduled_for = run.started_at = run.captured_at = run.source_at = None
        run.completed_at = now
        run.save()
    summary = {"configuration": config.pk, "dataset_key": dataset_key, "start": start.isoformat(), "end": end.isoformat(),
        "imported_days": inserted, "unchanged_days": unchanged, "missing_dates": absent, "rows": total,
        "environment": "production", "source_host": identity["source_host"], "source_file_sha256": checksum}
    Audit.objects.create(unit_id=config.unit_id, actor=actor, action="report_snapshot.legacy_imported",
        object_id=str(config.pk), details=summary)
    return summary
