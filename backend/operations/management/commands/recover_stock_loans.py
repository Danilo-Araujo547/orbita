"""Restore the recovered stock SQL on an existing connection, without enabling sends."""
import hashlib
import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from core.models import Audit, Unit
from operations.models import ReportConnection, ReportDefinition
from operations.report_engine import sql_contract
from operations.stock_loans import HANDLER, DATE_KEYS, report_readiness

class Command(BaseCommand):
    help = "Recover stock-loan SQL/PDF for technical review; keeps the report disabled."
    def add_arguments(self, parser):
        parser.add_argument("--unit", required=True)
        parser.add_argument("--connection-id", required=True, type=int)
        parser.add_argument("--expected-version", required=True, type=int)
        parser.add_argument("--environment", required=True, choices=["homologacao","producao"])
        parser.add_argument("--actor", required=True)

    @transaction.atomic
    def handle(self, *args, **opts):
        unit=Unit.objects.select_for_update().get(slug=opts["unit"])
        if unit.slug != "scv": raise CommandError("O cadastro recuperado pertence à unidade SCV.")
        report=ReportDefinition.objects.select_for_update().get(unit=unit,code="legacy123-1")
        if report.version != opts["expected_version"]: raise CommandError("Versão alterada; recarregue antes de recuperar.")
        if report.handler or report.query_sql.strip(): raise CommandError("Cadastro já implementado; revisar em vez de sobrescrever.")
        conn=ReportConnection.objects.get(pk=opts["connection_id"],unit=unit)
        if conn.engine != "oracle" or not conn.enabled or not conn.validated: raise CommandError("Selecione conexão Oracle validada da unidade.")
        actor=get_user_model().objects.get(username=opts["actor"],is_active=True,is_superuser=True)
        sql=(Path(__file__).resolve().parents[2]/"report_sql/stock_loans/loans.sql").read_text()
        schema={k:{"type":"date","required":True,"prompt":("Data inicial (DD/MM/AAAA)" if k==DATE_KEYS[0] else "Data final (DD/MM/AAAA)")} for k in DATE_KEYS}
        sql_contract(sql,schema,"oracle")
        previous={"connection_id":report.connection_id,"source":report.source,"handler":report.handler,"query_sql":report.query_sql,"parameter_schema":report.parameter_schema,"version":report.version,"enabled":report.enabled,"reviewed":report.reviewed,"dependencies":report.dependencies,"unavailable_reason":report.unavailable_reason}
        report.connection=conn;report.source="sql";report.handler=HANDLER;report.query_sql=sql;report.parameter_schema=schema
        report.output_format="pdf";report.enabled=False;report.reviewed=True
        report.dependencies=[]
        report.unavailable_reason="Recuperado em homologação; liberação operacional e validação em produção pendentes." if opts["environment"]=="homologacao" else "Recuperado para conferência; liberação operacional pendente."
        report.legacy={**report.legacy,"migration":{"previous_definition":previous,"environment":opts["environment"],"recovered_at":timezone.now().isoformat(),"query_sha256":hashlib.sha256(sql.encode()).hexdigest(),"transport":"disabled_pending_acceptance","legacy_id":1,"changes":["binds tipados","data final inclui todo o dia","fator zero retorna saldo ausente"]}}
        report.version+=1
        missing=report_readiness(report)
        if missing:raise CommandError(str(missing))
        report.save()
        Audit.objects.create(unit=unit,actor=actor,action="report.stock_loans_recovered",object_id=str(report.pk),details={"version":report.version,"connection_id":conn.pk,"environment":opts["environment"],"enabled":False,"real_sends":False})
        self.stdout.write(json.dumps({"report_id":report.pk,"version":report.version,"connection_id":conn.pk,"environment":opts["environment"],"enabled":False,"real_sends":False}))
