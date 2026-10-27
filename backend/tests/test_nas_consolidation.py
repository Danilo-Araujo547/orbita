import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from core.models import Unit
from operations.models import ReportApplicationConnection,ReportDefinition,Case,SourceEvent
from operations.nas_consolidation import consolidate


def setup_sources(setup):
 nas=Unit.objects.create(slug="nas",name="NAS")
 cm=Unit.objects.create(slug="cm-cecap",name="CECAP")
 target=ReportApplicationConnection.objects.create(unit=setup["unit"],name="NAS",local_unit=nas)
 source=ReportApplicationConnection.objects.create(unit=setup["unit"],name="CECAP",local_unit=cm)
 r=ReportDefinition.objects.create(unit=setup["unit"],code="clinic",name="CECAP",handler="app_operational_v1",source="app",app_connection=source,legacy={"parameters":[{"NOME":"UNIDADE DE SAUDE","CONTEUDO":"CECAP oficial"}],"app_report":{"metric":"response_stats","filters":{"purpose":"appointment"}}})
 return nas,cm,target,source,r


def test_consolidates_without_losing_clinic_filter(setup):
 nas,cm,target,source,r=setup_sources(setup)
 result=consolidate();r.refresh_from_db()
 assert result["merged_units"]==1 and result["updated_reports"]==1
 assert not Unit.objects.filter(slug="cm-cecap").exists()
 assert r.app_connection_id==target.pk
 assert r.legacy["app_report"]["filters"]["clinic"]=="CECAP oficial"
 assert consolidate()["merged_units"]==0


def test_refuses_to_delete_operational_records_and_rolls_back(setup):
 nas,cm,target,source,r=setup_sources(setup)
 event=SourceEvent.objects.create(unit=cm,source="test",external_id="1",kind="appointment",occurred_at=timezone.now())
 with pytest.raises(ValidationError):consolidate()
 assert Unit.objects.filter(pk=cm.pk).exists() and SourceEvent.objects.filter(pk=event.pk).exists()
 r.refresh_from_db();assert r.app_connection_id==source.pk


def test_does_not_merge_distinct_active_or_remote_sources(setup):
 nas,cm,target,source,r=setup_sources(setup);source.enabled=True;source.save()
 with pytest.raises(ValidationError):consolidate()
 assert Unit.objects.filter(pk=cm.pk).exists()


def test_unknown_clinic_filter_does_not_broaden_report(setup):
 nas,cm,target,source,r=setup_sources(setup);r.legacy["parameters"]=[];r.save()
 with pytest.raises(ValidationError):consolidate()
 r.refresh_from_db();assert r.app_connection_id==source.pk


def test_consolidated_reports_keep_consultorios_separate(setup):
 from operations.app_reporting import collect
 nas,cm,target,source,r=setup_sources(setup)
 target.enabled=True;target.save()
 for clinic in ["CECAP oficial","Outro consultório"]:
  event=SourceEvent.objects.create(unit=nas,source="test",external_id=clinic,kind="appointment",patient="Teste",occurred_at=timezone.now(),data={"clinic":clinic})
  Case.objects.create(unit=nas,event=event,purpose="appointment")
 consolidate();r.refresh_from_db()
 columns,rows=collect(r,{})
 assert rows==[["Sem resposta WhatsApp",1,1,100.0]]
