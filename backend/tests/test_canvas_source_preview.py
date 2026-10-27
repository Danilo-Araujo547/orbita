import uuid
from datetime import date, datetime
from decimal import Decimal
import pytest
from rest_framework.exceptions import ValidationError
from core.models import Audit, Unit, Membership
from operations.models import ReportDefinition
from operations.report_canvas.api import infer_column_metadata, serialize_cell
from operations.report_canvas.schema import default_layout


@pytest.fixture
def env(setup):
    v = default_layout()
    v["sources"] = [{"id": "manual", "type": "inline", "columns": ["Mes", "Total"], "rows": [["Jan", 10], ["Fev", 20]]}]
    report = ReportDefinition.objects.create(
        unit=setup["unit"],
        code="canvas-preview-test",
        name="Canvas Preview Test",
        source="legacy_pending",
        enabled=True,
        reviewed=True,
        canvas_enabled=True,
        canvas_layout=v,
        monthly_goals=[{"year": 2026, "month": 10, "value": 19420}],
    )
    return setup, report, None


def test_infer_column_metadata_types():
    # Number (int, float, Decimal)
    col_num = infer_column_metadata("vendas", [10, Decimal("25.50"), 30.0, None])
    assert col_num["name"] == "vendas"
    assert col_num["type"] == "number"
    assert col_num["nullable"] is True
    assert col_num["null_count"] == 1
    assert col_num["sample"] == ["10", "25.50", "30.0"]

    # Boolean
    col_bool = infer_column_metadata("ativo", [True, False, True])
    assert col_bool["type"] == "boolean"
    assert col_bool["nullable"] is False
    assert col_bool["null_count"] == 0
    assert col_bool["sample"] == ["True", "False"]

    # Date vs Datetime
    col_dt = infer_column_metadata("criado_em", [datetime(2026, 10, 27, 10, 30), None])
    assert col_dt["type"] == "datetime"
    assert col_dt["nullable"] is True

    col_d = infer_column_metadata("data", [date(2026, 10, 27)])
    assert col_d["type"] == "date"
    assert col_d["nullable"] is False

    # Text looks_like date (>= 90%)
    col_txt_date = infer_column_metadata("data_str", [
        "2026-10-27", "2026-10-28T14:30:00Z", "2026-10-29",
        "2026-10-30", "2026-10-31", "2026-11-01",
        "2026-11-02", "2026-11-03", "2026-11-04", "texto_qualquer"
    ])
    assert col_txt_date["type"] == "text"
    assert col_txt_date.get("looks_like") == "date"

    # Text looks_like number (>= 90%)
    col_txt_num = infer_column_metadata("valor_str", ["100", "250.5", "-30", "40", "50", "60", "70", "80", "90", "abc"])
    assert col_txt_num["type"] == "text"
    assert col_txt_num.get("looks_like") == "number"

    # Plain text without looks_like
    col_plain = infer_column_metadata("desc", ["foo", "bar", "baz"])
    assert col_plain["type"] == "text"
    assert "looks_like" not in col_plain

    # Unknown when empty or all nulls
    assert infer_column_metadata("vazia", [])["type"] == "unknown"
    all_null = infer_column_metadata("nulos", [None, None])
    assert all_null["type"] == "unknown"
    assert all_null["nullable"] is True
    assert all_null["null_count"] == 2
    assert all_null["sample"] == []


def test_serialize_cell():
    assert serialize_cell(None) is None
    assert serialize_cell(date(2026, 10, 27)) == "2026-10-27"
    assert serialize_cell(datetime(2026, 10, 27, 8, 30)) == "2026-10-27T08:30:00"
    assert serialize_cell(Decimal("100.00")) == 100
    assert serialize_cell(Decimal("100.50")) == 100.5
    assert serialize_cell(42) == 42
    assert serialize_cell("texto") == "texto"
    assert serialize_cell(True) is True


def test_source_preview_endpoint_inline(env):
    setup, report, _ = env
    client = setup["client"]
    payload = {
        "source": {
            "id": "s_inline",
            "type": "inline",
            "label": "Tabela Manual",
            "columns": ["ID", "Nome", "Ativo", "Data"],
            "rows": [
                [1, "Alice", True, "2026-10-27"],
                [2, "Bob", False, "2026-10-28"],
            ],
        },
        "limit": 50,
    }
    url = f"/api/v1/reports/{report.pk}/canvas-source-preview/?unit=ame"
    resp = client.post(url, payload, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_rows"] == 2
    assert data["truncated"] is False
    assert len(data["columns"]) == 4
    assert data["columns"][0]["name"] == "ID"
    assert data["columns"][0]["type"] == "number"
    assert data["columns"][1]["name"] == "Nome"
    assert data["columns"][1]["type"] == "text"
    assert data["columns"][2]["name"] == "Ativo"
    assert data["columns"][2]["type"] == "boolean"
    assert data["columns"][3]["name"] == "Data"
    assert data["columns"][3]["type"] == "text"
    assert data["columns"][3]["looks_like"] == "date"

    # Verify audit
    audit = Audit.objects.filter(action="report.canvas_source_previewed", object_id=str(report.pk)).last()
    assert audit is not None
    assert audit.details["source_id"] == "s_inline"
    assert audit.details["total_rows"] == 2
    # Ensure raw rows are not in audit details
    assert "rows" not in audit.details


def test_source_preview_limit_and_truncation(env):
    setup, report, _ = env
    client = setup["client"]
    rows = [[i, f"Item {i}"] for i in range(60)]
    payload = {
        "source": {
            "id": "s_many",
            "type": "inline",
            "columns": ["Num", "Label"],
            "rows": rows,
        },
        "limit": 10,
    }
    url = f"/api/v1/reports/{report.pk}/canvas-source-preview/?unit=ame"
    resp = client.post(url, payload, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_rows"] == 60
    assert data["truncated"] is True
    assert len(data["rows"]) == 10
    assert data["rows"][0] == [0, "Item 0"]
    assert data["rows"][9] == [9, "Item 9"]


def test_source_preview_goals_source(env):
    setup, report, _ = env
    client = setup["client"]
    payload = {
        "source": {
            "id": "goals_src",
            "type": "goals",
        },
    }
    url = f"/api/v1/reports/{report.pk}/canvas-source-preview/?unit=ame"
    resp = client.post(url, payload, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert resp.status_code == 200
    data = resp.json()
    assert [c["name"] for c in data["columns"]] == ["year", "month", "value"]
    assert data["total_rows"] == 1
    assert data["rows"] == [[2026, 10, 19420]]


def test_source_preview_unit_isolation(env):
    setup, report, _ = env
    client = setup["client"]

    # Other unit
    other_unit = Unit.objects.create(name="Hospital Outro", slug="other")
    foreign_report = ReportDefinition.objects.create(
        unit=other_unit, code="foreign", name="Estrangeiro", source="legacy_pending", enabled=True, reviewed=True
    )

    # 1. Accessing foreign report endpoint directly
    url_foreign = f"/api/v1/reports/{foreign_report.pk}/canvas-source-preview/?unit=ame"
    resp = client.post(url_foreign, {"source": {"type": "inline", "columns": ["x"], "rows": [[1]]}}, format="json")
    assert resp.status_code == 404

    # 2. Embedding foreign report as report source
    url = f"/api/v1/reports/{report.pk}/canvas-source-preview/?unit=ame"
    payload = {
        "source": {
            "id": "foreign_src",
            "type": "report",
            "report_id": foreign_report.pk,
        }
    }
    resp = client.post(url, payload, format="json")
    assert resp.status_code == 400
    assert "Fonte indisponível nesta unidade." in str(resp.json())


def test_source_preview_validation_errors(env):
    setup, report, _ = env
    client = setup["client"]
    url = f"/api/v1/reports/{report.pk}/canvas-source-preview/?unit=ame"

    # Missing source
    resp = client.post(url, {}, format="json")
    assert resp.status_code == 400
    assert resp.json()["code"] == "source_required"

    # Unknown source type
    resp = client.post(url, {"source": {"id": "x", "type": "inexistente"}}, format="json")
    assert resp.status_code == 400
    assert resp.json()["code"] == "source_type_invalid"
