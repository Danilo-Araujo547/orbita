"""Register the bed history and collector. Never creates or enables deliveries."""
from datetime import time
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from core.models import Unit, Audit
from operations.models import ReportDefinition, ReportConnection, ReportSnapshotConfiguration, ReportRecipient, ReportGrant
from operations.bed_snapshots import HANDLER, definition


class Command(BaseCommand):
    help = "Configure Oracle daily bed snapshots and XLSX export; no WhatsApp sends."

    def add_arguments(self, parser):
        parser.add_argument("--unit", required=True)
        parser.add_argument("--connection", required=True, type=int)
        parser.add_argument("--environment", choices=["homologation", "production"], required=True)
        parser.add_argument("--enable-collection", action="store_true")
        parser.add_argument("--recipient", type=int)

    @transaction.atomic
    def handle(self, *args, **options):
        unit = Unit.objects.get(slug=options["unit"])
        connection = ReportConnection.objects.get(pk=options["connection"], unit=unit, engine="oracle", enabled=True, validated=True)
        report = ReportDefinition.objects.select_for_update().get(unit=unit, code="legacy123-311")
        if ReportSnapshotConfiguration.objects.filter(output_report=report).exists():
            raise CommandError("Coleta já cadastrada; alterações devem ser feitas no painel.")
        sql = (Path(__file__).resolve().parents[2]/"report_sql"/"bed_position.sql").read_text()
        source = ReportDefinition.objects.create(unit=unit, code="bed-position-oracle", name="Leitos · posição atual no Oracle",
            catalog_kind="component", source="sql", connection=connection, query_sql=sql,
            parameter_schema={}, reviewed=True, enabled=True, manual_enabled=False, output_format="csv",
            legacy={"parent": report.code, "migration": {"environment": options["environment"], "source": "Oracle direto"}})
        previous = {"source": report.source, "handler": report.handler, "connection": report.connection_id,
            "output_format": report.output_format, "parameter_schema": report.parameter_schema, "version": report.version}
        report.source, report.handler, report.connection = "local", HANDLER, None
        report.query_sql, report.components, report.dependencies, report.unavailable_reason = "", [], [], ""
        report.output_format, report.reviewed, report.review_queue = "xlsx", True, False
        report.enabled, report.manual_enabled = True, True
        report.parameter_schema={"WPA_DATA_INICIAL": {"type":"date","required":True,"prompt":"Informe a data inicial no formato DD/MM/AAAA."},
                                 "WPA_DATA_FINAL": {"type":"date","required":True,"prompt":"Informe a data final no formato DD/MM/AAAA."}}
        report.request_message="Informe o período da tabela de leitos."
        report.legacy={**report.legacy,"migration":{"previous_definition":previous,"source":"Snapshots PostgreSQL coletados no Oracle", "environment": options["environment"]}}
        report.version+=1;report.save()
        config=ReportSnapshotConfiguration.objects.create(unit=unit,code="bed-position-daily",name="Leitos · snapshot diário",
            source_report=source,output_report=report,environment=options["environment"],collection_time=time(4,20,23),
            weekdays=list(range(7)),window_minutes=60,enabled=options["enable_collection"])
        definition(config,require_source=True)
        if options["recipient"]:
            recipient=ReportRecipient.objects.get(pk=options["recipient"],unit=unit,active=True,manual_enabled=True,verified_at__isnull=False)
            grant,_=ReportGrant.objects.get_or_create(unit=unit,report=report,recipient=recipient,defaults={"active":True,"manual":True,"automatic":False})
            if not grant.active or not grant.manual:
                grant.active,grant.manual=True,True;grant.version+=1;grant.save()
        Audit.objects.create(unit=unit,action="report_snapshot.configured",object_id=str(config.pk),
            details={"report":report.pk,"source":source.pk,"environment":config.environment,"collection_enabled":config.enabled})
        self.stdout.write(f"configuration={config.pk} report={report.pk} source={source.pk} collection={config.enabled} environment={config.environment}; no deliveries")
