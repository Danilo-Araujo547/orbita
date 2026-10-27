"""Exams per attendance: readonly Oracle sources and legacy-compatible arithmetic."""
import hashlib
from collections import defaultdict
from datetime import date,datetime,timedelta
from decimal import Decimal,ROUND_HALF_UP
from zoneinfo import ZoneInfo
from django.utils import timezone
from rest_framework.exceptions import ValidationError,PermissionDenied
from operations.models import ReportDefinition
from operations.report_engine import connect,run_query,parameters

HANDLER="exams_per_attendance_v1"
CODES={"exams":"exams-attendance-exams-source","attendances":"exams-attendance-visits-source"}

def fail(message):raise ValidationError(message)

def sources(report):
 if report.unit.slug!="scv" or report.code!="legacy123-53" or report.source!="composite":fail("Definição de exames por atendimento incompatível.")
 if not isinstance(report.components,list) or len(report.components)!=2:fail("Configure as duas fontes Oracle.")
 entries={entry.get("code"):entry for entry in report.components if isinstance(entry,dict)}
 if set(entries)!=set(CODES.values()):fail("Fontes de exames/atendimentos incompatíveis.")
 goal=entries[CODES["exams"]].get("goal")
 try:
  if isinstance(goal,bool):raise ValueError()
  goal=Decimal(str(goal))
  if not goal.is_finite() or goal<=0 or goal>100:raise ValueError()
 except Exception:fail("Configure a meta de exames por atendimento.")
 found={}
 for kind,code in CODES.items():
  source=ReportDefinition.objects.filter(unit=report.unit,code=code,catalog_kind="component",source="sql",enabled=True,reviewed=True).select_related("unit","connection").first()
  if not source or not source.connection or source.connection.unit_id!=report.unit_id or source.connection.engine!="oracle" or not source.connection.enabled or not source.connection.validated:fail("Fonte Oracle indisponível: "+code)
  if set(source.parameter_schema)!={"WPA_DATA_INICIAL","WPA_DATA_FINAL"}:fail("Parâmetros da fonte incompatíveis.")
  found[kind]=source
 if len({r.connection_id for r in found.values()})!=1:fail("As duas fontes devem usar a mesma conexão Oracle.")
 return found,goal

def definition_snapshot(report):
 found,goal=sources(report)
 return {"version":1,"goal":str(goal),"sources":{kind:{"id":r.pk,"version":r.version,"sql_sha256":hashlib.sha256(r.query_sql.encode()).hexdigest(),"schema":r.parameter_schema,"connection":r.connection_id,"connection_version":r.connection.version} for kind,r in found.items()}}

def prepare_values(report,values,*,origin="panel",recipient=None):
 if origin not in {"panel","whatsapp"}:raise PermissionDenied("Programação automática não homologada para este relatório.")
 parsed=parameters(report,values)
 today=timezone.localtime(timezone.now(),ZoneInfo(report.unit.timezone)).date()
 ref=parsed.get("data_referencia") or today
 if not date(2024,1,1)<=ref<=today:fail("Informe uma data de referência entre 2024 e hoje.")
 return {"data_referencia":ref.isoformat()}

def windows(ref):
 base=ref.year*12+ref.month-1
 months=[date((base-i)//12,(base-i)%12+1,1) for i in range(12,-1,-1)]
 days=[ref-timedelta(days=i) for i in range(8,0,-1)]
 names=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]
 periods=[("Y",date(ref.year-1,1,1),str(ref.year-1)),("Y",date(ref.year,1,1),str(ref.year))]
 periods += [("M",d,f"{names[d.month-1]}/{d.year%100:02d}") for d in months]
 periods += [("D",d,d.strftime("%d/%m")) for d in days]
 return periods

def provider_columns(ref):
 return ["Prestador",*[label for _,_,label in windows(ref)]]


def tables(data,ref,goal):
 totals={};by_provider={};freshness=[]
 for kind,rows in data.items():
  total=defaultdict(int);provider=defaultdict(int)
  for grain,stamp,name,amount,last in rows:
   stamp=stamp.date() if isinstance(stamp,datetime) else stamp
   last=last.date() if isinstance(last,datetime) else last
   value=Decimal(str(amount))
   if grain not in {"M","D"} or not isinstance(stamp,date) or value<0 or value!=value.to_integral():fail("Resultado agregado incompatível.")
   amount=int(value);total[grain,stamp]+=amount;provider[grain,stamp,name]+=amount
   if grain=="M":
    total["Y",date(stamp.year,1,1)]+=amount;provider["Y",date(stamp.year,1,1),name]+=amount
   if isinstance(last,date):freshness.append(last)
  totals[kind]=total;by_provider[kind]=provider
 def ratio(ex,at):return (Decimal(ex)/Decimal(at)).quantize(Decimal(".01"),rounding=ROUND_HALF_UP) if at>0 else Decimal(0)
 periods=windows(ref);overview=[]
 for grain,d,label in periods:
  ex=totals["exams"][grain,d];at=totals["attendances"][grain,d]
  overview.append([label,ex,at,float(ratio(ex,at)),float(goal)])
 # Legacy starts from names in EXAMES and removes names with no current-year exam sum.
 current=date(ref.year,1,1)
 names={name for grain,stamp,name in by_provider["exams"] if grain=="Y" and stamp==current and name is not None}
 ordered=sorted(names,key=lambda name:(-by_provider["exams"]["Y",current,name],name))
 providers=[]
 for name in ordered:
  if len(name)>50:fail("Nome de prestador excede o limite do cadastro legado; revise a correspondência.")
  values=[]
  for grain,d,label in periods:
   result=ratio(by_provider["exams"][grain,d,name],by_provider["attendances"][grain,d,name])
   values.append(float(result) if result>0 else None)
  providers.append([name,*values])
 updated=min([max((r[4].date() if isinstance(r[4],datetime) else r[4] for r in data[kind]),default=date.min) for kind in ["exams","attendances"]])
 return {"metadata":(["data_referencia","meta","atualizado_ate"],[[ref.isoformat(),float(goal),updated.isoformat() if updated!=date.min else "Sem dados"]]),"overview":(["Período","Exames","Atendimentos","Razão","Meta"],overview),"chart":(["Período","Razão","Meta"],[[r[0],r[3],r[4]] for r in overview]),"providers":(provider_columns(ref),providers)}

def collect(report,values):
 found,goal=sources(report)
 ref=date.fromisoformat(prepare_values(report,values)["data_referencia"])
 binds={"WPA_DATA_INICIAL":date(ref.year-1,1,1).isoformat(),"WPA_DATA_FINAL":(ref-timedelta(days=1)).isoformat()}
 results={}
 with connect(found["exams"].connection) as db:
  for kind,source in found.items():
   columns,rows=run_query(source,binds,session=db,typed=True)
   if columns!=["GRAO","PERIODO","PRESTADOR","QUANTIDADE","ULTIMA_DATA"]:fail("Colunas da fonte incompatíveis.")
   results[kind]=rows
 return tables(results,ref,goal)
