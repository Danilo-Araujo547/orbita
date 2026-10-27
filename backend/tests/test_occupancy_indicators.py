import base64
import io
import uuid
from contextlib import contextmanager
from datetime import date, timedelta, time
from decimal import Decimal
from unittest.mock import patch

import pytest
from PIL import Image
from pypdf import PdfReader
from rest_framework.exceptions import PermissionDenied, ValidationError
from operations.models import (ReportDefinition,ReportConnection,ReportSnapshotConfiguration,
    ReportSnapshotRun,ReportSnapshotDataRow,ReportCanvasAsset,ReportRecipient,ReportGrant)
from operations.occupancy_indicators import (HANDLER,SOURCES,DATASETS,OVERVIEW,periods,build_tables,
    parse_capacity,prepare_values,definition_snapshot,sources,collect)
from operations.reporting import make_execution,execute_report,execution_access
from operations.report_canvas.ports import make_layout
from operations.report_canvas.engine import export

REF=date(2026,10,24)
SCHEMA={"inicio":{"type":"date","required":True},"fim_exclusivo":{"type":"date","required":True}}


def raw_data(ref=REF):
    patients=[];attendances=[];surgeries=[]
    origins=["RECEPCAO PS - CONVENIO","RECEPCAO PS - SUS","RECEPCAO PA - G.O.","RECEPCAO PA - PEDIATRIA","RECEPCAO PS - ISOLAMENTO"]
    for p in periods(ref):
        if p["days"]<=0:continue
        days=p["days"];kind,start=p["kind"],p["start"]
        for insurance,amount in [("SUS",5),("CONVENIO",2)]:patients.append([kind,start,2,"ALA B",insurance,amount*days,ref-timedelta(days=1)])
        for i,origin in enumerate(origins,1):attendances.append([kind,start,origin,i*days,ref-timedelta(days=1)])
        for typ,amount in [("E",2),("U",1),("M",1),("X",3)]:surgeries.append([kind,start,"SUS",typ,amount*days,ref-timedelta(days=1)])
    return {"patients":(["KIND","PERIOD","WARD_CODE","WARD_NAME","INSURANCE","TOTAL","LAST_SOURCE_DATE"],patients),
        "attendances":(["KIND","PERIOD","ORIGIN","TOTAL","LAST_SOURCE_DATE"],attendances),
        "surgeries":(["KIND","PERIOD","INSURANCE","SURGERY_TYPE","TOTAL","LAST_SOURCE_DATE"],surgeries)}


def capacities(start=date(2026,10,1),end=REF,missing=()):
    return [{"run_id":str(day),"run__reference_date":day,"record_key":"2",
        "payload":{"ward_code":2,"ward_name":"ALA B","sus":8,"convenio":2,"total":10,"date":day.isoformat()}}
        for i in range((end-start).days) if (day:=start+timedelta(days=i)) not in missing]


def test_three_groups_and_zero_capacity_are_distinct_from_missing():
    t=build_tables(REF,raw_data(),capacities(),consulted_at="2026-10-24T10:00:00-03:00")
    assert len(t["general"][1])==23
    assert t["general"][1][-1][1:4]==[7,10,70]
    assert t["sus"][1][-1][1:4]==[5,8,63]
    assert t["convenio"][1][-1][1:4]==[2,2,100]
    assert t["general"][1][0][3] is None  # No invented capacity for an absent year.
    assert len(t["sectors"][0])==24


def test_month_with_a_gap_has_no_occupancy_rate_but_keeps_patient_mean():
    t=build_tables(REF,raw_data(),capacities(missing={date(2026,10,10)}),consulted_at="now")
    october=next(r for r in t["general"][1] if r[0]=="out/26")
    assert october[1]==7 and october[2] is None and october[3] is None
    assert "10/10/2026" in t["metadata"][1][0][-1]
    # The remaining complete daily positions remain usable.
    assert t["general"][1][-1][3]==70


def test_surgery_total_preserves_other_types_and_does_not_assume_elective_plus_urgent():
    t=build_tables(REF,raw_data(),capacities(),consulted_at="now")
    assert t["elective"][1][-1][-1]==2
    assert t["urgent"][1][-1][-1]==2
    assert t["surgeries"][1][-1][-1]==7
    assert t["attendances"][1][-1][-1]==15


@pytest.mark.parametrize("change",["split","duplicate","date","code"])
def test_invalid_historical_capacity_blocks_generation(change):
    rows=capacities()
    if change=="split":rows[0]["payload"]["sus"]=100
    elif change=="duplicate":rows.append(rows[0])
    elif change=="date":rows[0]["payload"]["date"]="2025-01-01"
    else:rows[0]["record_key"]="99"
    with pytest.raises(ValidationError):parse_capacity(rows)


def test_unknown_and_duplicate_oracle_aggregates_are_rejected():
    raw=raw_data();raw["patients"][1].append(raw["patients"][1][0])
    with pytest.raises(ValidationError):build_tables(REF,raw,capacities(),consulted_at="now")
    raw=raw_data();raw["surgeries"][1][0][2]="UNKNOWN"
    with pytest.raises(ValidationError):build_tables(REF,raw,capacities(),consulted_at="now")


def test_no_records_keep_all_datasets_empty():
    raw={k:(v[0],[]) for k,v in raw_data().items()}
    t=build_tables(REF,raw,capacities(),consulted_at="now")
    assert all(not rows for _,rows in t.values())


def test_year_month_boundary_has_no_division_by_zero():
    ref=date(2026,1,1)
    t=build_tables(ref,raw_data(ref),capacities(start=date(2025,12,24),end=ref),consulted_at="now")
    assert t["general"][1][1][1:4]==[None,None,None]
    assert next(r for r in t["general"][1] if r[0]=="jan/26")[3] is None


def test_period_integral_equals_sum_of_daily_census_including_leap_boundaries():
    # Original midnight predicate: start <= day-1 AND release > day-1.
    for begin in [date(2024,2,27),date(2025,12,24),date(2026,10,1)]:
        end=begin+timedelta(days=31)
        for offset in range(-3,34):
            start=begin+timedelta(days=offset)
            for duration in [0,1,2,7,31,60]:
                release=start+timedelta(days=duration)
                original=sum(start<=begin+timedelta(days=i-1)<release for i in range(31))
                integral=max(0,(min(release,end-timedelta(days=1))-max(start+timedelta(days=1),begin)).days+1)
                assert integral==original


@pytest.fixture
def env(setup):
    unit=setup["unit"];unit.slug="scv";unit.save()
    c=ReportConnection.objects.create(unit=unit,name="Synthetic production",engine="oracle",host="172.16.0.254",database="prdvotu",enabled=True,validated=True)
    report=ReportDefinition.objects.create(unit=unit,code="legacy123-20",name="Informativos",source="composite",handler=HANDLER,connection=c,
        reviewed=True,enabled=True,canvas_enabled=True,parameter_schema={"data_referencia":{"type":"date","required":True}})
    children={}
    for part,code in SOURCES.items():
        children[part]=ReportDefinition.objects.create(unit=unit,code=code,name=part,catalog_kind="component",source="sql",connection=c,
            query_sql="SELECT :inicio, :fim_exclusivo FROM DUAL",parameter_schema=SCHEMA,reviewed=True,enabled=True,manual_enabled=False)
    cfg=ReportSnapshotConfiguration.objects.create(unit=unit,code="bed-capacity-daily",name="Capacity",dataset_kind="capacity",source_report=children["patients"],output_report=report,
        environment="homologation",collection_time=time(4,25),enabled=False)
    for item in capacities():
        run=ReportSnapshotRun.objects.create(unit=unit,configuration=cfg,dataset_key="synthetic-production",reference_date=item["run__reference_date"],
            period_type="day",origin="legacy",state="ready",configuration_version=cfg.version,row_count=1,source_snapshot={"kind":"legacy_import","environment":"production","source_host":"172.16.0.123","source_table":"LEITOS_DISPONIVEIS"})
        ReportSnapshotDataRow.objects.create(unit=unit,run=run,record_key="2",payload=item["payload"])
    out=io.BytesIO();Image.new("RGB",(10,10),"white").save(out,format="PNG")
    asset=ReportCanvasAsset.objects.create(report=report,unit=unit,filename="synthetic.png",data=out.getvalue(),width=10,height=10,sha256="0"*64)
    with patch("operations.report_canvas.ports.image_asset",return_value=str(asset.pk)):
        report.canvas_layout=make_layout(report);report.save()
    return {**setup,"report":report,"children":children,"connection":c,"config":cfg}


@pytest.mark.parametrize("case",["hml","host","unit","unvalidated","disabled"])
def test_source_environment_and_authorization_are_enforced(env,case):
    c=env["connection"]
    if case=="hml":c.database="hmlvotu"
    elif case=="host":c.host="172.16.3.254"
    elif case=="unit":
        from core.models import Unit
        c.unit=Unit.objects.create(slug="outside",name="Outside")
    elif case=="unvalidated":c.validated=False
    else:c.enabled=False
    c.save()
    with pytest.raises(ValidationError):sources(env["report"])


def test_only_approved_production_capacity_is_used(env):
    from operations.occupancy_indicators import history_records
    run=ReportSnapshotRun.objects.first();count=len(list(history_records(env["report"])))
    run.source_snapshot={**run.source_snapshot,"environment":"homologation"};run.save()
    assert len(list(history_records(env["report"])))==count-1


def test_all_three_queries_share_one_readonly_session(env):
    session=object();calls=[];raw=raw_data()
    @contextmanager
    def connection(c):yield session
    def query(child,values,*,session=None,typed=False):
        part=next(k for k,v in env["children"].items() if v.pk==child.pk)
        calls.append((session,values,typed));return raw[part]
    with patch("operations.occupancy_indicators.connect",connection),patch("operations.occupancy_indicators.run_query",query):
        t=collect(env["report"],{"data_referencia":str(REF)})
    assert len(calls)==3 and all(c[0] is session and c[2] for c in calls)
    assert all(c[1]=={"inicio":"2025-01-01","fim_exclusivo":"2026-10-24"} for c in calls)
    assert t["general"][1][-1][3]==70


def test_ten_page_canvas_collects_data_once_and_retains_missing_rate_notes(env):
    t=build_tables(REF,raw_data(),capacities(missing={date(2026,10,10)}),consulted_at="2026-10-24T10:00:00-03:00")
    with patch("operations.occupancy_indicators.collect",return_value=t) as query:
        content,count=export(env["report"],env["report"].canvas_layout,{"data_referencia":str(REF)},[],"pdf")
    pdf=PdfReader(io.BytesIO(base64.b64decode(content)))
    assert len(pdf.pages)==10 and count>0 and query.call_count==1
    assert "Capacidade" in pdf.pages[1].extract_text()
    assert "10/10/2026" in pdf.pages[1].extract_text()
    assert "Eletivas" in pdf.pages[6].extract_text()


def test_execution_download_and_change_revocation_use_existing_pipeline(env):
    report=env["report"]
    job=make_execution(report,{"data_referencia":str(REF)},user=env["user"])
    t=build_tables(REF,raw_data(),capacities(),consulted_at="now")
    with patch("operations.occupancy_indicators.collect",return_value=t),patch("operations.report_whatsapp.enqueue_delivery"):
        execute_report(job.pk)
    job.refresh_from_db();assert job.state=="ready" and job.delivery_state=="not_requested"
    response=env["client"].get(f"/api/v1/report-executions/{job.pk}/download/?unit=scv")
    assert response.status_code==200 and response.content==base64.b64decode(job.result)
    child=env["children"]["patients"];child.version+=1;child.save()
    with pytest.raises(PermissionDenied):execution_access(job)


def test_capacity_change_invalidates_pending_and_ready_manifests(env):
    job=make_execution(env["report"],{"data_referencia":str(REF)},user=env["user"])
    row=ReportSnapshotDataRow.objects.first();row.payload={**row.payload,"sus":9,"total":11};row.save()
    with pytest.raises(PermissionDenied):execution_access(job)


def test_automatic_and_future_dates_are_blocked(env):
    with pytest.raises(PermissionDenied):make_execution(env["report"],{"data_referencia":str(REF)},origin="automatic")
    with pytest.raises(ValidationError):prepare_values(env["report"],{"data_referencia":"2999-01-01"})
    with pytest.raises(ValidationError):prepare_values(env["report"],{"data_referencia":"2025-12-31"})


def test_whatsapp_requires_explicit_verified_recipient_grant(env):
    recipient=ReportRecipient.objects.create(unit=env["unit"],name="Synthetic",address="5511999990001",active=True)
    with pytest.raises(PermissionDenied):make_execution(env["report"],{"data_referencia":str(REF)},origin="whatsapp",recipient=recipient,transport="baileys")
    from django.utils import timezone
    recipient.verified_at=timezone.now();recipient.save()
    grant=ReportGrant.objects.create(unit=env["unit"],report=env["report"],recipient=recipient,manual=True,automatic=False,active=True)
    job=make_execution(env["report"],{"data_referencia":str(REF)},origin="whatsapp",recipient=recipient,transport="baileys")
    assert job.snapshot["transport"]=="baileys" and job.parameters=={"data_referencia":str(REF)}
    grant.active=False;grant.save()
    with pytest.raises(PermissionDenied):execution_access(job)


def test_snapshot_declared_row_count_detects_deleted_capacity_records():
    rows=capacities()
    rows[0]["run__row_count"]=2
    with pytest.raises(ValidationError):parse_capacity(rows)


def test_future_capacity_does_not_change_reference_day_labels():
    rows=capacities(end=REF+timedelta(days=2))
    t=build_tables(REF,raw_data(),rows,consulted_at="now")
    assert t["metadata"][1][0][2]=="2026-10-23"


def test_staging_command_preserves_other_sources_and_requires_separate_activation(env):
    from django.core.management import call_command
    from django.core.management.base import CommandError
    report=env["report"]
    for child in env["children"].values():
        child.code="previous-"+child.code;child.save()
    report.handler="";report.canvas_enabled=False;report.canvas_layout={};report.enabled=False;report.save()
    asset=ReportCanvasAsset.objects.get(report=report)
    old_connection=env["connection"]
    with patch("operations.report_canvas.ports.image_asset",return_value=str(asset.pk)),patch("operations.report_whatsapp.service") as sender:
        call_command("configure_occupancy_indicators",expected_version=1,connection_id=old_connection.pk,actor=env["user"].username,stdout=io.StringIO())
    sender.assert_not_called()
    report.refresh_from_db();old_connection.refresh_from_db()
    assert not report.enabled and report.reviewed and report.canvas_enabled and report.version==2
    assert len(report.canvas_layout["pages"])==10 and report.connection.timeout_seconds==60
    assert old_connection.timeout_seconds==30 and all(ReportDefinition.objects.filter(pk=c.pk,code__startswith="previous-").exists() for c in env["children"].values())
    assert not ReportGrant.objects.filter(report=report).exists()
    with pytest.raises(CommandError):
        call_command("configure_occupancy_indicators",expected_version=1,connection_id=old_connection.pk,actor=env["user"].username,stdout=io.StringIO())
    response=env["client"].post(f"/api/v1/reports/{report.pk}/configure/?unit=scv",{"version":2,"enabled":True},format="json",HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert response.status_code==200
    report.refresh_from_db();assert report.enabled and report.version==3
