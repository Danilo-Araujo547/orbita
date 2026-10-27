"""Recover five existing SIGS report definitions, without granting or enabling delivery."""
import hashlib
import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from core.models import Unit, Audit
from operations.models import ReportDefinition
from operations.report_engine import sql_contract

ROOT=Path(__file__).resolve().parents[2]/"report_sql/sigs"


def canonical(sql):
    return str(sql or "").replace("\r\n","\n").strip()


class Command(BaseCommand):
    help="Map existing SIGS SQL and typed parameters; keep all five reports disabled."
    def add_arguments(self, parser):
        parser.add_argument("--unit",required=True)
        parser.add_argument("--actor",required=True)

    @transaction.atomic
    def handle(self,*args,**opts):
        unit=Unit.objects.select_for_update().get(slug=opts["unit"])
        if unit.slug!="scv":raise CommandError("Os relatórios legados selecionados pertencem à unidade SCV.")
        actor=get_user_model().objects.get(username=opts["actor"],is_active=True,is_superuser=True)
        catalog=json.loads((ROOT/"catalog.json").read_text())
        result=[]
        for code,spec in catalog.items():
            r=ReportDefinition.objects.select_for_update(of=("self",)).select_related("connection").get(unit=unit,code=code)
            if not r.connection_id or r.connection.unit_id!=unit.pk or r.connection.engine!="oracle":
                raise CommandError("Confirme a conexão Oracle da unidade: "+code)
            if str(r.legacy.get("record",{}).get("ID_BASE"))!="17":
                raise CommandError("Origem SIGS divergente: "+code)
            sql=(ROOT/spec["file"]).read_text()
            sql_contract(sql,spec["schema"],"oracle")
            fingerprint=hashlib.sha256(json.dumps({"sql":sql,"schema":spec["schema"]},sort_keys=True).encode()).hexdigest()
            mapped=r.legacy.get("sigs_mapping",{})
            if mapped.get("fingerprint")==fingerprint and canonical(r.query_sql)==canonical(sql) and r.parameter_schema==spec["schema"]:
                result.append({"code":code,"id":r.pk,"version":r.version,"changed":False});continue
            if r.enabled or r.handler or r.canvas_enabled or canonical(r.query_sql) not in {"",canonical(spec["original_sql"]),canonical(sql)}:
                raise CommandError("Cadastro ativo/personalizado; nenhuma definição será substituída: "+code)
            before={"query_sql":r.query_sql,"parameter_schema":r.parameter_schema,"version":r.version,
                    "enabled":r.enabled,"reviewed":r.reviewed,"source":r.source,"output_format":r.output_format,
                    "unavailable_reason":r.unavailable_reason,"dependencies":r.dependencies}
            r.query_sql=sql;r.parameter_schema=spec["schema"];r.source="sql";r.output_format="pdf";r.catalog_kind="report"
            r.enabled=False;r.reviewed=False
            r.unavailable_reason="Query mapeada; validar conexão Oracle SIGS, conteúdo da view e resultados antes de habilitar."
            r.dependencies=["Validação da conexão Oracle SIGS e da view "+spec["view"]+" pendente."]
            r.legacy={**r.legacy,"original_sql":r.legacy.get("original_sql") or spec["original_sql"],
                "parameters":r.legacy.get("parameters") or spec["legacy_parameters"],
                "source_path":"WhatsReport 172.16.0.123 → Oracle SIGS (Legado 17) → "+spec["view"]+"; dependências internas da view ainda não validadas.",
                "sigs_mapping":{"fingerprint":fingerprint,"view":spec["view"],"semantics":spec["semantics"],
                    "mapped_at":timezone.now().isoformat(),"validation":"pending_connection_and_data","previous_definition":before}}
            r.version+=1;r.save()
            Audit.objects.create(unit=unit,actor=actor,action="report.sigs_mapped",object_id=str(r.pk),
                details={"code":r.code,"version":r.version,"view":spec["view"],"enabled":False,"real_sends":False})
            result.append({"code":code,"id":r.pk,"version":r.version,"changed":True})
        self.stdout.write(json.dumps({"reports":result,"enabled":False,"real_sends":False}))
