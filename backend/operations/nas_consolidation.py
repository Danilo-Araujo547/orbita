"""Consolidate unused municipal unit scaffolding; never discard operational records."""
from django.db import transaction
from rest_framework.exceptions import ValidationError
from core.models import Unit,Audit
from operations.models import ReportApplicationConnection,ReportDefinition,PurposePolicy
from messaging.models import Template


def require(value,message):
 if not value:raise ValidationError(message)


def portable(obj):
 return {f.attname:getattr(obj,f.attname) for f in obj._meta.fields if f.name not in {"id","unit","created_at","updated_at"}}


def assert_unreferenced(obj):
 for relation in obj._meta.related_objects:
  require(not relation.related_model.objects.filter(**{relation.field.name:obj}).exists(),"Cadastro inicial já utilizado: "+obj._meta.label+" "+str(obj.pk))


@transaction.atomic
def consolidate():
 nas=Unit.objects.select_for_update().get(slug="nas")
 units=list(Unit.objects.select_for_update().filter(slug__startswith="cm-").order_by("pk"))
 if not units:return {"merged_units":0,"updated_reports":0,"codes":[]}
 ids=[u.pk for u in units]
 old=list(ReportApplicationConnection.objects.select_for_update().filter(local_unit_id__in=ids))
 require(len(old)==len(units),"Consultórios com conexão ausente ou duplicada; revisar antes de consolidar.")
 require(all(c.mode=="local" and not c.remote_instance_id and not c.enabled for c in old),"Um consultório já possui conexão ativa/remota; revisar a origem antes de consolidar.")
 allowed={(Template,"unit"),(PurposePolicy,"unit"),(ReportDefinition,"unit"),(ReportApplicationConnection,"local_unit")}
 for u in units:
  for rel in u._meta.related_objects:
   if (rel.related_model,rel.field.name) not in allowed:
    require(not rel.related_model.objects.filter(**{rel.field.name:u}).exists(),"Consultório possui dados de operação: "+u.slug+" / "+rel.related_model._meta.label)
 for model,key in [(Template,"name"),(PurposePolicy,"purpose"),(ReportDefinition,"code")]:
  target={getattr(o,key):o for o in model.objects.filter(unit=nas)}
  for obj in model.objects.filter(unit_id__in=ids):
   match=target.get(getattr(obj,key))
   require(match is not None and portable(obj)==portable(match),"Cadastro inicial diferente do NAS: "+model._meta.label+" / "+str(getattr(obj,key)))
   assert_unreferenced(obj)
 anchor_ids={c.unit_id for c in old};require(len(anchor_ids)==1,"Conexões pertencem a catálogos diferentes.")
 target=ReportApplicationConnection.objects.select_for_update().get(unit_id=next(iter(anchor_ids)),local_unit=nas)
 changed=[];mappings=[]
 for c in old:
  reports=list(ReportDefinition.objects.select_for_update().filter(app_connection=c))
  clinics={str(p.get("CONTEUDO","")).strip() for r in reports for p in r.legacy.get("parameters",[]) if p.get("NOME","").upper() in {"UNIDADE DE SAUDE","UNIDADE SAUDE"} and p.get("CONTEUDO")}
  require(len(clinics)==1,"Filtro de consultório não comprovado: "+c.name)
  clinic=clinics.pop()
  for r in reports:
   require(r.handler=="app_operational_v1" and r.unit_id==c.unit_id,"Relatório usa uma configuração não prevista: "+r.code)
   spec=r.legacy["app_report"]
   require(not spec.get("filters",{}).get("clinic") or spec["filters"]["clinic"]==clinic,"Filtro diferente do consultório: "+r.code)
   r.legacy={**r.legacy,"app_report":{**spec,"filters":{**spec.get("filters",{}),"clinic":clinic},"definition_version":spec.get("definition_version",1)+1},"nas_consolidation":{"date":"2026-10-26","previous_connection":c.pk,"previous_unit":c.local_unit.slug,"clinic":clinic},"source_path":"SCV · NAS → filtro de consultório: "+clinic+" → Canvas. Sem consulta ao ROB8."}
   r.app_connection=target;r.version+=1;r.save(update_fields=["app_connection","legacy","version"]);changed.append(r.code)
   Audit.objects.create(unit=r.unit,action="report.nas_consolidated",object_id=str(r.pk),details={"code":r.code,"connection":target.pk,"clinic":clinic,"version":r.version})
  mappings.append({"unit":c.local_unit.slug,"clinic":clinic,"reports":len(reports)})
 for model in [PurposePolicy,ReportDefinition,Template]:model.objects.filter(unit_id__in=ids).delete()
 ReportApplicationConnection.objects.filter(pk__in=[c.pk for c in old]).delete()
 Unit.objects.filter(pk__in=ids).delete()
 nas.name="NAS";nas.version+=1;nas.save(update_fields=["name","version"])
 target.name="SCV · NAS";target.version+=1;target.save(update_fields=["name","version"])
 Audit.objects.create(unit=nas,action="unit.consultorios_consolidated",object_id=str(nas.pk),details={"previous_units":[u.slug for u in units],"mappings":mappings,"reports":len(changed),"operational_rows_deleted":0})
 return {"merged_units":len(units),"updated_reports":len(changed),"codes":changed,"connection":target.pk,"mappings":mappings}
