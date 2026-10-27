from datetime import date
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from operations.models import ReportDefinition
from operations.report_canvas.api import response
from operations.report_canvas.native import catalog_datasets

@pytest.mark.parametrize("handler,dataset,count",[
 ("medical_indicators_v1","specialties",16),
 ("medical_indicators_v1","opinions_months",14),
 ("medical_indicators_v1","opinions_days",11),
 ("occupancy_indicators_v1","sectors",24),
 ("exams_per_attendance_v1","providers",24),
])
def test_editor_catalog_exposes_all_dynamic_columns_without_querying_hospital(setup,handler,dataset,count):
 report=ReportDefinition.objects.create(unit=setup["unit"],code=handler,name=handler,handler=handler,source="composite",reviewed=True,enabled=True)
 with patch("operations.report_engine.connect",side_effect=AssertionError("Editor cannot query hospital")):
  result=response(report)
 columns=next(x for x in result["sources"] if x["id"]==report.pk)["datasets"]
 columns=next(x for x in columns if x["id"]==dataset)["columns"]
 assert len(columns)==count and len(set(columns))==count


def test_rolling_headers_keep_previous_year_at_january_boundary():
 report=SimpleNamespace(source="composite",handler="medical_indicators_v1")
 result=catalog_datasets(report,date(2026,1,1))
 assert result["specialties"][:4]==["Especialidade","2025","2026","jan/25"]
 assert result["specialties"][-1]=="jan/26"
 assert result["opinions_days"][1:]==[f"{d}/12/2025" for d in range(22,32)]


def test_provider_editor_headers_match_export_schema_without_rows():
 from operations.exams_attendance import tables
 from decimal import Decimal
 ref=date(2026,10,26)
 report=SimpleNamespace(source="composite",handler="exams_per_attendance_v1")
 assert catalog_datasets(report,ref)["providers"]==tables({"exams":[],"attendances":[]},ref,Decimal("2.5"))["providers"][0]


def test_future_native_adapter_can_declare_dynamic_columns_without_catalog_special_cases():
 from operations.report_canvas.dataset_schema import resolve_columns
 ref=date(2027,2,1)
 columns=["Nome",*[f"Janela {i}" for i in range(99)]]
 with patch("operations.report_canvas.native.datasets",return_value={"future_dataset":lambda actual:columns if actual==ref else ["Outra janela"]}):
  result=catalog_datasets(SimpleNamespace(handler="future_adapter"),ref)
 assert result=={"future_dataset":columns}
 result["future_dataset"].append("local mutation")
 assert len(columns)==100
 assert resolve_columns({"future":["Nome","Total"]},ref)=={"future":["Nome","Total"]}


@pytest.mark.parametrize("spec",[None,[],["A","A"],["A",None],["A",""]])
def test_unknown_or_partial_column_contract_is_rejected_instead_of_silently_truncated(spec):
 from operations.report_canvas.dataset_schema import resolve_columns
 from rest_framework.exceptions import ValidationError
 with pytest.raises(ValidationError,match="Declare todas as colunas"):
  resolve_columns({"future_dataset":spec},date(2027,1,1))
