"""Register proven snapshot dependencies without enabling automatic collections or sends."""
import json
from datetime import time, timedelta
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from core.models import Unit, Audit
from operations.models import ReportConnection, ReportDefinition, ReportSnapshotConfiguration
from operations.report_engine import run_query
from operations.snapshot_datasets import parse_rows


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--unit", required=True)
        parser.add_argument("--connection-id", type=int, required=True)
        parser.add_argument("--actor", required=True)

    def handle(self, *args, **opts):
        unit=Unit.objects.get(slug=opts["unit"])
        if unit.slug!="scv":raise CommandError("Os vínculos legados foram comprovados somente na unidade SCV.")
        actor=get_user_model().objects.get(username=opts["actor"],is_superuser=True,is_active=True)
        conn=ReportConnection.objects.get(pk=opts["connection_id"],unit=unit,engine="oracle",enabled=True,validated=True)
        if conn.database.casefold() != "hmlvotu":raise CommandError("Selecione a conexão de homologação hmlvotu validada.")
        sql=(Path(__file__).resolve().parents[2]/"report_sql/snapshot_lives.sql").read_text()
        draft=ReportDefinition(unit=unit,source="sql",connection=conn,query_sql=sql,parameter_schema={"data_alvo":{"type":"date","required":True}})
        reference=timezone.localdate()-timedelta(days=1)
        # Aggregate-only validation. No Firebird procedure or patient row is executed/returned.
        config=ReportSnapshotConfiguration(unit=unit,dataset_kind="lives")
        try:
            headers,values=run_query(draft,{"data_alvo":reference.isoformat()})
            validated=parse_rows(headers,values,config,reference)
        except Exception:
            raise CommandError("Não foi possível validar a consulta agregada de Vidas na conexão selecionada.") from None
        with transaction.atomic():
            Unit.objects.select_for_update().get(pk=unit.pk)
            source,created=ReportDefinition.objects.get_or_create(unit=unit,code="snapshot-lives-oracle",defaults={
                "name":"Vidas Sansaúde · coleta Oracle","catalog_kind":"component","source":"sql","connection":conn,
                "query_sql":sql,"parameter_schema":draft.parameter_schema,"enabled":True,"reviewed":True,"manual_enabled":False,
                "legacy":{"validation":{"environment":"homologation","reference":reference.isoformat(),"rows":len(validated),"validated_at":timezone.now().isoformat()}}})
            if not created and (source.connection_id!=conn.pk or source.query_sql!=sql):
                raise CommandError("Coleta de Vidas já personalizada; nenhuma query foi substituída.")
            lives,new=ReportSnapshotConfiguration.objects.get_or_create(unit=unit,code="lives-daily",defaults={
                "name":"Vidas Sansaúde · histórico diário","dataset_kind":"lives","reference_offset_days":-1,
                "source_report":source,"output_report":ReportDefinition.objects.get(unit=unit,code="legacy123-310"),
                "environment":"homologation","collection_time":time(4,30),"enabled":False})
            lives.consumers.add(ReportDefinition.objects.get(unit=unit,code="legacy123-271"))
            pending,pcreated=ReportDefinition.objects.get_or_create(unit=unit,code="snapshot-capacity-oracle",defaults={
                "name":"Capacidade SUS/convênio · origem pendente","catalog_kind":"component","source":"sql","connection":conn,
                "query_sql":"","enabled":False,"reviewed":False,"manual_enabled":False,
                "unavailable_reason":"Falta fonte equivalente ao rateio manual CADASTRO_LEITOS, validada no mesmo ambiente. Histórico de produção preservado separadamente."})
            capacity,cnew=ReportSnapshotConfiguration.objects.get_or_create(unit=unit,code="bed-capacity-daily",defaults={
                "name":"Capacidade SUS/convênio · histórico","dataset_kind":"capacity","reference_offset_days":0,
                "source_report":pending,"output_report":ReportDefinition.objects.get(unit=unit,code="legacy123-20"),
                "environment":"homologation","collection_time":time(4,25),"enabled":False})
            capacity.consumers.add(*ReportDefinition.objects.filter(unit=unit,code__in=["legacy123-18","legacy123-19","legacy123-24","legacy123-25","legacy123-55"]))
            Audit.objects.create(unit=unit,actor=actor,action="report_snapshot.datasets_registered",object_id=str(lives.pk),
                details={"lives":lives.pk,"capacity":capacity.pk,"oracle_validated":True,"automatic_enabled":False,"real_sends":False})
        self.stdout.write(json.dumps({"lives_configuration":lives.pk,"capacity_configuration":capacity.pk,"lives_validated_rows":len(validated),"reference":reference.isoformat(),"created":new+cnew,"automatic_enabled":False,"real_sends":False}))
