import base64,io,json,re
from pathlib import Path
from unittest.mock import patch
from django.core.management import call_command
from django.core.management.base import CommandError
import pytest
from operations.models import ReportDefinition,ReportConnection,ReportGrant,ReportAutomation
from operations.management.commands.migrate_sigs_variants import catalog,prepare_layout
from operations.report_engine import parameters,sql_contract

@pytest.fixture
def variant(setup):
    unit=setup["unit"];unit.slug="scv";unit.save()
    spec=catalog()["legacy123-266"]
    conn=ReportConnection.objects.create(unit=unit,name="SIGS test",engine="oracle",database="prdpmv",enabled=True,validated=True)
    report=ReportDefinition.objects.create(unit=unit,connection=conn,code="legacy123-266",name=spec["name"],source="sql",query_sql=spec["original_sql"],enabled=False,reviewed=False)
    return report

def invoke(tmp_path,**kwargs):
    call_command("migrate_sigs_variants",codes=["legacy123-266"],backup=str(tmp_path/(kwargs.pop("tag","before")+".json")),artifacts=str(tmp_path/"artifacts"),**kwargs)

def pdf():
    from reportlab.pdfgen.canvas import Canvas
    out=io.BytesIO();c=Canvas(out);c.drawString(10,10,"Teste");c.showPage();c.save()
    return base64.b64encode(out.getvalue()).decode()

@pytest.mark.parametrize("code",list(catalog()))
def test_variant_contract_keeps_exact_restriction_and_parameter_semantics(code):
    spec=catalog()[code]
    restriction=r"(?:vr\.unsa_cod|CODIGO_UNIDADE_REFERENCIA|estoque)\s*=\s*'([^']*)'"
    assert re.findall(restriction,spec["sql"],re.I)==re.findall(restriction,spec["original_sql"],re.I)
    assert len(re.findall(restriction,spec["sql"],re.I))==1
    assert sql_contract(spec["sql"],spec["schema"],"oracle")==set(spec["schema"])
    if spec["family"]=="consultas":
        assert "< :WPA_DATA_FINAL + 1" in spec["sql"] and "EQUIPE" not in spec["columns"]
    elif spec["family"]=="medicamentos":
        assert spec["schema"]["WPA_DATA_FINAL"]["maximum"]==12
    else:assert spec["schema"]=={}


def test_migrate_preserves_disabled_state_and_is_idempotent(variant,tmp_path):
    with patch("operations.management.commands.migrate_sigs_variants.compare_source",return_value=(["UNIDADE_SOLICITANTE","CBO","QUANTIDADE"],[["Unidade","CBO",1]])),patch("operations.management.commands.migrate_sigs_variants.export",return_value=(pdf(),1)),patch("operations.report_whatsapp.service") as sender:
        invoke(tmp_path,apply=True)
        variant.refresh_from_db();version=variant.version
        assert variant.reviewed and variant.canvas_enabled and not variant.enabled and variant.canvas_layout
        invoke(tmp_path,apply=True,tag="second")
        variant.refresh_from_db();assert variant.version==version
        sender.assert_not_called()
    assert ReportGrant.objects.count()==0 and ReportAutomation.objects.count()==0


def test_export_failure_rolls_back_every_field(variant,tmp_path):
    original=variant.query_sql
    with patch("operations.management.commands.migrate_sigs_variants.compare_source",return_value=(["UNIDADE_SOLICITANTE","CBO","QUANTIDADE"],[])),patch("operations.management.commands.migrate_sigs_variants.export",side_effect=ValueError("Cannot render")):
        with pytest.raises(CommandError):invoke(tmp_path,apply=True)
    variant.refresh_from_db()
    assert variant.query_sql==original and not variant.reviewed and not variant.canvas_enabled


def test_dryrun_exports_without_persisting_review_or_layout(variant,tmp_path):
    with patch("operations.management.commands.migrate_sigs_variants.compare_source",return_value=(["UNIDADE_SOLICITANTE","CBO","QUANTIDADE"],[])),patch("operations.management.commands.migrate_sigs_variants.export",return_value=(pdf(),0)):
        invoke(tmp_path)
    variant.refresh_from_db();assert not variant.reviewed and not variant.canvas_enabled and variant.canvas_layout=={}


def test_migrate_never_overwrites_custom_query(variant,tmp_path):
    variant.query_sql="SELECT 1 FROM DUAL";variant.save()
    with patch("operations.management.commands.migrate_sigs_variants.compare_source") as query:
        with pytest.raises(CommandError):invoke(tmp_path,apply=True)
        query.assert_not_called()
    variant.refresh_from_db();assert variant.query_sql=="SELECT 1 FROM DUAL"


def test_other_unit_is_not_a_source(variant,tmp_path,setup):
    from core.models import Unit
    unit=Unit.objects.create(slug="other",name="Outra")
    variant.connection.unit=unit;variant.connection.save()
    with patch("operations.management.commands.migrate_sigs_variants.compare_source") as query:
        with pytest.raises(CommandError):invoke(tmp_path,apply=True)
        query.assert_not_called()


def test_windows_line_endings_are_not_a_custom_query(variant,tmp_path):
    from operations.management.commands.migrate_sigs_variants import catalog
    original=catalog()[variant.code]["original_sql"]
    variant.query_sql=original.replace("\r\n","\n").replace("\n","\r\n");variant.save()
    with patch("operations.management.commands.migrate_sigs_variants.compare_source",return_value=(["UNIDADE_SOLICITANTE","CBO","QUANTIDADE"],[])),patch("operations.management.commands.migrate_sigs_variants.export",return_value=(pdf(),0)):
        invoke(tmp_path,apply=True)
    variant.refresh_from_db();assert variant.reviewed and variant.canvas_enabled
