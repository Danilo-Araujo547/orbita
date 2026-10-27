import io,json
from pathlib import Path
from datetime import date
from unittest.mock import patch
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from operations.models import ReportConnection,ReportDefinition,ReportAutomation,ReportGrant
from operations.report_engine import parameters,bound_sql,sql_contract
from operations.report_parameters import parameter_audit

ROOT=Path(__file__).resolve().parents[1]/"operations/report_sql/sigs"
CATALOG=json.loads((ROOT/"catalog.json").read_text())

@pytest.fixture
def sigs(setup):
    unit=setup["unit"];unit.slug="scv";unit.save()
    actor=setup["user"];actor.is_superuser=True;actor.save()
    conn=ReportConnection.objects.create(unit=unit,name="SIGS pendente",engine="oracle",enabled=False,validated=False)
    for code,spec in CATALOG.items():
        ReportDefinition.objects.create(unit=unit,code=code,name=spec["title"],source="sql",connection=conn,query_sql=spec["original_sql"],
            parameter_schema={},enabled=False,reviewed=False,legacy={"record":{"ID_BASE":"17"},"parameters":spec["legacy_parameters"]})
    return {**setup,"conn":conn}


def invoke(env):
    out=io.StringIO();call_command("map_sigs_reports",unit="scv",actor=env["user"].username,stdout=out);return json.loads(out.getvalue())


def test_mapping_reuses_five_records_and_never_activates_transport(sigs):
    before=ReportDefinition.objects.count()
    with patch("operations.report_engine.connect",side_effect=AssertionError("No unknown source execution")),patch("operations.report_whatsapp.service") as sender:
        first=invoke(sigs);second=invoke(sigs)
    assert ReportDefinition.objects.count()==before and len(first["reports"])==5
    assert all(r["changed"] for r in first["reports"]) and not any(r["changed"] for r in second["reports"])
    assert all(r.version==2 and not r.enabled and not r.reviewed for r in ReportDefinition.objects.filter(code__in=CATALOG))
    assert not ReportAutomation.objects.exists() and not ReportGrant.objects.exists()
    sender.assert_not_called()


@pytest.mark.parametrize("code",list(CATALOG))
def test_registered_query_binds_match_real_parameter_semantics(sigs,code):
    invoke(sigs);r=ReportDefinition.objects.get(code=code)
    if code=="legacy123-289":values={"WPA_DATA_INICIAL":2026,"WPA_DATA_FINAL":10}
    elif code=="legacy123-291":values={}
    else:values={"WPA_DATA_INICIAL":"2026-10-01","WPA_DATA_FINAL":"2026-10-25"}
    parsed=parameters(r,values);bindings=sql_contract(r.query_sql,r.parameter_schema,"oracle")
    sql,params=bound_sql(r.query_sql,parsed,"oracle")
    assert set(params)==bindings==set(r.parameter_schema)
    if code=="legacy123-289":assert params=={"WPA_DATA_INICIAL":2026,"WPA_DATA_FINAL":10}
    elif code!="legacy123-291":assert all(isinstance(v,date) for v in params.values()) and '< :WPA_DATA_FINAL + 1' in sql
    assert all(item["status"]=="confirmed" for item in parameter_audit(r)["items"])


def test_customized_query_aborts_mapping_without_partial_updates(sigs):
    r=ReportDefinition.objects.get(code="legacy123-291");r.query_sql="SELECT 1 CUSTOM FROM DUAL";r.save()
    with pytest.raises(CommandError):invoke(sigs)
    assert all(r.version==1 for r in ReportDefinition.objects.filter(code__in=CATALOG))
    assert ReportDefinition.objects.get(pk=r.pk).query_sql=="SELECT 1 CUSTOM FROM DUAL"


def test_existing_permissions_and_history_are_preserved(sigs):
    from operations.models import ReportRecipient,ReportExecution
    from django.utils import timezone
    report=ReportDefinition.objects.get(code="legacy123-265")
    recipient=ReportRecipient.objects.create(unit=sigs["unit"],name="Synthetic",address="5511999990001",active=True,verified_at=timezone.now())
    grant=ReportGrant.objects.create(unit=sigs["unit"],report=report,recipient=recipient,active=True,manual=True,automatic=False,parameters={})
    invoke(sigs);grant.refresh_from_db()
    assert grant.active and grant.manual and not grant.automatic
    assert grant.report_id==report.pk and grant.parameters=={} and not ReportExecution.objects.exists()
    report.refresh_from_db();assert report.legacy["sigs_mapping"]["previous_definition"]["query_sql"]==CATALOG[report.code]["original_sql"]


@pytest.mark.parametrize("year,month",[(2026,0),(2026,13),(True,1),(1899,1)])
def test_medication_parameters_reject_invalid_year_and_month(sigs,year,month):
    from rest_framework.exceptions import ValidationError
    invoke(sigs);r=ReportDefinition.objects.get(code="legacy123-289")
    with pytest.raises(ValidationError):parameters(r,{"WPA_DATA_INICIAL":year,"WPA_DATA_FINAL":month})


def test_period_rejects_inverted_dates(sigs):
    from rest_framework.exceptions import ValidationError
    invoke(sigs);r=ReportDefinition.objects.get(code="legacy123-265")
    with pytest.raises(ValidationError):parameters(r,{"WPA_DATA_INICIAL":"2026-10-25","WPA_DATA_FINAL":"2026-10-01"})
