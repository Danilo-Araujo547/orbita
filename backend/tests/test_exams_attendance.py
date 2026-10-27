from datetime import date,datetime,timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
import base64,io
import pytest
from pypdf import PdfReader
from rest_framework.exceptions import ValidationError,PermissionDenied
from operations.exams_attendance import tables,windows,prepare_values,definition_snapshot,CODES
from operations.models import ReportDefinition,ReportConnection
from operations.report_canvas.ports import make_layout
from operations.report_canvas.engine import export

@pytest.fixture
def report(setup):
 u=setup["unit"];u.slug="scv";u.save()
 c=ReportConnection.objects.create(unit=u,name="Hospital",engine="oracle",database="prdvotu",enabled=True,validated=True)
 schema={"WPA_DATA_INICIAL":{"type":"date"},"WPA_DATA_FINAL":{"type":"date"}}
 for code in CODES.values():ReportDefinition.objects.create(unit=u,code=code,name=code,catalog_kind="component",source="sql",connection=c,query_sql="SELECT 1 FROM DUAL",parameter_schema=schema,enabled=True,reviewed=True)
 return ReportDefinition.objects.create(unit=u,code="legacy123-53",name="Exames por atendimento",source="composite",handler="exams_per_attendance_v1",parameter_schema={"data_referencia":{"type":"date","required":False}},components=[{"code":CODES["exams"],"goal":2.5},{"code":CODES["attendances"]}],reviewed=True,enabled=False)

def point(grain,day,name,amount):return [grain,date.fromisoformat(day),name,amount,date.fromisoformat(day)]

def test_ratio_uses_sum_not_average_and_has_legacy_zero_behavior():
 d={"exams":[point("M","2026-10-01","A",5),point("M","2026-10-01","B",1)],"attendances":[point("M","2026-10-01","A",2),point("M","2026-10-01","B",10)]}
 t=tables(d,date(2026,10,26),Decimal("2.5"))
 assert t["overview"][1][1]==["2026",6,12,0.50,2.5]
 assert t["providers"][1][0][0]=="A" and t["providers"][1][0][2]==2.5
 assert len(t["providers"][0])==24
 assert t["overview"][1][-1][3]==0
 assert t["providers"][1][0][-1] is None


def test_provider_selection_only_current_year_exams_and_ordering():
 d={"exams":[point("M","2025-10-01","Old",9),point("M","2026-10-01","NoVisits",3),point("M","2026-10-01",None,7)],"attendances":[point("M","2026-10-01","OnlyVisits",10)]}
 t=tables(d,date(2026,10,26),Decimal("2.5"))
 assert [r[0] for r in t["providers"][1]]==["NoVisits"]
 assert all(x is None for x in t["providers"][1][0][1:])

@pytest.mark.parametrize("ref",[date(2026,1,1),date(2024,3,1),date(2026,10,26)])
def test_windows_have_two_years_thirteen_months_and_eight_previous_days(ref):
 w=windows(ref);assert len(w)==23
 assert [p[0] for p in w].count("M")==13
 assert w[-1][1]==ref-timedelta(days=1) and w[-8][1]==ref-timedelta(days=8)


def test_freshness_is_minimum_of_the_two_source_latest_dates():
 d={"exams":[point("M","2026-10-01","A",1)],"attendances":[point("M","2026-09-01","A",1)]}
 assert tables(d,date(2026,10,26),Decimal("2.5"))["metadata"][1][0][2]=="2026-09-01"


def test_invalid_quantity_rejected():
 with pytest.raises(ValidationError):tables({"exams":[point("M","2026-10-01","A",-1)],"attendances":[]},date(2026,10,26),Decimal("2.5"))


def test_native_signature_tracks_goal_and_source_revision(report):
 a=definition_snapshot(report)
 report.components[0]["goal"]=3;report.save();assert a!=definition_snapshot(report)
 source=ReportDefinition.objects.get(unit=report.unit,code=CODES["exams"]);source.version+=1;source.save()
 assert definition_snapshot(report)["sources"]["exams"]["version"]==source.version


def test_cross_unit_source_is_not_resolved(report):
 from core.models import Unit
 source=ReportDefinition.objects.get(unit=report.unit,code=CODES["exams"])
 source.unit=Unit.objects.create(slug="outside",name="Outside");source.save()
 with pytest.raises(ValidationError):definition_snapshot(report)


def test_no_automatic_execution_or_future_reference(report):
 with pytest.raises(PermissionDenied):prepare_values(report,{},origin="automatic")
 with pytest.raises(ValidationError):prepare_values(report,{"data_referencia":"2099-01-01"})


def test_canvas_collects_once_for_all_datasets(report):
 d=tables({"exams":[point("M","2026-10-01","A",5)],"attendances":[point("M","2026-10-01","A",2)]},date(2026,10,26),Decimal("2.5"))
 with patch("operations.exams_attendance.collect",return_value=d) as collect:
  content,count=export(report,make_layout(report),{"data_referencia":"2026-10-26"},[],"pdf")
  assert collect.call_count==1
  assert len(PdfReader(io.BytesIO(base64.b64decode(content))).pages)==2


def test_invalid_goal_blocks_source_snapshot(report):
 report.components[0]["goal"]=None
 with pytest.raises(ValidationError):definition_snapshot(report)


def test_long_provider_name_requires_review_instead_of_silent_truncation():
 d={"exams":[point("M","2026-10-01","A"*51,5)],"attendances":[]}
 with pytest.raises(ValidationError):tables(d,date(2026,10,26),Decimal("2.5"))


def test_full_execution_rejects_unhomologated_automation(report,setup):
 from operations.reporting import make_execution
 with pytest.raises(PermissionDenied):make_execution(report,{},user=setup["user"],origin="automatic")
