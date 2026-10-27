import pytest
from core.models import Unit, Membership
from django.contrib.auth import get_user_model
from operations.models import ReportDefinition,ReportConnection,ReportSnapshotConfiguration
from operations.report_descriptions import describe,index_for,tables
from operations.report_api import CatalogSerializer
from rest_framework.test import APIRequestFactory,force_authenticate


def report(unit,code="test",**kwargs):
 return ReportDefinition.objects.create(unit=unit,code=code,name="Relatório teste",**kwargs)


def test_sql_description_uses_current_connection_not_old_firebird(setup):
 u=setup["unit"]
 c=ReportConnection.objects.create(unit=u,name="Produção",engine="oracle",database="prdvotu",ciphertext="SECRET-ENCRYPTED",username="PRIVATE-USER")
 r=report(u,source="sql",connection=c,reviewed=True,canvas_enabled=True,query_sql="SELECT * FROM dbamv.atendime",legacy={"source_path":"Firebird legado"})
 d=describe(r,index_for(u.pk))
 assert "Oracle" in d["origin"] and "prdvotu" in d["origin"]
 assert "dbamv.atendime" in d["assembly"] and "Canvas" in d["assembly"]
 assert "Firebird legado" in " ".join(d["routines"])
 assert "SECRET" not in str(d) and "PRIVATE-USER" not in str(d)


def test_sql_literals_and_comments_are_not_source_evidence():
 assert tables("select 'from secret.fake' x from dbamv.atendime -- join fake.secret\n /* from fake.other */ join dbamv.paciente p on 1=1")==["dbamv.atendime","dbamv.paciente"]


def test_components_do_not_cross_units(setup):
 u=setup["unit"];other=Unit.objects.create(slug="other",name="Other")
 hidden=ReportDefinition.objects.create(unit=other,code="hidden",name="PRIVATE COMPONENT")
 r=report(u,source="composite",components=[{"code":"hidden"}],canvas_layout={"sources":[{"type":"report","report_id":hidden.pk}]})
 d=describe(r,index_for(u.pk))
 assert "PRIVATE" not in str(d)
 assert d["components"][0]["name"]=="Componente não localizado nesta unidade"


@pytest.mark.parametrize("handler,fragment",[("medical_indicators_v1","Cinco consultas"),("lives_indicators_v1","Duas páginas"),("exams_per_attendance_v1","Cruza agregados"),("bed_snapshots_v1","fotografias"),("external_pdf_v1","PDF existente"),("stock_loans_v1","movimentos")])
def test_native_adapters_have_specific_assembly(setup,handler,fragment):
 r=report(setup["unit"],handler=handler)
 d=describe(r,index_for(r.unit_id))
 assert fragment in d["assembly"]
 assert d["origin"] and d["snapshots"]


def test_local_report_describes_operational_source(setup):
 r=report(setup["unit"],source="local",handler="confirmed",canvas_enabled=True)
 d=describe(r,index_for(r.unit_id))
 assert "confirmações" in d["summary"] and "SCV" in d["origin"]


def test_pending_procedure_not_presented_as_current_execution(setup):
 r=report(setup["unit"],source="application_pending",legacy={"record":{"PROCEDIMENTO":"proc_desempenho_equipe"}},dependencies=["Integração pendente"])
 d=describe(r,index_for(r.unit_id))
 assert "não confirmada" in d["routines"][0]
 assert d["pending"]==["Integração pendente"]
 assert "Não identificado" in d["snapshots"]


def test_lives_does_not_describe_obsolete_components_as_current(setup):
 r=report(setup["unit"],handler="lives_indicators_v1",components=[{"code":"legacy123-271"}])
 d=describe(r,index_for(r.unit_id))
 assert [p["code"] for p in d["components"]]==["vidas-sansaude-production-oracle"]
 assert "não equivalem" in d["snapshots"]


def test_snapshot_schedule_is_described_without_collecting(setup):
 u=setup["unit"];src=report(u,"source",catalog_kind="component",source="sql");out=report(u,"output",handler="bed_snapshots_v1")
 ReportSnapshotConfiguration.objects.create(unit=u,code="beds",name="Leitos",source_report=src,output_report=out,dataset_kind="beds",environment="production",collection_time="04:20:23",weekdays=[0,1,2,3,4],enabled=False)
 # Refresh database-native time conversion.
 d=describe(out,index_for(u.pk))
 assert any("04:20:23" in s and "desativada" in s and "seg" in s for s in d["routines"])
 assert "beds" in d["snapshots"]


def test_description_is_not_exposed_to_non_admin(setup):
 from rest_framework.request import Request
 u=setup["unit"];r=report(u,source="sql",query_sql="select * from private.table")
 user=get_user_model().objects.create_user("viewer")
 Membership.objects.create(unit=u,user=user,role="viewer")
 raw=APIRequestFactory().get("/");force_authenticate(raw,user=user);request=Request(raw)
 data=CatalogSerializer(r,context={"request":request}).data
 assert "technical_description" not in data


def test_edit_description_preserves_legacy_and_survives_metadata_changes(setup):
 r=report(setup["unit"],source="local",handler="confirmed",legacy={"evidence":"keep"})
 before=CatalogSerializer(r).data
 assert "Origem:" in before["description"]
 serializer=CatalogSerializer(r,data={"description":"Minha descrição\nSnapshots diários."},partial=True)
 assert serializer.is_valid(),serializer.errors
 serializer.save();r.refresh_from_db()
 assert r.legacy["evidence"]=="keep"
 assert CatalogSerializer(r).data["description"]=="Minha descrição\nSnapshots diários."
 r.name="Renomeado";r.save()
 assert CatalogSerializer(r).data["description"].startswith("Minha descrição")


def test_empty_description_is_preserved_and_not_regenerated(setup):
 r=report(setup["unit"],legacy={"report_description":""})
 assert CatalogSerializer(r).data["description"]==""


def test_description_limits_and_readonly_legacy(setup):
 r=report(setup["unit"],legacy={"evidence":"keep"})
 s=CatalogSerializer(r,data={"description":"x"*16001},partial=True)
 assert not s.is_valid()
 s=CatalogSerializer(r,data={"description":"Texto","legacy":{"evidence":"overwrite"}},partial=True)
 assert s.is_valid();s.save();r.refresh_from_db()
 assert r.legacy["evidence"]=="keep"


def test_description_configuration_is_versioned(setup):
 r=report(setup["unit"],source="local",handler="confirmed")
 client=setup["client"]
 url=f"/api/v1/reports/{r.pk}/configure/?unit=ame"
 response=client.post(url,{"version":r.version,"description":"Descrição manual"},format="json",HTTP_IDEMPOTENCY_KEY="description-first")
 assert response.status_code==200,response.data
 r.refresh_from_db();assert r.legacy["report_description"]=="Descrição manual"
 response=client.post(url,{"version":r.version-1,"description":"stale"},format="json",HTTP_IDEMPOTENCY_KEY="description-second")
 assert response.status_code==409
 r.refresh_from_db();assert r.legacy["report_description"]=="Descrição manual"
