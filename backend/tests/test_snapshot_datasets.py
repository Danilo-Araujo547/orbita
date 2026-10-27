from datetime import datetime, time, timedelta
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo
import pytest
from django.db import close_old_connections, connections
from rest_framework.exceptions import ValidationError
from operations.models import (ReportDefinition, ReportConnection, ReportSnapshotConfiguration,
    ReportSnapshotRun, ReportSnapshotDataRow, BedSnapshotRow)
from operations.bed_snapshots import queue_collection, collect_snapshot, definition
from operations.snapshot_datasets import parse_rows, COLUMNS
from operations.legacy_snapshot_datasets import import_history

NOW=datetime(2026,10,25,4,31,tzinfo=ZoneInfo("America/Sao_Paulo"))
HEADERS=COLUMNS["lives"]
VALUES=[["E","S","2026-10-24",100],["I","S","2026-10-24",20],["A","S","2026-10-24",10]]

@pytest.fixture
def lives(setup):
    c=ReportConnection.objects.create(unit=setup["unit"],name="HML test",engine="oracle",enabled=True,validated=True)
    s=ReportDefinition.objects.create(unit=setup["unit"],code="lives-source",name="Vidas fonte",catalog_kind="component",source="sql",connection=c,enabled=True,reviewed=True,
        parameter_schema={"data_alvo":{"type":"date","required":True}},query_sql="SELECT TP_CONTRATO,SN_ATIVO,:data_alvo DATA_FILTRO,TOTAL FROM DBAPS.USUARIO")
    r=ReportDefinition.objects.create(unit=setup["unit"],code="lives-report",name="Vidas",source="composite")
    cfg=ReportSnapshotConfiguration.objects.create(unit=setup["unit"],code="lives",name="Vidas",dataset_kind="lives",reference_offset_days=-1,
        source_report=s,output_report=r,environment="homologation",collection_time=time(4,30),enabled=True)
    with patch("operations.bed_snapshots.timezone.now",return_value=NOW):
        yield {**setup,"connection":c,"source":s,"report":r,"config":cfg}


def collect(env,values=VALUES):
    run=queue_collection(env["config"].pk,dispatch=False,user=env["user"])
    with patch("operations.bed_snapshots.run_query",return_value=(HEADERS,values)) as query:
        collect_snapshot(run.pk)
    run.refresh_from_db()
    return run,query


def test_lives_cutoff_is_yesterday_but_execution_is_today(lives):
    with patch("operations.report_whatsapp.service") as sender:
        run,query=collect(lives)
    assert run.state=="ready" and str(run.reference_date)=="2026-10-24"
    assert run.scheduled_for.date()==NOW.date() and run.row_count==3
    query.assert_called_once_with(lives["source"],{"data_alvo":"2026-10-24"})
    assert ReportSnapshotDataRow.objects.count()==3 and not BedSnapshotRow.objects.exists()
    sender.assert_not_called()
    assert queue_collection(lives["config"].pk,dispatch=False).pk==run.pk


@pytest.mark.parametrize("values",[VALUES+[VALUES[0]],VALUES[:2],[["X","S","2026-10-24",1]],
    [["E","S","2026-10-24",-1],*VALUES[1:]],[["E","S","2026-10-23",10],*VALUES[1:]],
    [["E","S","2026-10-24","NaN"],*VALUES[1:]]])
def test_invalid_aggregate_never_leaves_partial_history(lives,values):
    run,_=collect(lives,values)
    assert run.state=="failed" and run.error_code=="invalid_result" and not run.data_rows.exists()


def test_query_revision_change_blocks_pending_work_and_changes_dataset(lives):
    cfg=lives["config"];old=definition(cfg)["dataset_key"]
    run=queue_collection(cfg.pk,dispatch=False)
    lives["source"].query_sql+=" WHERE 1=1";lives["source"].version+=1;lives["source"].save()
    cfg.refresh_from_db();assert definition(cfg)["dataset_key"]!=old
    with patch("operations.bed_snapshots.run_query") as query:collect_snapshot(run.pk)
    run.refresh_from_db();assert run.error_code=="source_changed"
    query.assert_not_called()


def test_environment_and_cutoff_are_part_of_series(lives):
    cfg=lives["config"];old=definition(cfg)["dataset_key"]
    cfg.environment="production";assert definition(cfg)["dataset_key"]!=old
    cfg.environment="homologation";cfg.reference_offset_days=0
    assert definition(cfg)["dataset_key"]!=old


def test_pending_capacity_can_be_registered_but_never_collected(lives):
    cfg=lives["config"];cfg.dataset_kind="capacity";cfg.reference_offset_days=0;cfg.enabled=False
    source=lives["source"];source.parameter_schema={};source.query_sql="";source.enabled=False;source.reviewed=False;source.save()
    cfg.save();definition(cfg)
    with pytest.raises(ValidationError):queue_collection(cfg.pk,dispatch=False)
    assert not ReportSnapshotRun.objects.exists()


def test_capacity_requires_reconciled_total_and_unique_ward(lives):
    cfg=lives["config"];cfg.dataset_kind="capacity"
    values=[[2,"ALA B",10,5,15,"2026-10-24"]]
    rows=parse_rows(COLUMNS["capacity"],values,cfg,NOW.date()-timedelta(days=1))
    assert rows[0].payload["total"]==15
    with pytest.raises(ValidationError):parse_rows(COLUMNS["capacity"],[[2,"ALA B",10,5,14,"2026-10-24"]],cfg,NOW.date()-timedelta(days=1))
    with pytest.raises(ValidationError):parse_rows(COLUMNS["capacity"],values*2,cfg,NOW.date()-timedelta(days=1))


def batches(period="day"):
    return [{"reference":"2026-10-01" if period=="month" else "2026-10-24","period_type":period,"headers":HEADERS,
             "rows":[[x[0],x[1],"2026-10-01" if period=="month" else x[2],x[3]] for x in VALUES]}]


def test_legacy_import_preserves_unknown_clocks_and_real_monthly_competence(lives):
    cfg=lives["config"]
    first=import_history(cfg,batches("month"),source_table="SAN_VIDAS_MES",checksum="a"*64,actor=lives["user"])
    again=import_history(cfg,batches("month"),source_table="SAN_VIDAS_MES",checksum="b"*64,actor=lives["user"])
    assert first["rows"]==3 and again["unchanged_periods"]==1
    run=ReportSnapshotRun.objects.get()
    assert run.period_type=="month" and run.source_snapshot["environment"]=="production"
    assert run.captured_at is None and run.source_at is None and run.scheduled_for is None
    assert all(r.payload["period"]=="2026-10" and "date" not in r.payload for r in run.data_rows.all())
    live,_=collect(lives)
    assert live.dataset_key!=run.dataset_key and live.source_snapshot["environment"]=="homologation"


def test_history_conflict_rolls_back_whole_import(lives):
    import_history(lives["config"],batches(),source_table="SAN_VIDAS",checksum="a"*64,actor=lives["user"])
    altered=batches();altered[0]["rows"][0][3]=999
    with pytest.raises(ValidationError):import_history(lives["config"],altered,source_table="SAN_VIDAS",checksum="b"*64,actor=lives["user"])
    assert ReportSnapshotDataRow.objects.get(record_key="E:S").payload["total"]==100


def test_api_has_same_unit_access_and_non_bed_record_shape(lives):
    c=lives["client"];cfg=lives["config"]
    response=c.get(f"/api/v1/report-snapshots/{cfg.pk}/?unit=ame")
    assert response.status_code==200 and response.data["dataset_kind"]=="lives"
    run,_=collect(lives)
    result=c.get(f"/api/v1/report-snapshot-runs/{run.pk}/records/?unit=ame")
    assert result.status_code==200 and result.data["results"][0]["payload"]["contract"] in {"E","I","A"}
    from core.models import Unit,Membership
    other=Unit.objects.create(slug="other",name="Other");Membership.objects.create(unit=other,user=lives["user"],role="admin")
    assert c.get(f"/api/v1/report-snapshot-runs/{run.pk}/records/?unit=other").status_code==404
    conflict=c.post(f"/api/v1/report-snapshots/{cfg.pk}/configure/?unit=ame",{"version":999,"name":"Changed"},format="json",HTTP_IDEMPOTENCY_KEY="lives-conflict")
    assert conflict.status_code==409


@pytest.mark.django_db(transaction=True)
def test_concurrent_workers_capture_one_lives_snapshot(lives):
    cfg=lives["config"]
    def enqueue():
        close_old_connections()
        try:return queue_collection(cfg.pk,dispatch=False).pk
        finally:connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:ids=list(pool.map(lambda _:enqueue(),range(2)))
    assert ids[0]==ids[1]
    def execute():
        close_old_connections()
        try:collect_snapshot(ids[0])
        finally:connections.close_all()
    with patch("operations.bed_snapshots.run_query",return_value=(HEADERS,VALUES)) as query:
        with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(lambda _:execute(),range(2)))
    assert query.call_count==1 and ReportSnapshotDataRow.objects.count()==3


def test_sql_edit_is_validated_and_conflicting_revision_is_rejected(lives):
    source=lives["source"];client=lives["client"]
    url=f"/api/v1/reports/{source.pk}/configure/?unit=ame"
    bad=client.post(url,{"version":source.version,"query_sql":"DELETE FROM DBAPS.USUARIO"},format="json",HTTP_IDEMPOTENCY_KEY="invalid-snapshot-sql")
    assert bad.status_code==400
    source.refresh_from_db();assert source.version==1
    valid=client.post(url,{"version":source.version,"query_sql":source.query_sql+" WHERE 1=1"},format="json",HTTP_IDEMPOTENCY_KEY="valid-snapshot-sql")
    assert valid.status_code==200
    stale=client.post(url,{"version":1,"query_sql":source.query_sql},format="json",HTTP_IDEMPOTENCY_KEY="stale-snapshot-sql")
    assert stale.status_code==409


def test_collection_cannot_reference_another_units_consumer(lives):
    from core.models import Unit
    unit=Unit.objects.create(slug="outside",name="Outside")
    r=ReportDefinition.objects.create(unit=unit,code="outside",name="Outside")
    cfg=lives["config"]
    response=lives["client"].post(f"/api/v1/report-snapshots/{cfg.pk}/configure/?unit=ame",{"version":cfg.version,"consumers":[r.pk]},format="json",HTTP_IDEMPOTENCY_KEY="cross-unit-consumer")
    assert response.status_code==400 and not cfg.consumers.exists()


def test_homologation_connection_cannot_be_relabelled_production(lives):
    lives["connection"].database="hmlvotu";lives["connection"].save()
    cfg=lives["config"];cfg.environment="production";cfg.refresh_from_db();cfg.environment="production"
    with pytest.raises(ValidationError):definition(cfg)


def test_registration_is_idempotent_and_never_enables_delivery(lives):
    import io
    from django.core.management import call_command
    unit=lives["unit"];unit.slug="scv";unit.save()
    user=lives["user"];user.is_superuser=True;user.save()
    lives["connection"].database="hmlvotu";lives["connection"].save()
    for code in ["legacy123-310","legacy123-271","legacy123-20","legacy123-18","legacy123-19","legacy123-24","legacy123-25","legacy123-55"]:
        ReportDefinition.objects.create(unit=unit,code=code,name=code,enabled=False)
    with patch("operations.management.commands.register_snapshot_datasets.run_query",return_value=(HEADERS,VALUES)),patch("operations.report_whatsapp.service") as sender:
        for _ in range(2):call_command("register_snapshot_datasets",unit="scv",connection_id=lives["connection"].pk,actor=user.username,stdout=io.StringIO())
    cfg=ReportSnapshotConfiguration.objects.get(code="lives-daily")
    capacity=ReportSnapshotConfiguration.objects.get(code="bed-capacity-daily")
    assert not cfg.enabled and not capacity.enabled and cfg.consumers.count()==1 and capacity.consumers.count()==5
    assert not ReportDefinition.objects.get(code="legacy123-310").enabled
    sender.assert_not_called()


def test_history_filters_never_merge_environments_or_periods(lives):
    cfg=lives["config"]
    import_history(cfg,batches("month"),source_table="SAN_VIDAS_MES",checksum="a"*64,actor=lives["user"])
    live,_=collect(lives)
    base=f"/api/v1/report-snapshot-runs/?unit=ame&configuration={cfg.pk}"
    monthly=lives["client"].get(base+"&environment=production&period_type=month")
    assert monthly.status_code==200 and monthly.data["count"]==1
    assert monthly.data["results"][0]["environment"]=="production" and monthly.data["results"][0]["period_type"]=="month"
    hml=lives["client"].get(base+"&environment=homologation&period_type=day")
    assert hml.data["count"]==1 and hml.data["results"][0]["id"]==str(live.pk)
    assert lives["client"].get(base+"&environment=invalid").status_code==400


def test_monthly_origin_cannot_be_imported_as_exact_daily_snapshot(lives):
    with pytest.raises(ValidationError):
        import_history(lives["config"],batches(),source_table="SAN_VIDAS_MES",checksum="a"*64,actor=lives["user"])
    assert not ReportSnapshotRun.objects.exists()


@pytest.mark.parametrize("clock,target",[(datetime(2026,11,1,4,31,tzinfo=ZoneInfo("America/Sao_Paulo")),"2026-10-31"),(datetime(2024,3,1,4,31,tzinfo=ZoneInfo("America/Sao_Paulo")),"2024-02-29")])
def test_yesterday_cutoff_preserves_month_year_and_leap_boundaries(lives,clock,target):
    values=[[r[0],r[1],target,r[3]] for r in VALUES]
    with patch("operations.bed_snapshots.timezone.now",return_value=clock):
        run,_=collect(lives,values)
    assert run.state=="ready" and str(run.reference_date)==target
    assert run.scheduled_for.date()==clock.date()
    assert {r.payload["date"] for r in run.data_rows.all()}=={target}
