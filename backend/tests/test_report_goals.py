import uuid
from datetime import date

import pytest
from rest_framework.exceptions import ValidationError
from core.models import Unit
from operations.models import ReportConnection, ReportDefinition
from operations.report_goals import normalize_goals
from operations.reporting import make_execution


def test_goals_sort_and_keep_zero():
    assert normalize_goals([{"year": 2026, "month": 2, "value": 0}, {"year": 2025, "month": 12, "value": 19000}])[0]["year"] == 2025


@pytest.mark.parametrize("goals", [
    [{"year":2026,"month":1,"value":1}]*2,
    [{"year":2026,"month":13,"value":1}],
    [{"year":2026,"month":1,"value":-1}],
    [{"year":2026,"month":1,"value":True}],
    [{"year":2026,"month":1,"value":1.2}],
    [{"year":2026,"month":1,"value":None}],
    {"2026-01":100},
])
def test_invalid_goals_rejected(goals):
    with pytest.raises(ValidationError): normalize_goals(goals)


@pytest.fixture
def env(setup, tmp_path, settings):
    settings.REPORT_SQLITE_ROOT = str(tmp_path)
    connection = ReportConnection.objects.create(unit=setup["unit"], name="Goal test", engine="sqlite", database=str(tmp_path / "source.sqlite3"), enabled=True, validated=True)
    report = ReportDefinition.objects.create(unit=setup["unit"], code="goal-test", name="Goal test", source="sql", query_sql="SELECT 1", connection=connection, reviewed=True, enabled=True, monthly_goals=[{"year":2026,"month":10,"value":19420}])
    return setup, report


def configure(client, report, data, unit="ame"):
    return client.post(f"/api/v1/reports/{report.pk}/configure/?unit={unit}", {"version":report.version, **data}, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))


def test_admin_edit_version_validation_and_unit_isolation(env):
    e, r = env
    response = configure(e["client"], r, {"monthly_goals":[{"year":2026,"month":10,"value":20000}]})
    assert response.status_code == 200, response.data
    old_version=r.version
    r.refresh_from_db()
    assert r.monthly_goals[0]["value"] == 20000 and r.version > old_version
    response=configure(e["client"], r, {"monthly_goals":r.monthly_goals*2})
    assert response.status_code == 400
    r.refresh_from_db(); assert len(r.monthly_goals)==1
    r.version=old_version
    assert configure(e["client"],r,{"monthly_goals":[]}).status_code==409
    Unit.objects.create(slug="other",name="Other")
    assert configure(e["client"],r,{"monthly_goals":[]},unit="other").status_code in (403,404)


def test_execution_preserves_goals_after_report_edit(env):
    e,r=env
    job=make_execution(r,user=e["user"],values={},run_date=date(2026,10,24))
    r.monthly_goals=[{"year":2026,"month":10,"value":21000}];r.save()
    job.refresh_from_db()
    assert job.snapshot["monthly_goals"]==[{"year":2026,"month":10,"value":19420}]
