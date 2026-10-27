"""Allowlisted reports over SCV operational data; no legacy reads or transport."""
import hashlib,json
from collections import Counter,defaultdict
from datetime import date,datetime,time,timedelta
from zoneinfo import ZoneInfo
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from operations.models import Case,Interaction
from messaging.models import Message
from responses.models import Reply

HANDLER="app_operational_v1"
OUTCOME_LABELS={"confirmed":"Confirmado","declined":"Recusado","wrong_person":"Não conhece o paciente","invalid_contact":"Contato inválido","opt_out":"Não receber mensagens","well":"Informou estar bem","needs_attention":"Requer atendimento","review":"Interpretação pendente","stay_waitlist":"Permanece na fila","leave_waitlist":"Saiu da fila","acknowledged":"Ciente"}
LIST_COLUMNS=["Paciente","Código","Telefones","Tipo","Procedimento","Data","Entrega","Resposta","Data da resposta","Contato da resposta","Respondido por","Resultado"]
METRICS={
 "confirmed":LIST_COLUMNS,"not_confirmed":LIST_COLUMNS,"not_sent":LIST_COLUMNS,"combined":LIST_COLUMNS,
 "response_stats":["Resultado","Agendamentos","Total de agendamentos","Percentual"],
 "response_counts":["Data da resposta","Respostas recebidas","Agendamentos que responderam"],
 "contacted":["Período","Agendamentos com envio registrado","Agendamentos contatados por telefone","Agendamentos únicos contatados"],
 "calls":["Atendente","Ligações","Dias com ligações","Média por dia com ligações","Atendidas","Não atendidas"],
 "message_management":["Situação","Mensagens","Agendamentos únicos"],
 "absence_detail":LIST_COLUMNS,"absence_imported":LIST_COLUMNS,
 "absence_specialty":["Procedimento","Resposta","Agendamentos"],
 "absence_ranking":["Resposta","Agendamentos","Total de agendamentos respondidos","Percentual"],
 "absence_distinct":["Procedimento","Tipos distintos de resposta"],
 "postoperative_daily":["Data","Agendamentos","Com envio registrado","Sem envio registrado","Aguardando resposta","Respondidos"],
 "campaign_detail":LIST_COLUMNS,
}
FILTER_KEYS={"purpose","category","clinic","basis","origin_code","procedure_in"}


def fail(text):raise ValidationError(text)

def spec(report):
 s=report.legacy.get("app_report",{})
 if report.handler!=HANDLER or report.source!="app" or s.get("metric") not in METRICS:fail("Relatório operacional do SCV não configurado.")
 validate_filters(s.get("filters",{}));return s


def validate_filters(filters):
 if not isinstance(filters,dict) or set(filters)-FILTER_KEYS:fail("Filtros operacionais inválidos.")
 if any((not isinstance(v,str) or len(v)>200) for k,v in filters.items() if k!="procedure_in"):fail("Filtro operacional inválido.")
 if "procedure_in" in filters and (not isinstance(filters["procedure_in"],list) or not 1<=len(filters["procedure_in"])<=10 or any(not isinstance(v,str) or len(v)>200 for v in filters["procedure_in"])):fail("Procedimentos inválidos.")
 if filters.get("purpose") and filters["purpose"] not in {"appointment","absence","postoperative","waitlist","summons","movement"}:fail("Finalidade inválida.")
 if filters.get("basis","event") not in {"event","response","created","interaction"}:fail("Referência temporal inválida.")
 return filters


def date_range(unit,values):
 if not isinstance(values,dict) or set(values)-{"start","end"}:fail("Informe apenas data inicial e final.")
 today=timezone.localtime(timezone.now(),ZoneInfo(unit.timezone)).date()
 try:
  start=date.fromisoformat(str(values.get("start") or today.replace(day=1)))
  end=date.fromisoformat(str(values.get("end") or today))
 except (TypeError,ValueError):fail("Datas inválidas.")
 if end<start or (end-start).days>366:fail("Período inválido ou superior a 366 dias.")
 return start,end


def connection(report):
 c=report.app_connection
 if not c or c.unit_id!=report.unit_id or not c.enabled:fail("Configure e ative a conexão do app deste relatório.")
 if c.mode=="local":
  if not c.local_unit_id or c.remote_instance_id:fail("Selecione a unidade da instância local.")
 elif c.mode=="remote":
  remote=c.remote_instance
  if c.local_unit_id or not remote or remote.local_unit_id!=report.unit_id or not remote.enabled or remote.state!="connected" or remote.remote_role!="admin":fail("Vincule uma instância remota conectada com chave administrativa.")
 else:fail("Tipo de conexão inválido.")
 return c


def manifest(report):
 s=spec(report);c=connection(report)
 return {"adapter_version":1,"spec":s,"connection_id":c.pk,"connection_version":c.version,"mode":c.mode,"local_unit":c.local_unit_id,"remote_id":str(c.remote_instance_id or ""),"remote_version":c.remote_instance.version if c.remote_instance_id else None}


def bounded(qs,limit,label):
 rows=list(qs[:limit+1])
 if len(rows)>limit:fail("Limite de "+label+" excedido; reduza o período.")
 return rows


def local_data(unit,metric,values,filters):
 if metric not in METRICS:fail("Indicador não permitido.")
 filters=validate_filters(filters);start,end=date_range(unit,values);zone=ZoneInfo(unit.timezone)
 lo=datetime.combine(start,time.min,zone);hi=datetime.combine(end+timedelta(days=1),time.min,zone)
 qs=Case.objects.filter(unit=unit,event__unit=unit).exclude(purpose="report").select_related("event","event__appointment","assignee").prefetch_related("event__contact_set")
 if filters.get("purpose"):qs=qs.filter(purpose=filters["purpose"])
 basis=filters.get("basis","event")
 if basis=="interaction":
  qs=qs.filter(pk__in=Interaction.objects.filter(case__unit=unit,kind="call",occurred_at__gte=lo,occurred_at__lt=hi).values_list("case_id",flat=True))
 elif basis!="response":
  field="event__created_at" if basis=="created" else "event__occurred_at"
  qs=qs.filter(**{field+"__gte":lo,field+"__lt":hi})
 else:
  eligible=Reply.objects.filter(unit=unit,message__unit=unit,event__occurred_at__gte=lo,event__occurred_at__lt=hi).values_list("message__case_id",flat=True)
  qs=qs.filter(pk__in=eligible)
 cases=bounded(qs.order_by("event__occurred_at","pk"),10000,"agendamentos")
 def data(c,key):
  raw=c.event.data;standard=raw.get("standardized",{})
  aliases={"procedure":"tipo","patient_id":"codigo","clinic":"local"}
  return raw.get(key) or raw.get(aliases.get(key,"")) or standard.get(aliases.get(key,key),"")
 if filters.get("category"):cases=[c for c in cases if str(data(c,"category") or data(c,"campaign_type") or data(c,"type"))==filters["category"]]
 if filters.get("clinic"):cases=[c for c in cases if str(data(c,"clinic") or data(c,"health_unit") or data(c,"unidade_saude"))==filters["clinic"]]
 if filters.get("procedure_in"):cases=[c for c in cases if str(data(c,"procedure") or (c.event.appointment.procedure if c.event.appointment_id else "")) in filters["procedure_in"]]
 if filters.get("origin_code"):cases=[c for c in cases if str(data(c,"origin_code") or data(c,"PARAM20"))==filters["origin_code"]]
 byid={c.pk:c for c in cases};byapp={c.event.appointment_id:c.pk for c in cases if c.event.appointment_id}
 mq=Message.objects.filter(unit=unit).filter(Q(case_id__in=byid)|Q(case__isnull=True,appointment_id__in=byapp))
 messages=bounded(mq.order_by("created_at","pk"),50000,"mensagens")
 bycase=defaultdict(list);valid=[]
 for m in messages:
  cid=m.case_id or byapp.get(m.appointment_id)
  if cid not in byid or m.appointment_revision!=byid[cid].event.revision:continue
  bycase[cid].append(m);valid.append(m)
 mids={m.pk:(m.case_id or byapp.get(m.appointment_id)) for m in valid}
 replies=bounded(Reply.objects.filter(unit=unit,message_id__in=mids,message__unit=unit).select_related("event").order_by("event__occurred_at","pk"),50000,"respostas")
 responses=defaultdict(list)
 for r in replies:
  if basis=="response" and not lo<=r.event.occurred_at<hi:continue
  responses[mids[r.message_id]].append(r)
 if basis=="response":cases=[c for c in cases if responses[c.pk]]
 actions=bounded(Interaction.objects.filter(case_id__in=byid,case__unit=unit,occurred_at__gte=lo,occurred_at__lt=hi,kind="call").select_related("actor").order_by("occurred_at","pk"),50000,"ligações")
 calls=defaultdict(list)
 for action in actions:calls[action.case_id].append(action)
 accepted={"accepted","sent","delivered","read"};sent={c.pk for c in cases if any(m.state in accepted for m in bycase[c.pk])};answered={c.pk for c in cases if responses[c.pk]}
 def response(c):
  rs=responses[c.pk]
  return rs[-1].text if rs else ""
 def record(c):
  ms=bycase[c.pk];rs=responses[c.pk];a=c.event.appointment
  phones=sorted({p for p in [c.event.phone,*[m.recipient for m in ms],*[contact.phone for contact in c.event.contact_set.all() if contact.unit_id==unit.pk]] if p})
  kind={"consultation":"Consulta","exam":"Exame","lab":"Laboratório","postprocedure":"Pós-procedimento"}.get(a.kind if a else c.event.kind,c.get_purpose_display())
  return [c.event.patient,str(data(c,"patient_id") or c.event.external_id),", ".join(phones),kind,str(data(c,"procedure") or (a.procedure if a else "")),timezone.localtime(c.event.occurred_at,zone).strftime("%d/%m/%Y %H:%M"),"; ".join(sorted({m.get_state_display() for m in ms})) or "Não executada",response(c),timezone.localtime(rs[-1].event.occurred_at,zone).strftime("%d/%m/%Y %H:%M") if rs else "",rs[-1].sender if rs else "",str(rs[-1].event.data.get("sender_name", "")) if rs and isinstance(rs[-1].event.data,dict) else "",OUTCOME_LABELS.get(c.outcome,c.outcome)]
 if metric in {"confirmed","not_confirmed","not_sent","combined"}:
  if metric=="confirmed":selected=[c for c in cases if c.outcome=="confirmed"]
  elif metric=="not_confirmed":selected=[c for c in cases if c.pk in sent and c.outcome!="confirmed"]
  elif metric=="not_sent":selected=[c for c in cases if c.pk not in sent and not any(m.state in {"sending","uncertain"} for m in bycase[c.pk])]
  else:selected=[c for c in cases if c.outcome!="confirmed"]
  rows=[record(c) for c in selected]
 elif metric in {"absence_detail","campaign_detail","absence_imported"}:
  rows=[record(c) for c in cases if metric=="absence_imported" or c.pk in answered]
 elif metric=="response_stats":
  counts=Counter((c.outcome or responses[c.pk][-1].classification or "Resposta livre") if c.pk in answered else "Sem resposta WhatsApp" for c in cases);total=len(cases)
  rows=[[OUTCOME_LABELS.get(k,k),n,total,round(n*100/total,2)] for k,n in sorted(counts.items())] if total else []
 elif metric=="response_counts":
  counts=Counter();events=defaultdict(set)
  for c in cases:
   for r in responses[c.pk]:
    day=timezone.localtime(r.event.occurred_at,zone).date().isoformat();counts[day]+=1;events[day].add(c.event_id)
  rows=[[day,counts[day],len(events[day])] for day in sorted(counts)]
 elif metric=="contacted":
  byphone={c.pk for c in cases if any(a.outcome=="answered" for a in calls[c.pk])}
  rows=[[f"{start:%d/%m/%Y} a {end:%d/%m/%Y}",len(sent),len(byphone),len(sent|byphone)]]
 elif metric=="calls":
  staff=defaultdict(list)
  for action in actions:staff[action.actor.username if action.actor else "Sem autor"].append(action)
  rows=[]
  for actor,group in sorted(staff.items()):
   days=len({timezone.localtime(a.occurred_at,zone).date() for a in group});rows.append([actor,len(group),days,round(len(group)/days,2),sum(a.outcome=="answered" for a in group),sum(a.outcome=="not_answered" for a in group)])
 elif metric=="message_management":
  counts=Counter(m.get_state_display() for m in valid);events=defaultdict(set)
  for m in valid:events[m.get_state_display()].add(mids[m.pk])
  rows=[[state,n,len(events[state])] for state,n in sorted(counts.items())]
 elif metric=="postoperative_daily":
  groups=defaultdict(list)
  for c in cases:groups[timezone.localtime(c.event.created_at,zone).date().isoformat()].append(c)
  rows=[[day,len(cs),sum(c.pk in sent for c in cs),sum(c.pk not in sent for c in cs),sum(c.pk in sent and c.pk not in answered for c in cs),sum(c.pk in answered for c in cs)] for day,cs in sorted(groups.items())]
 elif metric=="absence_ranking":
  counts=Counter(response(c) for c in cases if c.pk in answered);total=sum(counts.values());rows=[[k,n,total,round(n*100/total,2)] for k,n in counts.most_common()] if total else []
 elif metric=="absence_specialty":
  counts=Counter((str(data(c,"procedure") or "Não informado"),response(c)) for c in cases if c.pk in answered);rows=[[sp,r,n] for (sp,r),n in sorted(counts.items())]
 elif metric=="absence_distinct":
  groups=defaultdict(set)
  for c in cases:
   if c.pk in answered:groups[str(data(c,"procedure") or "Não informado")].add(response(c))
  rows=[[sp,len(rs)] for sp,rs in sorted(groups.items())]
 else:fail("Indicador não implementado.")
 return METRICS[metric],rows


def collect(report,values):
 s=spec(report);c=connection(report)
 if c.mode=="local":return local_data(c.local_unit,s["metric"],values,s.get("filters",{}))
 from core.federation_network import remote_http,decrypt_key
 remote=c.remote_instance
 status,_,raw=remote_http(remote.base_url,decrypt_key(remote.key_ciphertext),"reports/app-data/",query={"unit":remote.remote_unit_slug,"metric":s["metric"],"filters":json.dumps(s.get("filters",{})),**values},role="admin")
 if status!=200:fail("Não foi possível consultar a instância remota.")
 try:
  result=json.loads(raw);columns=result["columns"];rows=result["rows"]
  if result.get("protocol")!="scv-app-reports/1" or result.get("unit")!=remote.remote_unit_slug:raise ValueError
  if columns!=METRICS[s["metric"]] or not isinstance(rows,list) or len(rows)>10000:raise ValueError
  if any(not isinstance(row,list) or len(row)!=len(columns) or any(type(v) not in {str,int,float,bool,type(None)} for v in row) for row in rows):raise ValueError
 except (ValueError,KeyError,TypeError):fail("Resposta incompatível da instância remota.")
 return columns,rows
