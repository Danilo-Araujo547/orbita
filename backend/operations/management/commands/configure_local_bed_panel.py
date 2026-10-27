"""Configure allowlisted reports from manually published server-local PDFs."""

import json
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from core.models import Audit
from operations.external_pdf import FILES, HANDLER, source_name
from operations.models import ReportAutomation, ReportDefinition, ReportSchedule
from operations.reporting import readiness


class Command(BaseCommand):
    help = "Configure an allowlisted SCV report from a fixed local PDF; preserve grants and schedules."

    def add_arguments(self, parser):
        parser.add_argument("--expected-version", type=int, required=True)
        parser.add_argument("--code", choices=sorted(code for unit, code in FILES if unit == "scv"), default="legacy123-309")

    @transaction.atomic
    def handle(self, *args, **options):
        report = ReportDefinition.objects.select_for_update().select_related("unit").get(
            unit__slug="scv", code=options["code"])
        if report.version != options["expected_version"]:
            raise CommandError("Definition changed; reload the current version.")
        if (report.catalog_kind != "report" or report.review_queue
                or report.source != "external_file" or report.handler not in ("", HANDLER)):
            raise CommandError("Unexpected report definition; review before configuring.")
        if (ReportAutomation.objects.filter(report=report, enabled=True).exists()
                or ReportSchedule.objects.filter(report=report, enabled=True).exists()):
            raise CommandError("Enabled schedules exist; review before enabling this report.")
        previous = {key: getattr(report, key) for key in (
            "source", "handler", "connection_id", "query_sql", "parameter_schema",
            "components", "enabled", "reviewed", "dependencies", "unavailable_reason",
            "output_format", "version")}
        report.legacy = {**report.legacy, "local_pdf_migration": {
            "previous_definition": previous, "configured_at": timezone.now().isoformat(),
            "source": FILES[("scv", report.code)], "publication": "manual"},
            "source_path": "/opt/orbita/files/" + FILES[("scv", report.code)]}
        report.handler = HANDLER
        report.connection = None
        report.query_sql = ""
        report.parameter_schema = {}
        report.components = []
        report.enabled = True
        report.reviewed = True
        report.output_format = "pdf"
        report.dependencies = []
        report.unavailable_reason = ""
        report.version += 1
        source_name(report)
        report.save()
        Audit.objects.create(unit=report.unit, action="report.local_pdf_configured",
            object_id=str(report.pk), details={"code": report.code,
                "previous_version": previous["version"], "version": report.version,
                "source": FILES[("scv", report.code)], "publication": "manual"})
        self.stdout.write(json.dumps({"report_id": report.pk, "version": report.version,
            "pending_items": readiness(report)}, ensure_ascii=True))
