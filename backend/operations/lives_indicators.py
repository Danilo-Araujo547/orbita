"""Vidas: preserves production photographs; never silently substitutes homologation."""
import hashlib,json
from datetime import date,datetime,timedelta
from zoneinfo import ZoneInfo
from django.utils import timezone
from rest_framework.exceptions import ValidationError,PermissionDenied
from operations.models import ReportDefinition,ReportSnapshotRun,ReportSnapshotDataRow
from operations.report_engine import parameters,connect,run_query
from operations.report_goals import normalize_goals
SOURCE="vidas-sansaude-production-oracle"
HANDLER="lives_indicators_v1"
def fail(message):raise ValidationError(message)

def source(report):
 if report.unit.slug!="scv" or report.code!="legacy123-310" or report.source!="composite":fail("Definição de Vidas Sansaúde incompatível.")
 r=ReportDefinition.objects.filter(unit=report.unit,code=SOURCE,catalog_kind="component",source="sql",enabled=True,reviewed=True).select_related("connection","unit").first()
 if not r or not r.connection or r.connection.unit_id!=report.unit_id or r.connection.engine!="oracle" or r.connection.database!="prdvotu" or not r.connection.enabled or not r.connection.validated:fail("Configure a fonte Oracle de produção de Vidas Sansaúde.")
 return r

def historical_runs(report):
 return ReportSnapshotRun.objects.filter(unit=report.unit,configuration__dataset_kind="lives",state="ready",origin="legacy",source_snapshot__environment="production",source_snapshot__kind="legacy_import").order_by("reference_date","pk")

def definition_snapshot(report):
 r=source(report)
 rows=list(ReportSnapshotDataRow.objects.filter(unit=report.unit,run__in=historical_runs(report)).order_by("run_id","record_key").values("run_id","record_key","payload"))
 return {"version":1,"source":r.pk,"source_version":r.version,"sql":hashlib.sha256(r.query_sql.encode()).hexdigest(),"connection":r.connection_id,"connection_version":r.connection.version,"history_sha256":hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()}

def prepare_values(report,values,*,origin="panel",recipient=None):
 if origin not in {"panel","whatsapp"}:raise PermissionDenied("Programação automática de Vidas ainda não homologada.")
 parsed=parameters(report,values)
 today=timezone.localtime(timezone.now(),ZoneInfo(report.unit.timezone)).date()
 ref=parsed.get("data_referencia") or today
 if ref>today or ref<date(2026,10,11):fail("Informe referência entre 11/10/2026 e hoje.")
 return {"data_referencia":ref.isoformat()}

def periods(ref):
 cutoff=ref-timedelta(days=1)
 index=cutoff.year*12+cutoff.month-1
 months=[date((index-i)//12,(index-i)%12+1,1) for i in range(12,-1,-1)]
 days=[ref-timedelta(days=i) for i in range(10,0,-1)]
 return cutoff,months,days

def sum_contracts(rows):
 totals={k:0 for k in ["E","I","A"]};seen=set()
 for contract,active,total in rows:
  if contract not in totals or active not in {"S","N"} or (contract,active) in seen or type(total) is bool:fail("Grupos de vidas inválidos ou duplicados.")
  try:value=int(total)
  except (TypeError,ValueError):fail("Total de vidas inválido.")
  if value<0 or value!=total:fail("Total de vidas inválido.")
  totals[contract]+=value;seen.add((contract,active))
 if {k for k,_ in seen}!=set(totals):fail("Faltam grupos de contratos na fonte de vidas.")
 return totals

def build_tables(ref,monthly,daily,goals,reconstructed):
 cutoff,months,days=periods(ref)
 previous=date(cutoff.year-1,12,1);current=date(cutoff.year,cutoff.month,1)
 needed=set(months+[previous])
 if needed-set(monthly) or set(days)-set(daily):fail("Histórico insuficiente para gerar Vidas; não preencher ausências com zero.")
 goalmap={(r["year"],r["month"]):r["value"] for r in normalize_goals(goals)}
 if any((d.year,d.month) not in goalmap for d in months):fail("Cadastre metas para todas as 13 competências.")
 names=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]
 rows=[];details=[]
 def add(label,values,origin):
  e,i,a=(values[k] for k in ["E","I","A"])
  rows.append([label,e,i,a,e+i+a]);details.append([label,origin])
 add(str(cutoff.year-1),monthly[previous],"Fotografia mensal legada")
 add(str(cutoff.year),monthly[current],"Posição diária de referência")
 for month in months:add(f"{names[month.month-1]}/{month.year%100:02d}",monthly[month],"Posição diária de referência" if month==current else "Fotografia mensal legada")
 for day in days:add(day.strftime("%d/%m"),daily[day],"Reconstruído por consulta Oracle atual" if day in reconstructed else "Fotografia diária legada")
 targets=[[f"{names[d.month-1]}/{d.year%100:02d}",sum(monthly[d].values()),goalmap[d.year,d.month]] for d in months]
 return {"metadata":(["data_atualizacao","referencia","dias_reconstruidos"],[[cutoff.isoformat(),ref.isoformat(),len(reconstructed)]]),"lives":(["Período","Empresarial","Individual","Adesão","Total"],rows),"goals":(["Competência","Total","Meta"],targets),"origins":(["Período","Origem"],details)}

def collect(report,values,goals):
 r=source(report);ref=date.fromisoformat(prepare_values(report,values)["data_referencia"])
 cutoff,months,days=periods(ref);previous=date(cutoff.year-1,12,1)
 monthly={};daily={}
 for run in historical_runs(report):
  # Access by explicit unit-scoped query: relation name varies across older migrations.
  records=ReportSnapshotDataRow.objects.filter(unit=report.unit,run=run).values_list("payload",flat=True)
  groups=[(row["contract"],row["active"],row["total"]) for row in records]
  if run.period_type=="month":
   if run.reference_date in monthly:fail("Mais de uma fotografia mensal; revise a origem.")
   monthly[run.reference_date]=sum_contracts(groups)
  else:
   if run.reference_date in daily:fail("Mais de uma fotografia diária; revise a origem.")
   daily[run.reference_date]=sum_contracts(groups)
 reconstructed=[]
 with connect(r.connection) as db:
  for day in days:
   if day in daily:continue
   cols,rows=run_query(r,{"data_alvo":day.isoformat()},session=db,typed=True)
   if cols!=["TP_CONTRATO","SN_ATIVO","DATA_FILTRO","TOTAL"]:fail("Colunas Oracle incompatíveis.")
   if any((row[2].date() if isinstance(row[2],datetime) else row[2])!=day for row in rows):fail("Oracle retornou outra data de referência.")
   daily[day]=sum_contracts([(row[0],row[1],row[3]) for row in rows]);reconstructed.append(day)
 # Current month and annual current bar use the same yesterday position, never a sum.
 monthly[date(cutoff.year,cutoff.month,1)]=daily[cutoff]
 return build_tables(ref,monthly,daily,goals,reconstructed)
