"""Import approved aggregate histories; never invent missing days or capture clocks."""
import hashlib
import json
import re
from datetime import date
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from core.models import Audit
from .models import ReportSnapshotConfiguration, ReportSnapshotRun, ReportSnapshotDataRow
from .bed_snapshots import allowed_actor
from .snapshot_datasets import parse_rows


@transaction.atomic
def import_history(config, batches, *, source_table, checksum, actor):
    config = ReportSnapshotConfiguration.objects.select_for_update().get(pk=config.pk)
    if not allowed_actor(actor, config.unit):
        raise PermissionDenied("Sem acesso à importação do histórico.")
    if (config.dataset_kind not in {"capacity", "lives"} or not re.fullmatch(r"[a-f0-9]{64}",checksum)
        or source_table not in ({"LEITOS_DISPONIVEIS"} if config.dataset_kind=="capacity" else {"SAN_VIDAS", "SAN_VIDAS_MES"})):
        raise ValidationError("Origem de histórico inválida.")
    imported = unchanged = count = 0
    for batch in batches:
        reference = date.fromisoformat(batch["reference"])
        period = batch.get("period_type", "day")
        if period != ("month" if source_table == "SAN_VIDAS_MES" else "day"):
            raise ValidationError("Granularidade incompatível com a tabela histórica de origem.")
        if reference > timezone.localdate() or period not in {"day", "month"} or (period == "month" and (config.dataset_kind != "lives" or reference.day != 1)):
            raise ValidationError("Período histórico inválido.")
        rows = parse_rows(batch["headers"], batch["rows"], config, reference)
        if period == "month":
            for row in rows:
                row.payload.pop("date")
                row.payload["period"] = reference.strftime("%Y-%m")
        manifest = {"kind": "legacy_import", "dataset_kind": config.dataset_kind, "environment": "production",
                    "source_host": "172.16.0.123", "source_table": source_table, "period_type": period,
                    "captured_time_known": False}
        key = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
        run, created = ReportSnapshotRun.objects.get_or_create(configuration=config, dataset_key=key, reference_date=reference,
            defaults={"unit_id": config.unit_id, "period_type": period, "origin": "legacy", "state": "ready",
                      "requester": actor, "configuration_version": config.version, "source_snapshot": {**manifest, "checksum": checksum},
                      "scheduled_for": None, "row_count": len(rows), "completed_at": timezone.now()})
        expected = {r.record_key: r.payload for r in rows}
        if not created:
            actual = dict(run.data_rows.values_list("record_key", "payload"))
            if run.state != "ready" or run.period_type != period or actual != expected:
                raise ValidationError("Conflito com histórico já preservado; nenhum registro foi substituído.")
            unchanged += 1
            continue
        for row in rows:
            row.run = run
        ReportSnapshotDataRow.objects.bulk_create(rows)
        imported += 1
        count += len(rows)
    Audit.objects.create(unit=config.unit, actor=actor, action="report_snapshot.history_imported", object_id=str(config.pk),
        details={"dataset_kind": config.dataset_kind, "environment": "production", "imported_periods": imported,
                 "unchanged_periods": unchanged, "rows": count, "checksum": checksum})
    return {"imported_periods": imported, "unchanged_periods": unchanged, "rows": count}
