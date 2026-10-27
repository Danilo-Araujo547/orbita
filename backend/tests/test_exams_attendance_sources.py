import json,re
from pathlib import Path
from types import SimpleNamespace
from datetime import date
import pytest
from rest_framework.exceptions import ValidationError
from operations.report_engine import parameters,sql_contract,bound_sql
ROOT=Path(__file__).resolve().parents[1]/"operations/report_sql/exams_per_attendance"
CATALOG=json.loads((ROOT/"sources.json").read_text())

@pytest.mark.parametrize("code",list(CATALOG))
def test_extracted_sources_use_binds_and_keep_hospital_filters(code):
 spec=CATALOG[code];sql=(ROOT/spec["file"]).read_text()
 assert sql_contract(sql,spec["schema"],"oracle")==set(spec["schema"])
 report=SimpleNamespace(parameter_schema=spec["schema"])
 parsed=parameters(report,{"WPA_DATA_INICIAL":"2026-10-01","WPA_DATA_FINAL":"2026-10-24"})
 _,binds=bound_sql(sql,parsed,"oracle")
 assert binds=={"WPA_DATA_INICIAL":date(2026,10,1),"WPA_DATA_FINAL":date(2026,10,24)}
 assert "'U'" in sql and bool(re.search(r"cd_ori_ate\s*<>\s*46",sql,re.I)) and ("cd_convenio = 2" in sql.lower())
 assert sql.count(":WPA_DATA_INICIAL")== (2 if spec["legacy_id"]==35 else 1)
 assert "2023'" not in sql and "2022'" not in sql

@pytest.mark.parametrize("code",list(CATALOG))
def test_inverted_period_is_rejected_before_query(code):
 report=SimpleNamespace(parameter_schema=CATALOG[code]["schema"])
 with pytest.raises(ValidationError):parameters(report,{"WPA_DATA_INICIAL":"2026-10-24","WPA_DATA_FINAL":"2026-10-01"})
