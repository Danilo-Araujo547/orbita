"""Allowlisted dataset adapters. Reuses application queries, never rendered PDFs."""
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from types import SimpleNamespace
from django.utils import timezone
from .schema import fail

def medical_headers(ref):
 names=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]
 months=[((ref.year*12+ref.month-1-i)//12,(ref.year*12+ref.month-1-i)%12+1) for i in range(12,-1,-1)]
 labels=[f"{names[m-1]}/{y%100:02d}" for y,m in months]
 return {"specialties":["Especialidade",str(ref.year-1),str(ref.year),*labels],
         "opinions_months":["Especialidade",*labels],
         "opinions_days":["Especialidade",*[(ref-timedelta(days=i)).strftime("%d/%m/%Y") for i in range(10,0,-1)]]}

MEDICAL = {
 "metadata": ["data_atualizacao","gerado_em"],
 "stays": ["Período", "SUS", "Convênio", "Particular"],
 "specialties": lambda ref: medical_headers(ref)["specialties"],
 "ratios": ["Período", "Exames por atendimento", "Meta"],
 "counts": ["Período", "Exames", "Atendimentos"],
 "daily": ["Dia", "Exames", "Atendimentos"],
 "opinions_months": lambda ref: medical_headers(ref)["opinions_months"],
 "opinions_days": lambda ref: medical_headers(ref)["opinions_days"],
}
LOCAL_COLUMNS=["Paciente","Telefone","Finalidade","Data","Resposta","Resultado","Atendimento","Responsável"]

def datasets(report):
 if report.handler=="app_operational_v1":
  from operations.app_reporting import spec,METRICS
  return {"rows":METRICS[spec(report)["metric"]]}
 from operations.reports import HANDLERS
 if report.source == "local" and report.handler in HANDLERS: return {"rows": LOCAL_COLUMNS}
 if report.handler == "occupancy_indicators_v1":
  from operations.occupancy_indicators import DATASETS
  return DATASETS
 if report.handler == "lives_indicators_v1": return {"metadata":["data_atualizacao","referencia","dias_reconstruidos"],"lives":["Período","Empresarial","Individual","Adesão","Total"],"goals":["Competência","Total","Meta"],"origins":["Período","Origem"]}
 if report.handler == "exams_per_attendance_v1":
  from operations.exams_attendance import provider_columns
  return {"metadata":["data_referencia","meta","atualizado_ate"],"overview":["Período","Exames","Atendimentos","Razão","Meta"],"chart":["Período","Razão","Meta"],"providers":provider_columns}
 if report.handler == "medical_indicators_v1": return MEDICAL
 if report.handler == "bed_snapshots_v1": return {"rows": ["CD_UNID_INT","DS_UNID_INT","QUANTIDADE","DATA"]}
 if report.handler == "stock_loans_v1": return {"rows": ["Fornecedor","Tipo","Data","Código","Produto","Unidade","Quantidade","Estoque atual","Localização"], "summary": ["Fornecedor","Itens","Quantidade","Estoque atual"]}
 return {}

def catalog_datasets(report, reference_date=None):
 """Resolve declared schemas for any adapter without consulting source data."""
 from .dataset_schema import resolve_columns
 specs=datasets(report)
 ref=reference_date
 if ref is None and any(callable(columns) for columns in specs.values()):
  from zoneinfo import ZoneInfo
  ref=timezone.localtime(timezone.now(),ZoneInfo(report.unit.timezone)).date()
 return resolve_columns(specs,ref)


def manifest(report):
 if report.handler=="app_operational_v1":
  from operations.app_reporting import manifest as app_manifest
  return app_manifest(report)
 if report.handler == "occupancy_indicators_v1":
  from operations.occupancy_indicators import definition_snapshot
  return definition_snapshot(report)
 if report.handler == "lives_indicators_v1":
  from operations.lives_indicators import definition_snapshot
  return definition_snapshot(report)
 if report.handler == "exams_per_attendance_v1":
  from operations.exams_attendance import definition_snapshot
  return definition_snapshot(report)
 if report.handler == "medical_indicators_v1":
  from operations.medical_indicators import definition_snapshot
  return definition_snapshot(report)
 if report.handler == "bed_snapshots_v1":
  from operations.bed_snapshots import definition_snapshot
  return definition_snapshot(report)
 return {"handler":report.handler}

def medical_tables(data):
 ref=datetime.fromisoformat(data["clock"][0]["DB_TIMESTAMP"]).date()
 months=[((ref.year*12+ref.month-1-i)//12,(ref.year*12+ref.month-1-i)%12+1) for i in range(12,-1,-1)]
 names=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]
 labels=[f"{names[m-1]}/{y%100:02d}" for y,m in months]
 periods=[(ref.year-1,0),(ref.year,0)]+months; periodlabels=[str(ref.year-1),str(ref.year)]+labels
 days8=[(ref-timedelta(days=i)).isoformat() for i in range(8,0,-1)]
 days10=[(ref-timedelta(days=i)).isoformat() for i in range(10,0,-1)]
 def ratio(a,b,precision=2):return float((Decimal(str(a))/Decimal(str(b))).quantize(Decimal(10)**-precision,rounding=ROUND_HALF_UP)) if b else None
 stays=defaultdict(lambda:[0,0]); specialties=defaultdict(lambda:[0,0])
 for r in data["stays"]:
  y,m=int(r["ANO"]),int(r["MES"]);n=int(r["QUANTIDADE"]);v=float(r["DIAS"] or 0)
  for k in [(y,m,r["TIPO_CONVENIO"]),(y,0,r["TIPO_CONVENIO"])]:stays[k][0]+=v;stays[k][1]+=n
  if r["TIPO_CONVENIO"]=="SUS":
   for k in [(r["DS_ESPECIALID"],y,m),(r["DS_ESPECIALID"],y,0)]:specialties[k][0]+=v;specialties[k][1]+=n
 tables={"stays":(MEDICAL["stays"],[[lab,*[ratio(*stays[y,m,ins]) for ins in ["SUS","CONVENIO","PARTICULAR"]]] for (y,m),lab in zip(periods,periodlabels)])}
 import json
 from operations.medical_indicators import asset_root
 layout=json.loads((asset_root()/"layout.json").read_text())
 order=[]
 for r in layout["TBRELATORIO_CORES"]:
  if r["ID_RELATORIO"]==63 and r["CRITERIO"] not in order:order.append(r["CRITERIO"])
 tables["specialties"]=(medical_headers(ref)["specialties"],[[sp,*[ratio(*specialties[sp,y,m]) for y,m in periods]] for sp in order])
 counts={}
 for part in ["exams","attendances"]:
  d={(int(r["ANO"]),int(r["MES"])):int(r["QUANTIDADE"]) for r in data[part]}
  for y in [ref.year-1,ref.year]:d[y,0]=sum(v for (yy,m),v in list(d.items()) if yy==y and m)
  counts[part]=d
 exd={r["DATA"][:10]:int(r["QUANTIDADE"]) for r in data["exams_days"]};atd={r["DATA"][:10]:int(r["QUANTIDADE"]) for r in data["attendances_days"]}
 rows=[[label,counts["exams"].get(k,0),counts["attendances"].get(k,0)] for k,label in zip(periods,periodlabels)]
 daily=[[date.fromisoformat(k).strftime("%d/%m/%Y"),exd.get(k,0),atd.get(k,0)] for k in days8]
 tables["counts"]=(MEDICAL["counts"],rows);tables["daily"]=(MEDICAL["daily"],daily)
 tables["ratios"]=(MEDICAL["ratios"],[[lab,ratio(ex,at),2.5] for lab,ex,at in rows+daily])
 order=['NEUROLOGIA','CIRURGIA GERAL','CARDIOLOGIA','CLINICA GERAL','GINECOLOGIA/OBSTETRICIA','CIRURGIA PEDIATRICA','NEFROLOGIA','ORTOPEDIA/TRAUMATOLOGIA','GINECOLOGIA','UROLOGIA','CIRURGIA CARDIOVASCULAR','GRUPO DE CURATIVOS','CIRURGIA VASCULAR','CIRURGIA TORAXICA']
 for part,fields,labels_ in [("opinions_months",months,labels),("opinions_days",days10,[date.fromisoformat(x).strftime("%d/%m/%Y") for x in days10])]:
  entries={}
  for r in data[part]:
   key=(int(r["ANO"]),int(r["MES"])) if part.endswith("months") else r["DATA"][:10]
   entries[r["DS_ESPECIALID"],key]=(r["DIAS"],int(r["QUANTIDADE"]))
  result=[]
  for sp in order:
   row=[sp]
   for key in fields:
    a,b=entries.get((sp,key),(None,0));v=ratio(float(a),b,5) if a not in (None,"") and b else None
    seconds=int(v*86400) if v is not None else None
    row.append(f"{seconds//3600:02d}:{seconds//60%60:02d}:{seconds%60:02d}" if seconds is not None else "—")
   result.append(row)
  tables[part]=(medical_headers(ref)[part],result)
 dates=[v[0]["ULTIMA_ALTA" if k=="internacao" else "ULTIMA_DATA"] for k,v in data["freshness"].items()]
 tables["metadata"]=(MEDICAL["metadata"],[[min(dates),data["generated_at"]]])
 return tables

def read(ctx, report, dataset, values):
 if report.handler=="app_operational_v1":
  from operations.app_reporting import collect
  from .sources import Dataset
  return Dataset(*collect(report,values))
 from .sources import Dataset
 if dataset not in datasets(report):fail("Conjunto de dados não disponível para este relatório.")
 if report.handler == "occupancy_indicators_v1":
  from operations.occupancy_indicators import collect
  key=("occupancy",report.pk,str(sorted(values.items())))
  if key not in ctx.native_cache:ctx.native_cache[key]=collect(report,values)
  return Dataset(*ctx.native_cache[key][dataset])
 if report.handler == "lives_indicators_v1":
  from operations.lives_indicators import collect
  key=("lives",report.pk,str(sorted(values.items())))
  if key not in ctx.native_cache:ctx.native_cache[key]=collect(report,values,ctx.goals)
  return Dataset(*ctx.native_cache[key][dataset])
 if report.handler == "exams_per_attendance_v1":
  from operations.exams_attendance import collect
  key=("exams_attendance",report.pk,str(sorted(values.items())))
  if key not in ctx.native_cache:ctx.native_cache[key]=collect(report,values)
  return Dataset(*ctx.native_cache[key][dataset])
 if report.handler == "medical_indicators_v1":
  from operations.medical_indicators import collect_data,prepare_values
  values=prepare_values(report,values,origin="panel",recipient=None)
  key=("medical",report.pk,str(sorted(values.items())))
  if key not in ctx.native_cache:ctx.native_cache[key]=medical_tables(collect_data(report,values))
  return Dataset(*ctx.native_cache[key][dataset])
 if report.handler == "bed_snapshots_v1":
  from operations.bed_snapshots import export_selection
  from operations.models import BedSnapshotRow
  _,runs=export_selection(report,values)
  rows=BedSnapshotRow.objects.filter(unit_id=report.unit_id,run__in=runs).select_related("run").order_by("run__reference_date","ward_code")
  return Dataset(datasets(report)[dataset],[[r.ward_code,r.ward_name,r.quantity,r.run.reference_date] for r in rows])
 if report.handler == "stock_loans_v1":
  from operations.stock_loans import prepare_values
  from operations.report_engine import run_query
  values=prepare_values(report,values,origin="panel",recipient=None)
  key=("stock",report.pk,str(sorted(values.items())))
  if key not in ctx.native_cache:ctx.native_cache[key]=run_query(report,values,typed=True)
  cols,rows=ctx.native_cache[key]
  records=[dict(zip([c.upper() for c in cols],r)) for r in rows]
  keys=["DS_FORNECEDOR","TP_EMPRESTIMO","DT_EMPRESTIMO","CPRODUTO","PRODUTO","UNIDADE","QT_ENTRADA","QT_ESTOQUE_ATUAL","DS_LOCALIZACAO"]
  if not set(keys).issubset(c.upper() for c in cols):fail("Colunas de Estoque incompatíveis.")
  records.sort(key=lambda r:str(r["DS_FORNECEDOR"]).casefold())
  if dataset == "summary":
   from itertools import groupby
   def aggregate(label, group):
    group=list(group)
    quantity=sum((Decimal(str(r["QT_ENTRADA"])) for r in group if r["QT_ENTRADA"] is not None),Decimal(0))
    stock="Incompleto" if any(r["QT_ESTOQUE_ATUAL"] is None for r in group) else sum((Decimal(str(r["QT_ESTOQUE_ATUAL"])) for r in group),Decimal(0))
    return [label,len(group),quantity,stock]
   summary=[aggregate(supplier,group) for supplier,group in groupby(records,key=lambda r:str(r["DS_FORNECEDOR"]))]
   if records:summary.append(aggregate("Total geral",records))
   return Dataset(datasets(report)[dataset],summary)
  return Dataset(datasets(report)[dataset],[[r[k] for k in keys] for r in records])
 from operations.reports import local_report_data
 cols,rows=local_report_data(report,values)
 for row in rows:
  if row[3]:
   from zoneinfo import ZoneInfo
   row[3]=datetime.fromisoformat(row[3]).astimezone(ZoneInfo(report.unit.timezone)).replace(tzinfo=None)
 return Dataset(cols,rows)
