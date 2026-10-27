"""Explicit, one-time registration of the Oracle homologation medical report."""
import json
import os
import secrets
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from core.models import Unit
from operations.models import ReportAutomation, ReportConnection, ReportDefinition
from operations.report_engine import connect, seal, sql_contract
from operations.medical_indicators import HANDLER, PARTS, definition_snapshot
from operations.reporting import readiness

class Command(BaseCommand):
    help = "Register medical SQL queries and versioned PDF layout against homologation; no deliveries."

    def add_arguments(self, parser):
        parser.add_argument("--unit", required=True)
        parser.add_argument("--password-env", default="REPORT_ORACLE_PASSWORD")
        parser.add_argument("--admin-password-env", default="REPORT_ADMIN_PASSWORD")

    @transaction.atomic
    def handle(self, *args, **opts):
        password = os.environ.get(opts["password_env"])
        if not password:
            raise CommandError("Informe a credencial Oracle pela variável de ambiente.")
        unit = Unit.objects.get(slug=opts["unit"])
        report = ReportDefinition.objects.select_for_update().get(unit=unit, code="legacy123-40")
        if report.handler == HANDLER:
            raise CommandError("Integração já cadastrada; alterações devem ser feitas no catálogo.")
        name = "Oracle Santa Casa · Homologação · hmlvotu"
        if ReportConnection.objects.filter(unit=unit, name=name).exists():
            raise CommandError("Conexão já existe; revisar antes de cadastrar novamente.")
        if ReportDefinition.objects.filter(unit=unit, code__in=["medical-" + p.replace("_", "-") for p in PARTS]).exists():
            raise CommandError("Já existem componentes médicos; revisar o cadastro.")
        conn = ReportConnection(unit=unit, name=name, engine="oracle", host="172.16.3.254", port=1521, database="hmlvotu", username="dbamv", options={"identifier_type": "service"}, timeout_seconds=60, max_rows=10000, enabled=True)
        # A random bootstrap wrapping password is discarded. The service envelope is
        # the existing encryption mechanism, and future UI changes require admin auth.
        conn.ciphertext = seal(password, os.environ.get(opts["admin_password_env"]) or secrets.token_urlsafe(48))
        with connect(conn) as session:
            cursor = session.cursor()
            try:
                cursor.execute("SELECT 1 FROM DUAL")
                if cursor.fetchone() != (1,):
                    raise CommandError("Falha na validação Oracle.")
            finally:
                cursor.close()
        conn.validated=True;conn.checked_at=timezone.now();conn.save()
        schema={"inicio":{"type":"date","required":True,"prompt":"Data inicial (AAAA-MM-DD)"},"fim_exclusivo":{"type":"date","required":True,"prompt":"Fim exclusivo (AAAA-MM-DD)"}}
        titles={"stays":"Permanência por convênio e especialidade","attendances":"Atendimentos de urgência por dia","exams":"Exames realizados por dia","opinions_months":"Pareceres de urgência por mês","opinions_days":"Pareceres de urgência por dia"}
        entries=[]
        for part in PARTS:
            sql=(Path(__file__).resolve().parents[2]/"report_sql"/"indicadores_medicos"/(part+".sql")).read_text()
            sql_contract(sql,schema,"oracle")
            child=ReportDefinition.objects.create(unit=unit,code="medical-"+part.replace("_","-"),name="Indicadores Médicos · "+titles[part],source="sql",catalog_kind="component",connection=conn,query_sql=sql,parameter_schema=schema,reviewed=True,enabled=True,manual_enabled=False,output_format="csv",legacy={"migration":{"environment":"homologacao","source":"Oracle direto","parent":"legacy123-40","part":part}})
            entries.append({"code":child.code})
        previous={"source":report.source,"components":report.components,"connection_id":report.connection_id,"parameter_schema":report.parameter_schema,"handler":report.handler,"enabled":report.enabled,"version":report.version}
        report.legacy={**report.legacy,"migration":{"previous_definition":previous,"environment":"homologacao","integrated_at":timezone.now().isoformat(),"asset_version":"v1","transport":"panel_only"}}
        report.components=entries;report.connection=conn;report.handler=HANDLER
        report.source="composite";report.reviewed=True;report.enabled=True;report.manual_enabled=True;report.output_format="pdf";report.unavailable_reason="";report.dependencies=[]
        report.parameter_schema={"data_referencia":{"type":"date","required":False,"prompt":"Data de referência (AAAA-MM-DD). Em branco: hoje."}}
        report.version+=1;report.save()
        ReportAutomation.objects.filter(report=report).update(enabled=False)
        pending=readiness(report)
        if pending:
            raise CommandError(str(pending))
        definition_snapshot(report)
        self.stdout.write(json.dumps({"report_id":report.pk,"connection_id":conn.pk,"parts":len(entries),"environment":"homologacao","transport":"panel_only"}))
