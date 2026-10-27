"""Register a disabled, reviewable Oracle/Canvas Informative Indicators report."""
import json
from pathlib import Path
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand,CommandError
from django.db import transaction
from django.utils import timezone
from core.models import Audit
from operations.models import ReportDefinition,ReportConnection,ReportAutomation,ReportSchedule,ReportExecution
from operations.occupancy_indicators import HANDLER,SOURCES,definition_snapshot
from operations.report_engine import sql_contract
from operations.report_canvas.ports import make_layout
from operations.report_canvas.engine import definition_snapshot as canvas_snapshot

class Command(BaseCommand):
    help="Stage Informative Indicators with production Oracle and approved capacity; no deliveries."

    def add_arguments(self,p):
        p.add_argument("--expected-version",type=int,required=True)
        p.add_argument("--connection-id",type=int,required=True)
        p.add_argument("--actor",required=True)

    @transaction.atomic
    def handle(self,*args,**opts):
        report=ReportDefinition.objects.select_for_update().select_related("unit").get(unit__slug="scv",code="legacy123-20")
        actor=get_user_model().objects.get(username=opts["actor"],is_active=True)
        from operations.reporting import is_admin
        if not is_admin(actor,report.unit):raise CommandError("Administrator required.")
        if report.version!=opts["expected_version"] or report.handler or report.canvas_layout or report.enabled:
            raise CommandError("Existing definition changed; review before configuring.")
        if ReportExecution.objects.filter(report=report,state__in=["pending","running"]).exists():raise CommandError("Execution in progress.")
        if ReportAutomation.objects.filter(report=report,enabled=True).exists() or ReportSchedule.objects.filter(report=report,enabled=True).exists():
            raise CommandError("Enabled schedules require review before integration.")
        original=ReportConnection.objects.get(pk=opts["connection_id"],unit=report.unit,engine="oracle",enabled=True,validated=True)
        if original.host!="172.16.0.254" or original.database.lower()!="prdvotu":raise CommandError("Production Oracle required.")
        name="Oracle Santa Casa - Informativos - prdvotu"
        if ReportConnection.objects.filter(unit=report.unit,name=name).exists() or ReportDefinition.objects.filter(unit=report.unit,code__in=list(SOURCES.values())).exists():
            raise CommandError("Existing indicator sources must be preserved; review them.")
        # Reuse the encrypted service envelope only within the exact same database/unit.
        c=ReportConnection.objects.create(unit=report.unit,name=name,engine="oracle",host=original.host,port=original.port,
            database=original.database,username=original.username,ciphertext=original.ciphertext,options=original.options,
            enabled=True,validated=True,checked_at=original.checked_at,timeout_seconds=60,max_rows=10000)
        schema={"inicio":{"type":"date","required":True},"fim_exclusivo":{"type":"date","required":True}}
        entries=[]
        for part,code in SOURCES.items():
            sql=(Path(__file__).resolve().parents[2]/"report_sql/occupancy_indicators"/(part+"_periods.sql")).read_text()
            sql_contract(sql,schema,"oracle")
            r=ReportDefinition.objects.create(unit=report.unit,code=code,name="Informativos - "+part,catalog_kind="component",
                source="sql",connection=c,query_sql=sql,parameter_schema=schema,enabled=True,reviewed=True,manual_enabled=False,
                output_format="csv",legacy={"migration":{"parent":"legacy123-20","environment":"production","origin":"Oracle direto; consultas periodizadas"}})
            entries.append({"code":r.code})
        previous={key:getattr(report,key) for key in ["source","handler","connection_id","components","parameter_schema","enabled","reviewed","dependencies","unavailable_reason","version"]}
        report.legacy={**report.legacy,"occupancy_migration":{"previous_definition":previous,"at":timezone.now().isoformat(),"environment":"production","status":"staged"},
            "source_path":"Oracle prdvotu (pacientes/atendimentos/cirurgias) + capacidade historica de producao preservada no PostgreSQL; PDF Canvas de dez partes"}
        report.handler=HANDLER;report.connection=c;report.components=entries
        report.parameter_schema={"data_referencia":{"type":"date","required":True,"prompt":"Informe a data de referência em DD/MM/AAAA.","order":1}}
        report.reviewed=True;report.review_queue=False;report.enabled=False;report.output_format="pdf"
        report.unavailable_reason="";report.dependencies=[];report.canvas_enabled=True
        report.canvas_layout=make_layout(report);report.version+=1;report.save()
        definition_snapshot(report);canvas_snapshot(report)
        Audit.objects.create(unit=report.unit,actor=actor,action="report.occupancy_staged",object_id=str(report.pk),
            details={"version":report.version,"connection_id":c.pk,"source_reports":len(entries),"pages":len(report.canvas_layout["pages"]),"enabled":False})
        self.stdout.write(json.dumps({"report_id":report.pk,"version":report.version,"connection_id":c.pk,"sources":entries,"enabled":False}))
