import base64
import io
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pytest
from django.utils import timezone
from pypdf import PdfReader
from rest_framework.exceptions import PermissionDenied, ValidationError

from operations.models import ReportConnection, ReportDefinition, ReportGrant, ReportRecipient
from operations.report_engine import parameters, sql_contract, bound_sql
from operations.reporting import make_execution, execute_report, execution_access, readiness
from operations.stock_loans import (HANDLER, DATE_KEYS, prepare_values, render_stock_pdf, display_number)

SQL = (Path(__file__).resolve().parents[1] / "operations/report_sql/stock_loans/loans.sql").read_text()
SCHEMA = {k: {"type":"date","required":True} for k in DATE_KEYS}
VALUES = {"WPA_DATA_INICIAL":"2026-10-01", "WPA_DATA_FINAL":"2026-10-24"}
HEADERS = ["DS_FORNECEDOR","TP_EMPRESTIMO","DT_EMPRESTIMO","CPRODUTO","PRODUTO","UNIDADE","QT_ENTRADA","QT_ESTOQUE_ATUAL","DS_LOCALIZACAO"]
ROWS = [["Fornecedor Fictício A","E. Recebido","2026-10-10 18:30:00","123","Produto fictício <teste>","UN","2.5","10","Prateleira A"],
        ["Fornecedor Fictício A","E. Concedido","2026-10-24 23:59:59","123","Produto fictício <teste>","UN","3","10","Prateleira A"]]

@pytest.fixture
def stock(setup):
    unit=setup["unit"];unit.slug="scv";unit.save(update_fields=["slug"])
    conn=ReportConnection.objects.create(unit=unit,name="Oracle HML fictício",engine="oracle",host="invalid",database="synthetic",validated=True,enabled=True)
    r=ReportDefinition.objects.create(unit=unit,code="legacy123-1",name="Estoque",source="sql",handler=HANDLER,connection=conn,query_sql=SQL,parameter_schema=SCHEMA,enabled=True,reviewed=True,output_format="pdf",legacy={"migration":{"environment":"homologacao"}})
    return {**setup,"report":r,"connection":conn}

def text(content):
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(content)).pages)

def test_oracle_sql_contract_and_inclusive_last_day():
    assert sql_contract(SQL,SCHEMA,"oracle")==set(DATE_KEYS)
    assert "TRUNC(:WPA_DATA_FINAL) + 1" in SQL
    assert "NULLIF(REL.VL_FATOR, 0)" in SQL
    assert SQL.count("union all")==1
    assert "Estoque.Cd_Multi_Empresa = 1" in SQL
    sql,binds=bound_sql(SQL,{k:date.fromisoformat(v) for k,v in VALUES.items()},"oracle")
    assert binds["WPA_DATA_FINAL"]==date(2026,10,24)
    assert sql==SQL

@pytest.mark.parametrize("values",[{**VALUES,"WPA_DATA_FINAL":"2026-09-30"},{**VALUES,"WPA_DATA_INICIAL":"2025-01-01"},{**VALUES,"WPA_DATA_INICIAL":"bad"}])
def test_invalid_period_rejected(stock,values):
    with pytest.raises(ValidationError):make_execution(stock["report"],values,user=stock["user"])

def test_single_day_and_leap_year_period(stock):
    r=stock["report"]
    assert prepare_values(r,{k:"2026-10-24" for k in DATE_KEYS},origin="panel",recipient=None)
    assert prepare_values(r,dict(zip(DATE_KEYS,["2024-01-01","2024-12-31"])),origin="panel",recipient=None)

def test_automatic_blocked(stock):
    with pytest.raises(PermissionDenied):
        prepare_values(stock["report"],VALUES,origin="automatic",recipient=None)

def test_readiness_requires_correct_unit_connection_format(stock):
    r=stock["report"];assert not readiness(r)
    r.output_format="csv";assert readiness(r)
    r.output_format="pdf";r.connection.engine="sqlite";assert readiness(r)

def test_pdf_groups_and_preserves_repeated_balances():
    content=render_stock_pdf(HEADERS,ROWS,VALUES,environment="homologacao")
    t=text(content)
    assert "HOMOLOGAÇÃO" in t and "Fornecedor Fictício A" in t
    assert "Produto fictício <teste>" in t
    assert "5,5" in t and "20" in t
    assert "saldo consolidado" in t
    assert "24/10/2026" in t
    assert PdfReader(io.BytesIO(content)).pages[0].mediabox.width==pytest.approx(595.2756,abs=.1)

def test_missing_balance_not_fabricated_zero():
    rows=[[*ROWS[0][:7],"",ROWS[0][8]]]
    t=text(render_stock_pdf(HEADERS,rows,VALUES,environment="homologacao"))
    assert "Incompleto" in t and "não calculável" in t
    assert display_number(None)=="-" and display_number("0")=="0"

@pytest.mark.parametrize("value",["NaN","Infinity","invalid"])
def test_invalid_numbers_rejected(value):
    with pytest.raises(ValidationError):display_number(value)

def test_invalid_columns_fail_closed():
    with pytest.raises(ValidationError):render_stock_pdf(HEADERS[:-1],ROWS,VALUES,environment="homologacao")

def test_multipage_long_values():
    rows=[[*ROWS[0]] for _ in range(90)]
    for i,row in enumerate(rows):row[4]="Produto fictício longo "*5+str(i)
    pdf=PdfReader(io.BytesIO(render_stock_pdf(HEADERS,rows,VALUES,environment="homologacao")))
    assert len(pdf.pages)>2
    assert "Total geral" in pdf.pages[-1].extract_text()
    assert "Localização" in pdf.pages[1].extract_text()

def test_pipeline_version_and_authenticated_download(stock):
    r=stock["report"];job=make_execution(r,VALUES,user=stock["user"])
    with patch("operations.stock_loans.run_query",return_value=(HEADERS,ROWS)),patch("operations.report_whatsapp.enqueue_delivery"):
        execute_report(job.pk)
    job.refresh_from_db();assert job.state=="ready" and job.row_count==2
    assert job.delivery_state=="not_requested"
    url=f"/api/v1/report-executions/{job.pk}/download/?unit=scv"
    response=stock["client"].get(url);assert response.status_code==200
    assert response.content==base64.b64decode(job.result)
    assert stock["client"].get(url.replace("unit=scv","unit=ame")).status_code in (400,403,404)
    r.query_sql += "\n-- changed";r.save(update_fields=["query_sql"])
    job.report=r
    with pytest.raises(PermissionDenied):execution_access(job)

def test_empty_whatsapp_never_delivers_pdf(stock):
    r=stock["report"]
    recipient=ReportRecipient.objects.create(unit=r.unit,name="Fictício",address="5511999990001",active=True,verified_at=timezone.now())
    ReportGrant.objects.create(unit=r.unit,report=r,recipient=recipient,active=True,manual=True,automatic=False)
    job=make_execution(r,VALUES,recipient=recipient,origin="whatsapp",transport="baileys")
    with patch("operations.stock_loans.run_query",return_value=(HEADERS,[])),patch("operations.report_whatsapp.enqueue_delivery"):
        execute_report(job.pk)
    job.refresh_from_db()
    assert job.state=="ready" and job.row_count==0 and job.result=="" and job.snapshot["no_data"]


def test_recovery_preserves_history_and_leaves_report_disabled(stock):
    from django.core.management import call_command
    from django.core.management.base import CommandError
    r=stock["report"]
    r.handler="";r.query_sql="";r.enabled=False;r.reviewed=False;r.save()
    stock["user"].is_superuser=True;stock["user"].save(update_fields=["is_superuser"])
    args=dict(unit="scv",connection_id=stock["connection"].pk,expected_version=r.version,environment="homologacao",actor=stock["user"].username)
    call_command("recover_stock_loans",**args,stdout=io.StringIO())
    r.refresh_from_db()
    assert r.handler==HANDLER and r.query_sql==SQL and r.reviewed and not r.enabled
    assert r.version==2 and r.legacy["migration"]["previous_definition"]["query_sql"]==""
    with pytest.raises(CommandError):call_command("recover_stock_loans",**args,stdout=io.StringIO())


def test_recovery_never_overwrites_existing_implementation(stock):
    from django.core.management import call_command
    from django.core.management.base import CommandError
    r=stock["report"]
    with pytest.raises(CommandError):call_command("recover_stock_loans",unit="scv",connection_id=stock["connection"].pk,expected_version=r.version,environment="homologacao",actor=stock["user"].username,stdout=io.StringIO())
    r.refresh_from_db();assert r.version==1 and r.query_sql==SQL
