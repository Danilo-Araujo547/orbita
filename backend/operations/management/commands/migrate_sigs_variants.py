"""Migrate allowlisted unit-specific SIGS reports to Canvas without transport."""
import base64
import hashlib
import io
import json
import re
from collections import Counter
from datetime import datetime, time
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from core.models import Audit
from operations.models import ReportDefinition, ReportExecution
from operations.report_engine import connect, run_query, parameters, sql_contract
from operations.report_canvas.ports import make_layout, text
from operations.report_canvas.engine import export, definition_snapshot

CATALOG_PATH = Path(__file__).resolve().parents[2] / "report_sql/sigs/variants.json"

def catalog():
    return json.loads(CATALOG_PATH.read_text())

def prepare_layout(report, family):
    layout = make_layout(report)
    table = next(b for b in layout["pages"][0]["blocks"] if b["type"] == "table")
    table["options"].update(font_size=10, column_widths={"consultas":[350,560,110], "medicamentos":[240,480,100,120,120], "gestantes":[180,240,100,100,120,100,120,140]}[family])
    if family != "gestantes":
        label = "Ano: {{WPA_DATA_INICIAL}} · Mês: {{WPA_DATA_FINAL}}" if family == "medicamentos" else "Período: {{WPA_DATA_INICIAL}} a {{WPA_DATA_FINAL}}"
        layout["pages"][0]["blocks"].append(text("period",label,32,72,1059,24,12))
    return layout

def compare_source(report, spec, values):
    parsed = parameters(report,values)
    with connect(report.connection) as db:
        columns, rows = run_query(report,values,session=db,typed=True)
        sql = re.sub(r"\b(WPA_DATA_INICIAL|WPA_DATA_FINAL)\b",r":\1",spec["original_sql"])
        binds = dict(parsed)
        if spec["family"] == "consultas":
            binds["WPA_DATA_FINAL"] = datetime.combine(parsed["WPA_DATA_FINAL"],time(23,59,59))
        cur = db.cursor()
        try:
            cur.execute(sql,binds)
            original = cur.fetchmany(report.connection.max_rows+1)
            if len(original)>report.connection.max_rows or columns != [c[0] for c in cur.description]:
                raise CommandError("Referência excede limite ou diverge nas colunas.")
            normalize = lambda row: tuple(None if v is None else str(v) for v in row)
            if Counter(map(normalize,rows)) != Counter(map(normalize,original)):
                raise CommandError("Resultado diferente do SQL legado.")
        finally: cur.close()
    return columns,rows

class Command(BaseCommand):
    help = "Migra 29 variantes SIGS para Canvas; valida SQL legado e PDF, sem gerar envios."
    def add_arguments(self,p):
        p.add_argument("--backup",required=True)
        p.add_argument("--artifacts",required=True)
        p.add_argument("--report",action="append",dest="codes")
        p.add_argument("--apply",action="store_true")
    def handle(self,*args,**opts):
        from pypdf import PdfReader
        definitions=catalog()
        codes=opts["codes"] or list(definitions)
        if set(codes)-set(definitions):raise CommandError("Relatório fora do catálogo revisado.")
        reports=list(ReportDefinition.objects.filter(unit__slug="scv",code__in=codes).select_related("unit","connection").order_by("pk"))
        if len(reports)!=len(set(codes)):raise CommandError("Cadastro ausente.")
        backup=Path(opts["backup"])
        if backup.exists():raise CommandError("Backup já existe; escolha um novo caminho.")
        fields=["id","version","source","handler","query_sql","parameter_schema","reviewed","enabled","canvas_enabled","canvas_layout","dependencies","unavailable_reason","legacy","output_format"]
        backup.write_text(json.dumps([{f:getattr(r,f) for f in fields} for r in reports],ensure_ascii=False,default=str));backup.chmod(0o600)
        folder=Path(opts["artifacts"]);folder.mkdir(parents=True,exist_ok=True);folder.chmod(0o700)
        outcomes=[];failures=[]
        for candidate in reports:
            spec=definitions[candidate.code]
            fingerprint=hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()
            entry={"id":candidate.pk,"code":candidate.code,"family":spec["family"]}
            try:
                with transaction.atomic():
                    r=ReportDefinition.objects.select_for_update(of=("self",)).select_related("unit","connection").get(pk=candidate.pk)
                    if r.legacy.get("sigs_canvas_variant",{}).get("fingerprint")==fingerprint and r.reviewed and r.canvas_enabled:
                        entry["status"]="unchanged"
                    else:
                        if r.enabled or r.canvas_layout or r.canvas_enabled or r.handler or r.reviewed or r.catalog_kind!="report" or r.review_queue:
                            raise CommandError("Definição ativa, personalizada ou já revisada; preservar.")
                        if r.query_sql.replace("\r\n","\n").strip() not in {spec["original_sql"].replace("\r\n","\n").strip(),spec["sql"].replace("\r\n","\n").strip()}:
                            raise CommandError("SQL personalizado; preservar.")
                        if not r.connection or r.connection.unit_id!=r.unit_id or r.connection.engine!="oracle" or r.connection.database!="prdpmv":
                            raise CommandError("Conexão SIGS incompatível.")
                        if ReportExecution.objects.filter(report=r,state__in=["pending","running"]).exists():raise CommandError("Execução em andamento.")
                        r.source="sql";r.query_sql=spec["sql"];r.parameter_schema=spec["schema"]
                        values={} if spec["family"]=="gestantes" else {"WPA_DATA_INICIAL":2026,"WPA_DATA_FINAL":10} if spec["family"]=="medicamentos" else {"WPA_DATA_INICIAL":"2026-10-01","WPA_DATA_FINAL":"2026-10-25"}
                        sql_contract(r.query_sql,r.parameter_schema,"oracle")
                        columns,rows=compare_source(r,spec,values)
                        if columns!=spec["columns"]:raise CommandError("Colunas alteradas desde o mapeamento.")
                        r.reviewed=True;r.save(update_fields=["query_sql","parameter_schema","source","reviewed"])
                        r.canvas_layout=prepare_layout(r,spec["family"]);r.output_format="pdf";r.canvas_enabled=True
                        definition_snapshot(r)
                        content,count=export(r,r.canvas_layout,values,r.monthly_goals,"pdf")
                        if count!=len(rows):raise CommandError("Contagem Canvas divergente.")
                        raw=base64.b64decode(content);pdf=PdfReader(io.BytesIO(raw))
                        if not pdf.pages:raise CommandError("PDF vazio.")
                        target=folder/(r.code+".pdf");target.write_bytes(raw);target.chmod(0o600)
                        entry.update(status="migrated" if opts["apply"] else "validated",rows=count,pages=len(pdf.pages),parameters=values,reference_equal=True,sha256=hashlib.sha256(raw).hexdigest())
                        if opts["apply"]:
                            r.dependencies=[];r.unavailable_reason=""
                            r.legacy={**r.legacy,"sigs_canvas_variant":{**entry,"at":timezone.now().isoformat(),"fingerprint":fingerprint,"connection_version":r.connection.version}}
                            r.version+=1;r.save(update_fields=["canvas_layout","canvas_enabled","output_format","dependencies","unavailable_reason","legacy","version"])
                            Audit.objects.create(unit=r.unit,action="report.sigs_canvas_migrated",object_id=str(r.pk),details={"version":r.version,"rows":count,"enabled":False,"reference_equal":True})
                        else:transaction.set_rollback(True)
            except Exception as exc:
                failures.append(candidate.code);entry.update(status="failed",error_type=type(exc).__name__)
            outcomes.append(entry)
            log=folder/"results.json";log.write_text(json.dumps(outcomes,ensure_ascii=False,indent=2));log.chmod(0o600)
            self.stdout.write(json.dumps(entry,ensure_ascii=False));self.stdout.flush()
        if failures:raise CommandError("Não migrados: "+", ".join(failures))
