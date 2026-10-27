"""Layouts fixos usados para provar que layouts antigos continuam idênticos."""
import json
from operations.report_canvas.schema import default_layout


def block(kind, ident, source, title, options=None, y=100, height=260):
    return {"id": ident, "type": kind, "x": 40, "y": y, "width": 650, "height": height, "source_id": source, "title": title, "options": options or {}}


def base():
    v = default_layout()
    v["sources"] = [
        {"id": "manual", "type": "inline", "columns": ["Mes", "Total"], "rows": [["Jan", 10], ["Fev", 20]]},
        {"id": "multi", "type": "inline", "columns": ["Dia", "A", "B", "C"], "rows": [["2026-01-01", 1, 2.5, None], ["2026-01-02", 3, None, 4], ["2026-01-03", 5, 6, 7], ["2026-01-03", 1, 1, 1]]},
        {"id": "numx", "type": "inline", "columns": ["Ano", "Valor"], "rows": [[2024, 1.5], [2025, "2"], [None, 3], [True, 4], [2026, ""]]},
        {"id": "big", "type": "inline", "columns": ["N", "V"], "rows": [[str(i), i] for i in range(500)]},
    ]
    return v


def fixture_layouts():
    out = {}
    v = base()
    v["pages"][0]["blocks"] = [
        {"id": "title", "type": "text", "x": 40, "y": 25, "width": 700, "height": 60, "text": "Relatório {{report_name}}"},
        {**block("kpi", "total", "manual", "Total", {"value_field": "Total", "aggregate": "sum"}), "width": 200, "height": 100},
        block("bar", "chart", "manual", "Mensal", {"x_field": "Mes", "y_fields": ["Total"]}, y=230),
        block("table", "table", "manual", "Registros", y=540, height=280),
    ]
    out["classic"] = v
    for kind in ("bar", "line", "pie"):
        v = base()
        v["pages"][0]["blocks"] = [block(kind, "c", "multi", "Séries", {"x_field": "Dia", "y_fields": ["A", "B", "C"][: 1 if kind == "pie" else 3], "color": "#112233"})]
        out["multi_" + kind] = v
    v = base()
    v["pages"][0]["blocks"] = [block("bar", "c", "numx", "Eixo numérico", {"x_field": "Ano", "y_fields": ["Valor"]})]
    out["numeric_x"] = v
    v = base()
    v["pages"][0]["blocks"] = [block("line", "c", "big", "500 pontos", {})]
    out["limit_500"] = v
    v = base()
    v["pages"][0]["blocks"] = [block("bar", "c", "multi", "Defaults", {})]
    out["defaults"] = v
    return out


def canonical(document):
    return json.dumps(document, sort_keys=True, default=str)
