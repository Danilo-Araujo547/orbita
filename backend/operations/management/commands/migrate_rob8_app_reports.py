import json,re,unicodedata
from django.core.management.base import BaseCommand,CommandError
from django.db import transaction
from core.models import Unit,Audit
from operations.models import ReportDefinition,ReportApplicationConnection,ReportAutomation,ReportSchedule,ReportRecipient,ReportGrant
from operations.report_canvas.ports import layout,source,text,block,make_layout
from operations.report_canvas.schema import validate_layout
from operations.reporting import readiness

SCHEMA={"start":{"type":"date","required":False,"prompt":"Informe a data inicial (DD/MM/AAAA). Em branco: início do mês."},"end":{"type":"date","required":False,"prompt":"Informe a data final (DD/MM/AAAA). Em branco: hoje.","not_before":"start"}}

def slug(value):return re.sub(r"[^a-z0-9]+","-",unicodedata.normalize("NFKD",value).encode("ascii","ignore").decode().lower()).strip("-")[:48]

def primitive(r):
 rec=r.legacy.get("record",{});proc=str(rec.get("PROCEDIMENTO","")).lower();sql=str(r.legacy.get("original_sql","")).upper();code=r.code
 if proc=="proc_desempenho_equipe":
  params={p.get("NOME","").upper():str(p.get("CONTEUDO","")).strip() for p in r.legacy.get("parameters",[])}
  kind=params.get("TIPO");metric={"1":"calls","2":"response_stats","3":"response_counts","4":"contacted","5":"contacted"}.get(kind)
  if not metric:return None
  purpose="postoperative" if any("CIR" in v.upper() for k,v in params.items() if "ENVIO" in k) else "appointment"
  return metric,{"purpose":purpose,"basis":"interaction" if metric=="calls" else "response" if metric=="response_counts" else "event"}
 if proc=="proc_gestao_mensagens":return "message_management",{"basis":"created"}
 if code in {"legacy123-47","legacy123-48","legacy123-49"}:return {"legacy123-47":"not_confirmed","legacy123-48":"confirmed","legacy123-49":"not_sent"}[code],{"purpose":"appointment"}
 if code=="legacy123-327":return "absence_ranking",{"purpose":"absence"}
 if "TBAVISOS" not in sql:return None
 filters={"purpose":"absence","basis":"response" if "DATA_RESPOSTA BETWEEN" in sql else "event"}
 if "PARAM20 = '93-1'" in sql:filters["origin_code"]="93-1"
 if "MOTIVO AUSENCIA" in sql:
  if re.search(r"COUNT\s*\(\s*DISTINCT\s*\(?T\.RESPOSTA",sql):metric="absence_distinct"
  elif "PERCENTUAL" in sql:metric="absence_ranking"
  elif "GROUP BY" in sql and "ESPECIALIDADE" in sql:metric="absence_specialty"
  elif code=="legacy123-552":metric="absence_imported";filters["basis"]="created"
  else:metric="absence_detail"
  return metric,filters
 if "CAMPANHA RH" in sql:return "campaign_detail",{"category":"CAMPANHA RH","basis":"created"}
 if "PÓS CIRÚRGICO" in sql:return "postoperative_daily",{"purpose":"postoperative","basis":"created"}
 if "BUSCA ATIVA CDR" in sql:return "campaign_detail",{"purpose":"waitlist","basis":"created","procedure_in":["OFTALMO CATARATA","OFTALMO GLAUCOMA"]}
 if "CAMPANHA BUSCA ATIVA" in sql:return "campaign_detail",{"category":"CAMPANHA BUSCA ATIVA","basis":"created"}
 return None


def candidates(reports):
 leaves={r.code:primitive(r) for r in reports if primitive(r)}
 selected=set(leaves)
 for _ in range(30):
  new={r.code for r in reports if r.components and all(isinstance(c,dict) and c.get("code") in selected for c in r.components)}
  if new<=selected:break
  selected|=new
 return leaves,[r for r in reports if r.code in selected]


def compose(r,bycode):
 result=layout(1600,1000);seen=set()
 def add(child,depth=0):
  if depth>15 or child.code in seen:raise CommandError("Composição circular ou duplicada: "+child.code)
  seen.add(child.code)
  if child.handler=="app_operational_v1":
   index=len(result["sources"]);sid="part"+str(index);result["sources"].append(source(child,id=sid))
   result["pages"].append({"id":"p"+str(index),"name":child.name[:100],"blocks":[text("title"+str(index),child.name,32,28,1536,50,22),block("table"+str(index),"table",32,100,1536,850,source=sid,font_size=9)]})
  else:
   for part in child.components:add(bycode[part["code"]],depth+1)
 add(r)
 result["export_format"]="pdf";return validate_layout(result)

class Command(BaseCommand):
 help="Adapta relatórios operacionais legados para fontes SCV, sem envios."
 def add_arguments(self,parser):parser.add_argument("--apply",action="store_true")
 def handle(self,*args,**options):
  reports=list(ReportDefinition.objects.filter(unit__slug="scv",code__startswith="legacy123-").select_related("unit"));leaves,targets=candidates(reports)
  if not options["apply"]:
   self.stdout.write(json.dumps({"targets":len(targets),"primitives":len(leaves),"codes":[r.code for r in targets]},ensure_ascii=False));return
  if any("app_migration" in r.legacy for r in targets):raise CommandError("Migração já aplicada; revisar os cadastros existentes sem sobrescrever layouts.")
  with transaction.atomic():
   anchor=Unit.objects.get(slug="scv");bycode={r.code:r for r in reports};scope={};created=[]
   for key,name in [("ame-jales","AME Jales"),("ame-santa-fe","AME Santa Fé"),("nas","NAS")]:
    u,new=Unit.objects.get_or_create(slug=key,defaults={"name":name,"paused":True})
    if new:created.append(u.slug)
   clinic_names={}
   for item in targets:
    if str(item.legacy.get("record",{}).get("ID_BASE"))!="9":continue
    prefix=item.name.split(" - ")[0].strip()
    for param in item.legacy.get("parameters",[]):
     if param.get("NOME","").upper() in {"UNIDADE DE SAUDE","UNIDADE SAUDE"} and param.get("CONTEUDO"):
      clinic_names.setdefault(prefix,set()).add(str(param["CONTEUDO"]).strip())
   for r in targets:
    if r.code not in leaves:continue
    rec=r.legacy.get("record",{});base=str(rec.get("ID_BASE",""));params=r.legacy.get("parameters",[])
    clinic=next((str(p.get("CONTEUDO","")).strip() for p in params if p.get("NOME","").upper() in {"UNIDADE DE SAUDE","UNIDADE SAUDE"} and p.get("CONTEUDO")),"")
    prefix=r.name.split(" - ")[0].strip()
    if base=="9" and (clinic or " - " in r.name and "INDICADOR" not in r.name):
     names=clinic_names.get(prefix,set())
     if not clinic and len(names)==1:clinic=next(iter(names))
     if not clinic:raise CommandError("Consultório sem filtro comprovado: "+r.code)
     key="nas";u=Unit.objects.get(slug=key)
     metric,filters=leaves[r.code];leaves[r.code]=(metric,{**filters,"clinic":clinic})
    else:
     key={"7":"ame","19":"ame","8":"sansaude","10":"ame-jales","11":"ame-santa-fe","21":"nas","9":"nas"}.get(base)
     if not key:raise CommandError("Fonte não identificada: "+r.code)
     u=Unit.objects.get(slug=key)
    connection,new=ReportApplicationConnection.objects.get_or_create(unit=anchor,name="SCV · "+u.name,defaults={"mode":"local","local_unit":u,"enabled":key in {"ame","sansaude","scv"}})
    scope[r.code]=connection
   for r in targets:
    if "app_migration" in r.legacy:continue
    before={k:getattr(r,k) for k in ["source","handler","connection_id","app_connection_id","query_sql","parameter_schema","components","enabled","reviewed","canvas_enabled","canvas_layout","dependencies","unavailable_reason","version"]}
    r.legacy={**r.legacy,"app_migration":{"date":"2026-10-26","previous":before,"status":"adapted","history_imported":False}}
    r.parameter_schema=SCHEMA;r.connection=None;r.query_sql="";r.reviewed=True;r.review_queue=False;r.dependencies=[];r.unavailable_reason="";r.canvas_enabled=True;r.output_format="pdf";r.manual_enabled=True;r.enabled=False
    if r.code in leaves:
     metric,filters=leaves[r.code];r.source="app";r.handler="app_operational_v1";r.app_connection=scope[r.code];r.components=[]
     r.legacy["app_report"]={"metric":metric,"filters":filters,"definition_version":1}
     r.legacy["source_path"]="SCV "+scope[r.code].name+" → casos, mensagens, respostas e interações da origem configurada → Canvas. Sem consulta ao ROB8."
     r.canvas_layout=make_layout(r)
    else:
     r.source="composite";r.handler="";r.app_connection=None
    r.version+=1;r.save()
   pending=[r for r in targets if r.code not in leaves];done=set(leaves)
   for r in targets:
    if r.code in leaves:
     r.enabled=not readiness(r);r.save(update_fields=["enabled"])
   for _ in range(30):
    ready=[r for r in pending if all(c["code"] in done for c in r.components)]
    if not ready:break
    for r in ready:
     r.canvas_layout=compose(r,bycode);r.legacy["source_path"]="Composição de componentes operacionais do SCV; cada fonte possui conexão de instância explícita. Sem ROB8."
     r.save(update_fields=["canvas_layout","legacy"]);r.enabled=not readiness(r);r.save(update_fields=["enabled"]);done.add(r.code);pending.remove(r)
   if pending:raise CommandError("Composições não resolvidas: "+str([r.code for r in pending]))
   recipient=ReportRecipient.objects.get(pk=112,active=True,verified_at__isnull=False)
   results=[]
   for r in targets:
    ReportAutomation.objects.filter(report=r,enabled=True).update(enabled=False);ReportSchedule.objects.filter(report=r,enabled=True).update(enabled=False)
    if r.catalog_kind=="report":
     g,new=ReportGrant.objects.get_or_create(unit=anchor,report=r,recipient=recipient,defaults={"active":True,"manual":True,"automatic":False})
     if not g.active or not g.manual or g.automatic:
      g.active=True;g.manual=True;g.automatic=False;g.version+=1;g.save(update_fields=["active","manual","automatic","version"])
    Audit.objects.create(unit=anchor,action="report.rob8_adapted",object_id=str(r.pk),details={"code":r.code,"enabled":r.enabled,"connection":r.app_connection_id,"source":r.source,"sends":False})
    results.append({"id":r.pk,"code":r.code,"name":r.name,"kind":r.catalog_kind,"enabled":r.enabled,"source":r.source,"connection":r.app_connection.name if r.app_connection_id else "Composição de fontes SCV","pending":readiness(r)})
   self.stdout.write(json.dumps({"adapted":len(results),"new_units":created,"enabled":sum(r["enabled"] for r in results),"reports":results},ensure_ascii=False))
