"""Validate native Canvas exports before switching existing generators; never sends."""
import base64
import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from core.models import Audit
from operations.models import ReportDefinition, ReportExecution
from operations.report_canvas.native import datasets
from operations.report_canvas.ports import make_layout
from operations.report_canvas.engine import definition_snapshot, export, validate_values

class Command(BaseCommand):
    help = "Valida e migra relatórios integrados para geração pelo Canvas, sem enviar arquivos."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--parameters", help="JSON por ID com parâmetros de validação")
        parser.add_argument("--backup", required=True)
        parser.add_argument("--artifacts", help="Diretório restrito para arquivos de validação")

    def handle(self, *args, **opts):
        values = json.loads(Path(opts["parameters"]).read_text()) if opts["parameters"] else {}
        reports = list(ReportDefinition.objects.filter(catalog_kind="report", reviewed=True, review_queue=False).order_by("pk"))
        backup = Path(opts["backup"])
        if backup.exists():
            raise CommandError("Use um novo caminho de backup.")
        backup.write_text(json.dumps([{"id":r.pk,"version":r.version,"canvas_enabled":r.canvas_enabled,"canvas_layout":r.canvas_layout,"legacy":r.legacy} for r in reports], default=str))
        backup.chmod(0o600)
        failures = []
        for candidate in reports:
            if not datasets(candidate) and candidate.source != "sql":
                self.stdout.write(f"PENDENTE {candidate.pk}: origem externa sem definição Canvas")
                continue
            try:
                with transaction.atomic():
                    r = ReportDefinition.objects.select_for_update(of=("self",)).select_related("unit","connection").get(pk=candidate.pk)
                    if r.canvas_enabled:
                        self.stdout.write(f"ATUAL {r.pk}")
                        continue
                    if ReportExecution.objects.filter(report=r,state__in=["pending","running"]).exists():
                        raise CommandError("Execução em andamento; tente após concluir.")
                    layout = r.canvas_layout or make_layout(r)
                    if r.handler == "stock_loans_v1" and r.legacy.get("canvas_port") and not any(s.get("dataset")=="summary" for s in layout["sources"]):
                        generated=make_layout(r)
                        layout={**layout,"sources":[*layout["sources"],generated["sources"][-1]],"pages":[*layout["pages"],generated["pages"][-1]]}
                    # Preserve the four-column workbook contract without title rows or a second sheet.
                    if r.handler == "bed_snapshots_v1" and r.legacy.get("canvas_port"):
                        layout = {**layout,"xlsx_mode":"table"}
                    r.canvas_layout = layout
                    parsed = values.get(str(r.pk), {})
                    validate_values(r, parsed)
                    definition_snapshot(r)
                    content, count = export(r, layout, parsed, r.monthly_goals, r.output_format)
                    if opts["artifacts"]:
                        folder = Path(opts["artifacts"]);folder.mkdir(parents=True,exist_ok=True);folder.chmod(0o700)
                        target = folder / f"report-{r.pk}.{r.output_format}"
                        target.write_bytes(base64.b64decode(content));target.chmod(0o600)
                    if opts["apply"]:
                        r.canvas_enabled = True
                        r.legacy = {**r.legacy,"canvas_migration":{"at":timezone.now().isoformat(),"previous_version":r.version,"validated_rows":count,"format":r.output_format}}
                        r.version += 1
                        r.save(update_fields=["canvas_enabled","canvas_layout","legacy","version"])
                        Audit.objects.create(unit=r.unit,action="report.canvas_migrated",object_id=str(r.pk),details={"version":r.version,"rows":count,"format":r.output_format})
                    self.stdout.write(f"{'MIGRADO' if opts['apply'] else 'VALIDADO'} {r.pk}: {count} registros, {r.output_format}")
            except Exception as exc:
                failures.append(candidate.pk)
                # Log type only: external driver messages can contain sensitive data.
                self.stderr.write(f"FALHOU {candidate.pk}: {type(exc).__name__}")
        if failures:
            raise CommandError("Não migrados: " + ", ".join(map(str, failures)))
