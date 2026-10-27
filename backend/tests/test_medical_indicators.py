import base64
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from unittest.mock import patch
import pytest
from rest_framework.exceptions import PermissionDenied, ValidationError
from operations.medical_indicators import HANDLER, PARTS, collect_data, definition_snapshot, prepare_values
from operations.models import ReportConnection, ReportDefinition
from operations.reporting import execution_access, make_execution, execute_report
from operations.report_engine import sql_contract

@pytest.fixture
def medical_env(setup,tmp_path,settings):
    settings.REPORT_FILES_ROOT=str(tmp_path)
    assets=tmp_path/"reports/indicadores-medicos/v1";assets.mkdir(parents=True)
    for name in ("first-background.jpg","last-background.jpg","logo.png","arial.ttf","arialbd.ttf","layout.json"):
        (assets/name).write_bytes(b"test-only")
    conn=ReportConnection.objects.create(unit=setup["unit"],name="HML",engine="oracle",enabled=True,validated=True)
    children=[]
    for part in PARTS:
        child=ReportDefinition.objects.create(unit=setup["unit"],code="medical-"+part.replace("_","-"),name=part,source="sql",connection=conn,query_sql="SELECT :inicio FROM DUAL WHERE :fim_exclusivo IS NOT NULL",parameter_schema={"inicio":{"type":"date"},"fim_exclusivo":{"type":"date"}},enabled=True,reviewed=True,manual_enabled=False)
        children.append(child)
    report=ReportDefinition.objects.create(unit=setup["unit"],code="medical-test",name="Medical",source="composite",handler=HANDLER,connection=conn,components=[{"code":c.code} for c in children],parameter_schema={"data_referencia":{"type":"date","required":False}},enabled=True,reviewed=True,output_format="pdf")
    return {**setup,"report":report,"children":children,"assets":assets}


def test_medical_sql_contracts():
    folder=Path(__file__).resolve().parents[1]/"operations/report_sql/indicadores_medicos"
    for part in PARTS:
        assert sql_contract((folder/(part+".sql")).read_text(),{"inicio":{"type":"date"},"fim_exclusivo":{"type":"date"}},"oracle")=={"inicio","fim_exclusivo"}


def test_homologation_denies_delivery_and_automatic_origin(medical_env):
    e=medical_env
    for origin,recipient in [("automatic",None),("whatsapp",None),("panel",object())]:
        with pytest.raises(PermissionDenied):
            prepare_values(e["report"],{},origin=origin,recipient=recipient)
    with pytest.raises(ValidationError):
        prepare_values(e["report"],{"data_referencia":"2999-01-01"},origin="panel",recipient=None)


def test_query_and_art_changes_invalidate_execution(medical_env):
    e=medical_env
    job=make_execution(e["report"],{},user=e["user"])
    assert job.parameters["data_referencia"] and job.delivery_state=="not_requested"
    child=e["children"][0];child.version+=1;child.save()
    with pytest.raises(PermissionDenied):execution_access(job)
    child.version-=1;child.save()
    (e["assets"]/"logo.png").write_bytes(b"new-version")
    with pytest.raises(PermissionDenied):execution_access(job)


def test_components_cannot_cross_units_or_connections(medical_env):
    e=medical_env
    other=ReportConnection.objects.create(unit=e["unit"],name="Another",engine="oracle")
    child=e["children"][0];child.connection=other;child.save()
    with pytest.raises(ValidationError):definition_snapshot(e["report"])


def test_all_sections_share_readonly_session_and_dates(medical_env):
    e=medical_env;session=object();calls=[]
    @contextmanager
    def fake_connect(conn):yield session
    def query(report,values,*,session=None):
        calls.append((report.code,values,session))
        code=report.code
        if code.endswith("stays"):
            return ["ANO","MES","TIPO_CONVENIO","DS_ESPECIALID","QUANTIDADE","DIAS","ULTIMA_DATA"],[["2026","10","SUS","CLINICA GERAL","2","8","2026-10-22"]]
        if code.endswith("attendances") or code.endswith("exams"):
            return ["DIA","TOTAL"],[["2026-10-21","2"],["2026-10-22","3"]]
        if code.endswith("months"):
            return ["ANO","MES","DS_ESPECIALID","QUANTIDADE","DIAS"],[["2026","10","CLINICA GERAL","1","0.5"]]
        return ["DATA","DS_ESPECIALID","QUANTIDADE","DIAS"],[["2026-10-22","CLINICA GERAL","1","0.5"]]
    with patch("operations.medical_indicators.connect",fake_connect),patch("operations.medical_indicators.run_query",query):
        data=collect_data(e["report"],{"data_referencia":"2026-10-23"})
    assert len(calls)==5 and all(c[2] is session for c in calls)
    assert all(c[1]=={"inicio":"2025-01-01","fim_exclusivo":"2026-10-23"} for c in calls)
    assert data["exams"]==[{"ANO":2026,"MES":10,"QUANTIDADE":5}]
    assert data["freshness"]["internacao"][0]["ULTIMA_ALTA"]=="2026-10-22"
    # Exercise the real renderer with string-valued SQL results, including opinions.
    import io
    from pypdf import PdfReader
    from operations.medical_layout import render_medical_pdf
    assets=Path("/report_files/reports/indicadores-medicos/v1")
    result=render_medical_pdf(data,assets)
    pdf=PdfReader(io.BytesIO(result))
    assert len(pdf.pages)==7 and len(result)<5*1024*1024
    assert "22/10/2026" in pdf.pages[1].extract_text()
    assert "12:00:00" in pdf.pages[5].extract_text()



def test_specialized_pdf_runs_in_existing_execution_pipeline_without_delivery(medical_env):
    e=medical_env
    job=make_execution(e["report"],{},user=e["user"])
    with patch("operations.medical_indicators.generate",return_value=(base64.b64encode(b"%PDF-test").decode(),5)),patch("operations.report_whatsapp.enqueue_delivery") as delivery:
        execute_report(job.pk)
    job.refresh_from_db()
    assert job.state=="ready" and job.row_count==5 and job.delivery_state=="not_requested"
    # Existing delivery dispatcher receives a job without recipient and must remain a no-op.
    assert job.recipient_id is None


def test_medical_manual_whatsapp_is_allowed_but_automatic_remains_blocked(medical_env):
    e=medical_env
    assert prepare_values(e["report"],{"data_referencia":"2026-10-23"},origin="whatsapp",recipient=object())=={"data_referencia":"2026-10-23"}
    with pytest.raises(PermissionDenied):
        prepare_values(e["report"],{},origin="automatic",recipient=object())
