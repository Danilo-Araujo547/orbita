from datetime import timedelta
from unittest.mock import patch
import json
import pytest
from rest_framework.exceptions import ValidationError
from django.utils import timezone
from core.models import Unit
from operations.models import Case,SourceEvent,Interaction,ReportDefinition,ReportApplicationConnection
from operations.app_reporting import local_data,collect,manifest,METRICS
from messaging.models import Message,ProviderEvent
from responses.models import Reply


def case(setup,unit=None,purpose="appointment",**kwargs):
 unit=unit or setup["unit"]
 event=SourceEvent.objects.create(unit=unit,source="test",external_id=str(SourceEvent.objects.count()),kind="exam",patient="Teste",phone="5511999999999",occurred_at=timezone.now(),data=kwargs.pop("data",{}))
 return Case.objects.create(unit=unit,event=event,purpose=purpose,**kwargs)


def message(setup,c,state="sent",recipient="5511999999999"):
 return Message.objects.create(unit=c.unit,case=c,template=setup["template"],template_name="test",rule_version=1,appointment_revision=c.event.revision,recipient=recipient,scheduled_for=timezone.now(),expires_at=timezone.now()+timedelta(days=1),state=state)


def reply(setup,m,text="SIM"):
 event=ProviderEvent.objects.create(key=str(ProviderEvent.objects.count()),channel_id="test",provider_id=str(m.pk),event_type="reply",occurred_at=timezone.now())
 return Reply.objects.create(unit=m.unit,event=event,message=m,sender=m.recipient,text=text,classification="confirmed")


def config(setup,**kwargs):
 c=ReportApplicationConnection.objects.create(unit=setup["unit"],name="Local",mode="local",local_unit=setup["unit"],enabled=True,**kwargs)
 r=ReportDefinition.objects.create(unit=setup["unit"],name="App",code="app",source="app",handler="app_operational_v1",app_connection=c,reviewed=True,legacy={"app_report":{"metric":"confirmed","filters":{"purpose":"appointment"}}})
 return r,c


def test_two_numbers_count_one_case_and_confirmation_wins(setup):
 c=case(setup,outcome="confirmed");message(setup,c);message(setup,c,recipient="5511888888888")
 cols,rows=local_data(c.unit,"confirmed",{}, {"purpose":"appointment"})
 assert len(rows)==1
 assert "5511888888888" in rows[0][2]
 assert rows[0][-1]=="Confirmado"


def test_not_sent_excludes_in_flight_and_uncertain(setup):
 for state in ["queued","uncertain","sending","accepted","failed"]:message(setup,case(setup),state)
 _,rows=local_data(setup["unit"],"not_sent",{}, {"purpose":"appointment"})
 assert len(rows)==2


def test_units_never_mix_without_explicit_connection(setup):
 other=Unit.objects.create(slug="other",name="Other")
 c=case(setup,other,outcome="confirmed")
 _,rows=local_data(setup["unit"],"confirmed",{}, {"purpose":"appointment"})
 assert not rows
 r,conn=config(setup)
 conn.unit=other;conn.save()
 with pytest.raises(ValidationError):collect(r,{})


def test_response_counts_and_percent_denominator_are_explicit(setup):
 c=case(setup);a=message(setup,c);b=message(setup,c,recipient="5511888888888")
 reply(setup,a);reply(setup,b)
 _,rows=local_data(c.unit,"response_counts",{}, {"purpose":"appointment","basis":"response"})
 assert rows[0][1:]==[2,1]
 _,rows=local_data(c.unit,"absence_ranking",{}, {"purpose":"absence"})
 assert rows==[]


def test_calls_use_actual_actor_and_occurrence_not_assignment(setup):
 c=case(setup);c.event.occurred_at+=timedelta(days=90);c.event.save()
 for _ in range(2):Interaction.objects.create(case=c,actor=setup["user"],kind="call",text="Call",channel="phone",outcome="answered",occurred_at=timezone.now())
 _,rows=local_data(c.unit,"calls",{}, {"purpose":"appointment","basis":"interaction"})
 assert rows[0][1:]==[2,1,2.0,2,0]


def test_latest_reply_per_case_used_for_absence_ranking(setup):
 c=case(setup,purpose="absence");m=message(setup,c);reply(setup,m,"Primeira");reply(setup,m,"Última")
 _,rows=local_data(c.unit,"absence_ranking",{}, {"purpose":"absence"})
 assert rows==[["Última",1,1,100.0]]


def test_dates_filters_and_limits_are_validated(setup):
 for params in [{"unit":"other"},{"start":"x"},{"start":"2026-10-25","end":"2026-10-01"},{"start":"2020-01-01","end":"2026-10-01"}]:
  with pytest.raises(ValidationError):local_data(setup["unit"],"confirmed",params,{})
 with pytest.raises(ValidationError):local_data(setup["unit"],"SQL",{}, {})
 with pytest.raises(ValidationError):local_data(setup["unit"],"confirmed",{}, {"unit":"other"})


def test_empty_data_is_not_failure_or_division_by_zero(setup):
 for metric in METRICS:
  local_data(setup["unit"],metric,{}, {"purpose":"absence"})


def test_disabled_source_blocks_and_connection_version_is_snapshotted(setup):
 r,c=config(setup);initial=manifest(r);c.enabled=False;c.save()
 with pytest.raises(ValidationError):collect(r,{})
 c.enabled=True;c.version+=1;c.save()
 assert manifest(r)!=initial


def test_app_connection_options_and_create_are_unit_scoped(setup):
 client=setup["client"]
 response=client.get("/api/v1/report-app-connections/options/?unit=ame")
 assert response.status_code==200
 response=client.post("/api/v1/report-app-connections/?unit=ame",{"name":"App local","mode":"local","local_unit":setup["unit"].pk,"enabled":True},format="json",HTTP_IDEMPOTENCY_KEY="test-app-source")
 assert response.status_code==200,response.data


def test_app_data_api_is_readonly_and_allowlisted(setup):
 response=setup["client"].get("/api/v1/reports/app-data/?unit=ame&metric=confirmed")
 assert response.status_code==200,response.data
 assert response.data["columns"]==METRICS["confirmed"]
 assert setup["client"].get("/api/v1/reports/app-data/?unit=ame&metric=raw_sql").status_code==400


def test_remote_data_is_bounded_and_never_creates_operational_records(setup):
 import uuid
 from core.models import RemoteInstance
 r,c=config(setup)
 remote=RemoteInstance.objects.create(local_unit=r.unit,name="Remote",base_url="http://10.0.0.2",key_ciphertext="encrypted",remote_instance_id=uuid.uuid4(),remote_unit_slug="jales",remote_role="admin")
 c.mode="remote";c.local_unit=None;c.remote_instance=remote;c.save()
 before=(Case.objects.count(),Message.objects.count(),Reply.objects.count())
 payload={"protocol":"scv-app-reports/1","unit":"jales","columns":METRICS["confirmed"],"rows":[["Paciente","1","phone","consulta","exame","date","Enviada","SIM","date","phone","Perfil","confirmed"]]}
 with patch("core.federation_network.decrypt_key",return_value="key"),patch("core.federation_network.remote_http",return_value=(200,{},json.dumps(payload).encode())) as http:
  cols,rows=collect(r,{})
  assert len(rows)==1
  assert http.call_args.kwargs["query"]["unit"]=="jales"
  assert http.call_args.kwargs["role"]=="admin"
  payload["unit"]="other"
  http.return_value=(200,{},json.dumps(payload).encode())
  with pytest.raises(ValidationError):collect(r,{})
 assert before==(Case.objects.count(),Message.objects.count(),Reply.objects.count())


def test_phone_confirmation_is_not_a_whatsapp_reply(setup):
 c=case(setup,outcome="confirmed");message(setup,c)
 _,rows=local_data(c.unit,"response_stats",{}, {"purpose":"appointment"})
 assert rows==[["Sem resposta WhatsApp",1,1,100.0]]


def test_canvas_generates_without_sending(setup):
 import base64,io
 from pypdf import PdfReader
 from operations.report_canvas.ports import make_layout
 from operations.report_canvas.engine import export
 r,conn=config(setup);r.enabled=True;r.canvas_enabled=True;r.parameter_schema={"start":{"type":"date","required":False},"end":{"type":"date","required":False}};r.save()
 c=case(setup,outcome="confirmed");message(setup,c)
 before=Message.objects.count()
 result,_=export(r,make_layout(r),{},[],"pdf")
 assert len(PdfReader(io.BytesIO(base64.b64decode(result))).pages)>=1
 assert before==Message.objects.count()


def test_legacy_mapping_preserves_fixed_origin_and_purpose(setup):
 from operations.management.commands.migrate_rob8_app_reports import primitive,candidates
 r=ReportDefinition.objects.create(unit=setup["unit"],code="legacy123-412",name="Faltantes",legacy={"original_sql":"select especialidade, resposta, count(*) from tbavisos where tipo = 'MOTIVO AUSENCIA' and PARAM20 = '93-1' group by 1,2"})
 metric,filters=primitive(r)
 assert metric=="absence_specialty" and filters["origin_code"]=="93-1" and filters["purpose"]=="absence"
 parent=ReportDefinition.objects.create(unit=r.unit,code="parent",name="Composição",components=[{"code":r.code}])
 other=ReportDefinition.objects.create(unit=r.unit,code="clinical",name="Clínico",source="sql",query_sql="select * from dbamv.atendime")
 leaves,targets=candidates([r,parent,other])
 assert {x.code for x in targets}=={r.code,parent.code}
 assert other.code not in leaves


def test_remote_response_shape_is_checked(setup):
 from core.models import RemoteInstance
 import uuid
 r,c=config(setup);remote=RemoteInstance.objects.create(local_unit=r.unit,name="Remote",base_url="http://10.0.0.2",key_ciphertext="encrypted",remote_instance_id=uuid.uuid4(),remote_unit_slug="jales",remote_role="admin")
 c.mode="remote";c.local_unit=None;c.remote_instance=remote;c.save()
 payload={"protocol":"scv-app-reports/1","unit":"jales","columns":METRICS["confirmed"],"rows":[["wrong length"]]}
 with patch("core.federation_network.decrypt_key",return_value="key"),patch("core.federation_network.remote_http",return_value=(200,{},json.dumps(payload).encode())):
  with pytest.raises(ValidationError):collect(r,{})


def test_composition_uses_same_readable_width_and_app_sources(setup):
 import io,base64
 from pypdf import PdfReader
 from operations.management.commands.migrate_rob8_app_reports import compose
 from operations.report_canvas.engine import export
 r,conn=config(setup);r.enabled=True;r.save()
 parent=ReportDefinition.objects.create(unit=r.unit,code="composite",name="Composição",source="composite",reviewed=True,canvas_enabled=True,components=[{"code":r.code}])
 doc=compose(parent,{r.code:r,parent.code:parent})
 assert doc["page"]["width"]==1600
 c=case(setup,outcome="confirmed");message(setup,c)
 output,_=export(parent,doc,{},[],"pdf")
 assert len(PdfReader(io.BytesIO(base64.b64decode(output))).pages)==1
