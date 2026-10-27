"""Read-only inventory -> anonymous structural fixtures on stdout.
Run inside the tests container with PGOPTIONS=-c default_transaction_read_only=on.
No source is queried and no original name, text, ID or cell value is emitted.
"""
import copy
import json
import os
import sys
import uuid
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.db import connection, transaction
from operations.models import ReportDefinition
from operations.report_canvas.schema import validate_layout

if len(sys.argv) != 2:
    raise SystemExit("Informe explicitamente o nome do banco para leitura.")
connection.settings_dict["NAME"] = sys.argv[1]

def anonymous(raw):
    v = copy.deepcopy(raw)
    source_ids = {s["id"]: f"s{i}" for i, s in enumerate(v["sources"], 1)}
    column_ids = {}
    def column(c):
        if c not in column_ids: column_ids[c] = f"Coluna {len(column_ids) + 1}"
        return column_ids[c]
    for i, s in enumerate(v["sources"], 1):
        s["id"] = source_ids[s["id"]]
        if "label" in s: s["label"] = f"Fonte {i}"
        if s["type"] == "report":
            s["report_id"] = i
            if "parameters" in s:
                s["parameters"] = {f"param{j}": None for j, _ in enumerate(s["parameters"], 1)}
        elif s["type"] == "inline":
            s["columns"] = [column(c) for c in s["columns"]]
            s["rows"] = [[None if c is None else False if isinstance(c, bool) else 0 if isinstance(c, (int, float)) else "Texto sintético" for c in r] for r in s["rows"]]
    for i, p in enumerate(v["pages"], 1):
        p["id"] = f"p{i}"; p["name"] = f"Página {i}"
        for j, b in enumerate(p["blocks"], 1):
            b["id"] = f"b{i}_{j}"
            if "title" in b: b["title"] = "Bloco sintético" if b["title"] else ""
            if "text" in b: b["text"] = "Texto sintético" if b["text"] else ""
            if "source_id" in b: b["source_id"] = source_ids[b["source_id"]]
            if "asset_id" in b: b["asset_id"] = str(uuid.UUID(int=i * 100 + j))
            opt = b.get("options", {})
            for key in ("x_field", "value_field"):
                if key in opt: opt[key] = column(opt[key]) if opt[key] else ""
            for key in ("columns", "y_fields"):
                if key in opt: opt[key] = [column(c) for c in opt[key]]
    # Known schema only. Exclude runtime signatures/any unrecognised metadata.
    allowed = {"schema_version", "page", "sources", "pages", "xlsx_mode", "export_format"}
    return {k: val for k, val in v.items() if k in allowed}

with transaction.atomic():
    with connection.cursor() as cursor: cursor.execute("SET TRANSACTION READ ONLY")
    layouts = list(ReportDefinition.objects.exclude(canvas_layout={}).order_by("pk").values_list("canvas_layout", flat=True))
    for layout in layouts: validate_layout(layout)
    result = [anonymous(layout) for layout in layouts]
print(json.dumps(result, ensure_ascii=False, indent=2))
