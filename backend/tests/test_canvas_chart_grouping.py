import io
import base64
from datetime import date, datetime, timedelta
from types import SimpleNamespace
import pytest
from rest_framework.exceptions import ValidationError
from pypdf import PdfReader
from operations.report_canvas.schema import default_layout, validate_layout, validate_complete
from operations.report_canvas.blocks import BLOCKS, ChartBlock
from operations.report_canvas.sources import Dataset
from operations.report_canvas.engine import export, build
from operations.models import ReportDefinition


@pytest.fixture
def env(setup):
    v = default_layout()
    v["sources"] = [{"id": "manual", "type": "inline", "columns": ["Mes", "Total"], "rows": [["Jan", 10], ["Fev", 20]]}]
    v["pages"][0]["blocks"] = [
        {"id": "chart", "type": "bar", "x": 40, "y": 230, "width": 650, "height": 260, "source_id": "manual", "title": "Mensal", "options": {"x_field": "Mes", "y_fields": ["Total"]}}
    ]
    report = ReportDefinition.objects.create(
        unit=setup["unit"],
        code="canvas-chart-test",
        name="Canvas Chart Test",
        source="legacy_pending",
        enabled=True,
        reviewed=True,
        canvas_enabled=True,
        canvas_layout=v,
        monthly_goals=[{"year": 2026, "month": 10, "value": 19420}],
    )
    return setup, report, None


def make_ctx(dataset_id, columns, rows, report=None):
    return SimpleNamespace(
        datasets={dataset_id: Dataset(columns, rows)},
        parameters={},
        goals=[],
        assets={},
        report=report,
    )


def test_chart_date_grouping_day():
    rows = [
        [date(2026, 10, 27), 10],
        [date(2026, 10, 27), 20],
        [date(2026, 10, 28), 15],
        [None, 99],
        ["", 88],
    ]
    ctx = make_ctx("src", ["Data", "Valor"], rows)
    block = {
        "id": "c1",
        "type": "bar",
        "title": "Vendas por Dia",
        "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Valor"], "x_group": "day", "y_aggregate": "sum"},
    }
    prepared = BLOCKS["bar"].prepare(block, ctx)
    assert prepared["columns"] == ["Data", "Valor"]
    assert prepared["rows"] == [
        ["27/10/2026", 30.0],
        ["28/10/2026", 15.0],
    ]


def test_chart_date_grouping_week_with_year_boundary():
    # 2025-12-29 is Monday. 2025-12-31 is Wednesday. 2026-01-02 is Friday.
    # All belong to week starting 2025-12-29.
    # 2026-01-05 is the next Monday.
    rows = [
        ["2026-01-02T15:30:00Z", 20],
        ["2025-12-31", 10],
        ["2026-01-05T08:00:00", 50],
        ["2025-12-29", 5],
    ]
    ctx = make_ctx("src", ["Dt", "Total"], rows)
    block = {
        "id": "c_week",
        "type": "line",
        "title": "Semanal",
        "source_id": "src",
        "options": {"x_field": "Dt", "y_fields": ["Total"], "x_group": "week", "y_aggregate": "sum"},
    }
    prepared = BLOCKS["line"].prepare(block, ctx)
    assert prepared["rows"] == [
        ["sem. 29/12", 35.0],
        ["sem. 05/01", 50.0],
    ]


def test_chart_date_grouping_month_pt_br():
    rows = [
        [date(2026, 10, 1), 100],
        [date(2026, 10, 20), 50],
        [date(2026, 11, 5), 200],
        [date(2026, 12, 25), 300],
        [date(2027, 1, 10), 400],
    ]
    ctx = make_ctx("src", ["Data", "Qtd"], rows)
    block = {
        "id": "c_month",
        "type": "bar",
        "title": "Mensal",
        "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Qtd"], "x_group": "month", "y_aggregate": "sum"},
    }
    prepared = BLOCKS["bar"].prepare(block, ctx)
    assert prepared["rows"] == [
        ["out/26", 150.0],
        ["nov/26", 200.0],
        ["dez/26", 300.0],
        ["jan/27", 400.0],
    ]


def test_chart_date_grouping_quarter_and_year():
    rows = [
        [date(2026, 2, 10), 10],
        [date(2026, 5, 15), 20],
        [date(2026, 8, 20), 30],
        [date(2026, 11, 25), 40],
        [date(2027, 1, 5), 50],
    ]
    ctx = make_ctx("src", ["Data", "Qtd"], rows)
    block_q = {
        "id": "c_q",
        "type": "bar",
        "title": "Trimestral",
        "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Qtd"], "x_group": "quarter", "y_aggregate": "sum"},
    }
    prepared_q = BLOCKS["bar"].prepare(block_q, ctx)
    assert prepared_q["rows"] == [
        ["T1/26", 10.0],
        ["T2/26", 20.0],
        ["T3/26", 30.0],
        ["T4/26", 40.0],
        ["T1/27", 50.0],
    ]

    block_y = {
        "id": "c_y",
        "type": "bar",
        "title": "Anual",
        "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Qtd"], "x_group": "year", "y_aggregate": "sum"},
    }
    prepared_y = BLOCKS["bar"].prepare(block_y, ctx)
    assert prepared_y["rows"] == [
        ["2026", 100.0],
        ["2027", 50.0],
    ]


def test_chart_date_grouping_invalid_date_error():
    rows = [
        ["nao-e-data", 10],
    ]
    ctx = make_ctx("src", ["Data", "Valor"], rows)
    block = {
        "id": "c_err",
        "type": "bar",
        "title": "Gráfico Erro",
        "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Valor"], "x_group": "month"},
    }
    with pytest.raises(ValidationError) as exc:
        BLOCKS["bar"].prepare(block, ctx)
    assert exc.value.detail["block_id"] == "c_err"
    assert exc.value.detail["code"] == "x_not_a_date"
    assert 'a coluna "Data" não é uma data (valor "nao-e-data")' in exc.value.detail["detail"]


def test_chart_aggregations():
    rows = [
        ["2026-10-01", 10, "A"],
        ["2026-10-02", 20, "B"],
        ["2026-10-03", 30, "C"],
        ["2026-10-04", None, "D"],
    ]
    ctx = make_ctx("src", ["Data", "Valor", "Texto"], rows)

    # avg
    block_avg = {
        "id": "c_avg", "type": "bar", "title": "Média", "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Valor"], "x_group": "year", "y_aggregate": "avg"},
    }
    prep = BLOCKS["bar"].prepare(block_avg, ctx)
    assert prep["rows"] == [["2026", 20.0]]

    # min and max
    block_min = {
        "id": "c_min", "type": "bar", "title": "Min", "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Valor"], "x_group": "year", "y_aggregate": "min"},
    }
    assert BLOCKS["bar"].prepare(block_min, ctx)["rows"] == [["2026", 10.0]]

    block_max = {
        "id": "c_max", "type": "bar", "title": "Max", "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Valor"], "x_group": "year", "y_aggregate": "max"},
    }
    assert BLOCKS["bar"].prepare(block_max, ctx)["rows"] == [["2026", 30.0]]

    # count accepts any type
    block_cnt = {
        "id": "c_cnt", "type": "bar", "title": "Contagem", "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Texto"], "x_group": "year", "y_aggregate": "count"},
    }
    assert BLOCKS["bar"].prepare(block_cnt, ctx)["rows"] == [["2026", 4]]


def test_chart_series_numeric_error_with_column_name():
    rows = [
        ["2026-10-01", "abc"],
    ]
    ctx = make_ctx("src", ["Data", "Total"], rows)
    block = {
        "id": "c_bad_num",
        "type": "bar",
        "title": "Gráfico Inválido",
        "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Total"], "x_group": "month", "y_aggregate": "sum"},
    }
    with pytest.raises(ValidationError) as exc:
        BLOCKS["bar"].prepare(block, ctx)
    assert exc.value.detail["block_id"] == "c_bad_num"
    assert exc.value.detail["code"] == "series_not_numeric"
    assert 'A série "Total" precisa ser numérica; a coluna tem texto (ex.: "abc").' in exc.value.detail["detail"]


def test_chart_categorical_y_aggregate():
    rows = [
        ["Sul", 10],
        ["Norte", 20],
        ["Sul", 15],
        ["Leste", 30],
        ["Norte", 5],
    ]
    ctx = make_ctx("src", ["Regiao", "Vendas"], rows)
    block = {
        "id": "c_cat",
        "type": "bar",
        "title": "Vendas por Região",
        "source_id": "src",
        "options": {"x_field": "Regiao", "y_fields": ["Vendas"], "y_aggregate": "sum"},
    }
    prep = BLOCKS["bar"].prepare(block, ctx)
    assert prep["rows"] == [
        ["Sul", 25.0],
        ["Norte", 25.0],
        ["Leste", 30.0],
    ]


def test_chart_500_points_limit_after_grouping():
    # 600 points grouped into 12 months -> succeeds
    base = date(2026, 1, 1)
    rows = [[base + timedelta(days=i), 1] for i in range(600)]
    ctx = make_ctx("src", ["Data", "Qtd"], rows)

    # With grouping by month, 600 daily rows turn into ~20 monthly points: succeeds!
    block_grouped = {
        "id": "c_grp", "type": "bar", "title": "G1", "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Qtd"], "x_group": "month"},
    }
    prep = BLOCKS["bar"].prepare(block_grouped, ctx)
    assert len(prep["rows"]) <= 24

    # Without grouping, 600 points exceeds 500 limit:
    block_ungrouped = {
        "id": "c_ungrp", "type": "bar", "title": "G2", "source_id": "src",
        "options": {"x_field": "Data", "y_fields": ["Qtd"]},
    }
    with pytest.raises(ValidationError) as exc:
        BLOCKS["bar"].prepare(block_ungrouped, ctx)
    assert exc.value.detail["block_id"] == "c_ungrp"
    assert exc.value.detail["code"] == "chart_points_limit"
    assert "aceita até 500 pontos, mas gerou 600 pontos" in exc.value.detail["detail"]


def test_chart_series_colors_in_pdf(env):
    setup, report, _ = env
    custom_colors = ["#112233", "#445566", "#778899"]
    layout = default_layout()
    layout["sources"] = [{"id": "m", "type": "inline", "columns": ["Cat", "S1", "S2"], "rows": [["A", 10, 20], ["B", 30, 40]]}]
    layout["pages"][0]["blocks"] = [{
        "id": "c_color",
        "type": "bar",
        "x": 40, "y": 40, "width": 600, "height": 300,
        "source_id": "m",
        "title": "Gráfico Colorido",
        "options": {
            "x_field": "Cat",
            "y_fields": ["S1", "S2"],
            "series_colors": custom_colors,
        },
    }]
    content, count = export(report, layout, {}, [], "pdf")
    assert count == 2
    reader = PdfReader(io.BytesIO(base64.b64decode(content)))
    assert len(reader.pages) == 1


def test_source_label_validation():
    v = default_layout()
    v["sources"] = [{"id": "s1", "type": "inline", "label": "Vendas 2026", "columns": ["x"], "rows": [[1]]}]
    assert validate_layout(v) == v

    # label exceeding 60 characters fails
    v["sources"][0]["label"] = "A" * 61
    with pytest.raises(ValidationError) as exc:
        validate_layout(v)
    assert exc.value.detail["source_id"] == "s1"
    assert exc.value.detail["code"] == "source_label_invalid"


def test_validate_complete_and_draft_permissiveness():
    v = default_layout()
    v["sources"] = [{"id": "s1", "type": "inline", "columns": ["x", "y"], "rows": [[1, 2]]}]
    v["pages"][0]["blocks"] = [{
        "id": "draft_chart",
        "type": "bar",
        "x": 40, "y": 40, "width": 400, "height": 200,
        "source_id": "s1",
        "title": "Gráfico Rascunho",
        "options": {},  # missing x_field and y_fields
    }]
    # validate_layout is permissive on drafts:
    assert validate_layout(v) is not None

    # validate_complete rejects:
    with pytest.raises(ValidationError) as exc:
        validate_complete(v)
    assert exc.value.detail["block_id"] == "draft_chart"
    assert exc.value.detail["code"] == "x_field_required"
    assert 'selecione a coluna do eixo X.' in exc.value.detail["detail"]


def test_legacy_layout_document_identical(env):
    setup, report, _ = env
    legacy = default_layout()
    legacy["sources"] = [{"id": "manual", "type": "inline", "columns": ["Mes", "Total"], "rows": [["Jan", 10], ["Fev", 20]]}]
    legacy["pages"][0]["blocks"] = [
        {"id": "chart", "type": "bar", "x": 40, "y": 230, "width": 650, "height": 260, "source_id": "manual", "title": "Mensal", "options": {"x_field": "Mes", "y_fields": ["Total"]}}
    ]
    doc, count = build(report, legacy, {}, [])
    assert count == 2
    chart_block = doc["pages"][0]["blocks"][0]
    assert chart_block["columns"] == ["Mes", "Total"]
    assert chart_block["rows"] == [["Jan", 10.0], ["Fev", 20.0]]

