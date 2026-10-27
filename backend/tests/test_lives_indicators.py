from datetime import date,timedelta
from unittest.mock import patch
from decimal import Decimal
import io,base64
import pytest
from pypdf import PdfReader
from rest_framework.exceptions import ValidationError,PermissionDenied
from operations.lives_indicators import periods,sum_contracts,build_tables,prepare_values
from operations.models import ReportDefinition
from operations.report_canvas.ports import make_layout
from operations.report_canvas.engine import export

def inputs(ref):
 cutoff,months,days=periods(ref)
 monthly={d:{"E":10,"I":3,"A":2} for d in months}
 monthly[date(cutoff.year-1,12,1)]={"E":8,"I":2,"A":1}
 daily={d:{"E":10,"I":3,"A":2} for d in days}
 goals=[{"year":d.year,"month":d.month,"value":20} for d in months]
 return monthly,daily,goals

def test_group_n_is_not_discarded():
 assert sum_contracts([("E","S",10),("I","S",3),("A","S",2),("A","N",1)])=={"E":10,"I":3,"A":3}

@pytest.mark.parametrize("rows",[[("E","S",1)],[("E","S",1),("E","S",2)],[("E","S",-1),("I","S",2),("A","S",1)]])
def test_missing_duplicate_or_negative_contracts_fail(rows):
 with pytest.raises(ValidationError):sum_contracts(rows)

@pytest.mark.parametrize("ref",[date(2026,10,23),date(2026,11,1),date(2027,1,1)])
def test_periods_follow_yesterday_month_not_today(ref):
 cutoff,months,days=periods(ref)
 assert months[-1]==date(cutoff.year,cutoff.month,1)
 assert len(months)==13 and len(days)==10 and days[-1]==cutoff


def test_annuals_are_positions_never_sum_of_months():
 ref=date(2026,10,23);m,d,g=inputs(ref)
 tables=build_tables(ref,m,d,g,[])
 assert tables["lives"][1][0][-1]==11
 assert tables["lives"][1][1][-1]==15
 assert len(tables["lives"][1])==25 and len(tables["goals"][1])==13
 assert tables["goals"][1][0][-1]==20


def test_missing_history_or_goal_does_not_become_zero():
 ref=date(2026,10,23);m,d,g=inputs(ref)
 with pytest.raises(ValidationError):build_tables(ref,m,d,g[:-1],[])
 d.pop(next(iter(d)))
 with pytest.raises(ValidationError):build_tables(ref,m,d,g,[])


def test_reconstructed_origin_is_explicit():
 ref=date(2026,10,23);m,d,g=inputs(ref);last=ref-timedelta(days=1)
 t=build_tables(ref,m,d,g,[last])
 assert t["metadata"][1][0][2]==1
 assert "Reconstruído" in t["origins"][1][-1][1]


def test_automatic_is_not_homologated():
 with pytest.raises(PermissionDenied):prepare_values(None,{},origin="automatic")


def test_canvas_renders_two_pages_and_collects_once(setup):
 ref=date(2026,10,23);m,d,g=inputs(ref);tables=build_tables(ref,m,d,g,[])
 r=ReportDefinition.objects.create(unit=setup["unit"],code="legacy123-310",name="Vidas",source="composite",handler="lives_indicators_v1",reviewed=True,monthly_goals=g)
 with patch("operations.lives_indicators.collect",return_value=tables) as collect:
  content,count=export(r,make_layout(r),{"data_referencia":ref.isoformat()},g,"pdf")
  assert collect.call_count==1
  assert len(PdfReader(io.BytesIO(base64.b64decode(content))).pages)==2


@pytest.mark.parametrize("case",["hml","other_unit","unvalidated","disabled"])
def test_source_rejects_homologation_and_wrong_unit(setup,case):
 from core.models import Unit
 from operations.models import ReportConnection
 from operations.lives_indicators import source,SOURCE
 unit=Unit.objects.create(slug="scv",name="SCV")
 connection=ReportConnection.objects.create(unit=unit,name="Production",engine="oracle",database="prdvotu",enabled=True,validated=True)
 report=ReportDefinition.objects.create(unit=unit,code="legacy123-310",name="Vidas",source="composite")
 ReportDefinition.objects.create(unit=unit,code=SOURCE,name="Fonte",source="sql",catalog_kind="component",enabled=True,reviewed=True,connection=connection)
 if case=="hml":connection.database="hmlvotu"
 elif case=="other_unit":connection.unit=setup["unit"]
 elif case=="unvalidated":connection.validated=False
 else:connection.enabled=False
 connection.save()
 with pytest.raises(ValidationError):source(report)


def test_valid_production_source_is_resolved(setup):
 from core.models import Unit
 from operations.models import ReportConnection
 from operations.lives_indicators import source,SOURCE
 unit=Unit.objects.create(slug="scv",name="SCV")
 c=ReportConnection.objects.create(unit=unit,name="Production",engine="oracle",database="prdvotu",enabled=True,validated=True)
 report=ReportDefinition.objects.create(unit=unit,code="legacy123-310",name="Vidas",source="composite")
 component=ReportDefinition.objects.create(unit=unit,code=SOURCE,name="Fonte",source="sql",catalog_kind="component",enabled=True,reviewed=True,connection=c)
 assert source(report).pk==component.pk
