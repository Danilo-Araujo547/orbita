import uuid
import pytest
from django.utils import timezone
from operations.models import ReportDefinition, ReportRecipient, ReportGrant
from core.models import Unit

@pytest.fixture
def access_env(setup):
    unit=setup["unit"]
    reports=[ReportDefinition.objects.create(unit=unit,code=f"r{i}",name=f"Relatório {i}",source="sql",manual_enabled=True) for i in range(3)]
    recipient=ReportRecipient.objects.create(unit=unit,name="Contato fictício",address="5511999991234",active=True,verified_at=timezone.now())
    return {**setup,"reports":reports,"recipient":recipient}

def read(e):
    r=e["client"].get(f"/api/v1/report-recipients/{e['recipient'].pk}/manual-reports/?unit=ame")
    assert r.status_code==200,r.data
    return r.data

def save(e,ids,token=None,version=None):
    body={"version":e["recipient"].version if version is None else version,"manual_reports":ids,"manual_reports_token":read(e)["token"] if token is None else token}
    return e["client"].post(f"/api/v1/report-recipients/{e['recipient'].pk}/configure/?unit=ame",body,format="json",HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))

def test_multiple_reports_are_saved_once_per_recipient(access_env):
    e=access_env
    response=save(e,[r.pk for r in e["reports"][:2]])
    assert response.status_code==200,response.data
    assert response.data["manual_report_count"]==2
    grants=list(ReportGrant.objects.filter(recipient=e["recipient"]))
    assert len(grants)==2 and all(g.active and g.manual and not g.automatic for g in grants)
    listing=e["client"].get("/api/v1/report-recipients/?unit=ame")
    assert listing.status_code==200 and listing.data["count"]==1
    assert listing.data["results"][0]["manual_report_count"]==2

def test_manual_selection_does_not_reactivate_disabled_automatic_permission(access_env):
    e=access_env;r=e["reports"][0]
    grant=ReportGrant.objects.create(unit=e["unit"],recipient=e["recipient"],report=r,active=False,manual=False,automatic=True,parameters={"start":"2026-01-01"})
    response=save(e,[r.pk]);assert response.status_code==200,response.data
    grant.refresh_from_db()
    assert grant.active and grant.manual and not grant.automatic
    assert grant.parameters=={"start":"2026-01-01"}

def test_removing_manual_preserves_active_automatic_and_history(access_env):
    e=access_env;r=e["reports"][0]
    grant=ReportGrant.objects.create(unit=e["unit"],recipient=e["recipient"],report=r,active=True,manual=True,automatic=True,parameters={"x":1})
    response=save(e,[]);assert response.status_code==200,response.data
    grant.refresh_from_db();assert grant.active and grant.automatic and not grant.manual and grant.parameters=={"x":1}

def test_concurrent_grant_change_returns_conflict_and_rolls_back_recipient_edit(access_env):
    e=access_env;token=read(e)["token"]
    ReportGrant.objects.create(unit=e["unit"],recipient=e["recipient"],report=e["reports"][0],active=True)
    response=save(e,[],token=token)
    assert response.status_code==409,response.data
    e["recipient"].refresh_from_db();assert e["recipient"].version==1
    assert ReportGrant.objects.get(recipient=e["recipient"]).manual

def test_cross_unit_and_component_reports_are_rejected_atomically(access_env):
    e=access_env
    other=Unit.objects.create(slug="other",name="Outra")
    foreign=ReportDefinition.objects.create(unit=other,code="foreign",name="Privado")
    component=ReportDefinition.objects.create(unit=e["unit"],code="part",name="Componente",catalog_kind="component")
    for bad in [foreign,component]:
        response=save(e,[e["reports"][0].pk,bad.pk]);assert response.status_code==400,response.data
        assert not ReportGrant.objects.filter(recipient=e["recipient"]).exists()
        e["recipient"].refresh_from_db();assert e["recipient"].version==1

def test_legacy_restriction_is_not_bypassed(access_env):
    e=access_env;report=e["reports"][0]
    grant=ReportGrant.objects.create(unit=e["unit"],recipient=e["recipient"],report=report,active=False,legacy={"record":{"PARAMETRO1":"restriction"}})
    response=save(e,[report.pk]);assert response.status_code==400,response.data
    grant.refresh_from_db();assert not grant.active

def test_new_recipient_can_be_created_with_many_reports(access_env):
    e=access_env
    response=e["client"].post("/api/v1/report-recipients/?unit=ame",{"name":"Outro contato fictício","address":"11999991235","kind":"phone","active":False,"manual_reports":[r.pk for r in e["reports"]]},format="json",HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert response.status_code==200,response.data
    assert response.data["manual_report_count"]==3
    assert not ReportRecipient.objects.get(pk=response.data["id"]).active

def test_selection_endpoint_is_unit_scoped(access_env):
    e=access_env;other=Unit.objects.create(slug="other",name="Outra")
    r=ReportRecipient.objects.create(unit=other,name="Privado",address="5511999992345")
    response=e["client"].get(f"/api/v1/report-recipients/{r.pk}/manual-reports/?unit=ame")
    assert response.status_code==404


def test_prior_inactive_permissions_load_as_cards_and_stay_inactive_on_save(access_env):
    e=access_env;report=e["reports"][0]
    grant=ReportGrant.objects.create(unit=e["unit"],recipient=e["recipient"],report=report,manual=True,automatic=True,active=False,legacy={"record":{"PARAMETRO1":"restricted"}})
    data=read(e)
    assert data["selected"]==[] and data["inactive"]==[report.pk]
    assert len(data["reports"])==1 and data["reports"][0]["name"]==report.name
    assert data["reports"][0]["permission_active"] is False
    response=e["client"].post(f"/api/v1/report-recipients/{e['recipient'].pk}/configure/?unit=ame",{"version":1,"manual_reports":[],"manual_inactive_reports":[report.pk],"manual_reports_token":data["token"]},format="json",HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert response.status_code==200,response.data
    grant.refresh_from_db();assert not grant.active and grant.manual and grant.automatic and grant.version==1

def test_search_is_lazy_paginated_and_excludes_components_and_other_units(access_env):
    e=access_env;other=Unit.objects.create(slug="other",name="Outra")
    ReportDefinition.objects.bulk_create([ReportDefinition(unit=e["unit"],code=f"find-{i}",name=f"Buscável {i:03d}") for i in range(65)])
    ReportDefinition.objects.create(unit=e["unit"],code="find-part",name="Buscável componente",catalog_kind="component")
    ReportDefinition.objects.create(unit=other,code="find-foreign",name="Buscável outra unidade")
    url="/api/v1/report-recipients/manual-report-options/?unit=ame"
    response=e["client"].get(url);assert response.status_code==200 and response.data["count"]==0
    response=e["client"].get(url+"&search=B");assert response.data["count"]==0
    response=e["client"].get(url+"&search=Buscável")
    assert response.status_code==200 and response.data["count"]==65 and response.data["next"]
    assert len(response.data["results"])==50
    assert all(r["code"].startswith("find-") and r["code"] not in {"find-part","find-foreign"} for r in response.data["results"])

def test_removing_old_inactive_permission_preserves_automatic_state_and_history(access_env):
    e=access_env;report=e["reports"][0]
    grant=ReportGrant.objects.create(unit=e["unit"],recipient=e["recipient"],report=report,manual=True,automatic=True,active=False)
    data=read(e)
    response=e["client"].post(f"/api/v1/report-recipients/{e['recipient'].pk}/configure/?unit=ame",{"version":1,"manual_reports":[],"manual_inactive_reports":[],"manual_reports_token":data["token"]},format="json",HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert response.status_code==200,response.data
    grant.refresh_from_db();assert not grant.manual and not grant.active and grant.automatic
