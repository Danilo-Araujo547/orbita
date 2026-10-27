"""Compare exports in memory, with one read of each source and no sensitive output.
Requires /baseline to be a read-only mount of canvas-baseline/report_canvas.
DB connection is explicitly read-only. No exports or datasets are written.
"""
import copy
import importlib
import importlib.util
import io
import json
import logging
import os
import re
import signal
import sys
import zipfile
from contextlib import ExitStack
from unittest.mock import patch
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
logging.disable(logging.CRITICAL)
from django.db import connection, transaction
from rest_framework.exceptions import ValidationError
from operations.models import ReportDefinition
from operations.report_canvas import engine, sources, pdf, xlsx
from reportlab.pdfgen import canvas

connection.settings_dict["NAME"] = sys.argv[1]
spec = importlib.util.spec_from_file_location("baseline_canvas", "/baseline/__init__.py", submodule_search_locations=["/baseline"])
base = importlib.util.module_from_spec(spec)
sys.modules["baseline_canvas"] = base
spec.loader.exec_module(base)
old_engine = importlib.import_module("baseline_canvas.engine")
old_sources = importlib.import_module("baseline_canvas.sources")
old_pdf = importlib.import_module("baseline_canvas.pdf")
old_xlsx = importlib.import_module("baseline_canvas.xlsx")

def canonical_xlsx(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        return {n: re.sub(rb"<dcterms:(created|modified)[^>]*>.*?</dcterms:\1>", b"", z.read(n)) if n == "docProps/core.xml" else z.read(n) for n in z.namelist()}

original_canvas = canvas.Canvas
def deterministic_canvas(*args, **kwargs):
    return original_canvas(*args, **{**kwargs, "invariant": 1})

def timeout(_sig, _frame):
    raise TimeoutError("timebox")
signal.signal(signal.SIGALRM, timeout)
results = []
with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute("SET TRANSACTION READ ONLY")
        cursor.execute("SET LOCAL statement_timeout = '15s'")
    reports = list(ReportDefinition.objects.exclude(canvas_layout={}).order_by("pk").select_related("unit"))
    for index, report in enumerate(reports, 1):
        entry = {"layout": index}
        captured = {}
        try:
            signal.alarm(25)
            with ExitStack() as stack:
                # Shared dataset snapshots eliminate changing live-data false positives.
                for kind, reader in sources.SOURCES.items():
                    original_read = reader.read
                    def capture(ctx, source, original_read=original_read):
                        data = original_read(ctx, source)
                        captured[source["id"]] = copy.deepcopy(data)
                        return data
                    stack.enter_context(patch.object(reader, "read", capture))
                document, count = engine.build(report, report.canvas_layout, {}, report.monthly_goals)
            with ExitStack() as stack:
                for reader in old_sources.SOURCES.values():
                    stack.enter_context(patch.object(reader, "read", lambda ctx, source: copy.deepcopy(captured[source["id"]])))
                old_document, old_count = old_engine.build(report, report.canvas_layout, {}, report.monthly_goals)
            entry["document"] = "equal" if document == old_document and count == old_count else "different"
            for fmt, current, previous in [("pdf", pdf.PDFExporter(), old_pdf.PDFExporter()), ("xlsx", xlsx.XLSXExporter(), old_xlsx.XLSXExporter())]:
                try:
                    with patch.object(canvas, "Canvas", deterministic_canvas):
                        current_bytes = current.render(document)
                        previous_bytes = previous.render(old_document)
                    entry[fmt] = "equal" if (current_bytes == previous_bytes if fmt == "pdf" else canonical_xlsx(current_bytes) == canonical_xlsx(previous_bytes)) else "different"
                except Exception as exc:
                    # Never print messages, names, queries or source data.
                    entry[fmt] = "blocked:" + type(exc).__name__
        except Exception as exc:
            entry["blocked"] = type(exc).__name__
            if isinstance(exc, ValidationError):
                # Also prove the unavailable/parameter-dependent layouts already
                # fail in baseline, without emitting the validation message.
                detail = str(exc.detail).lower()
                entry["reason"] = "required_parameters" if "parâmetro" in detail else "source_unavailable" if "fonte" in detail else "other_validation"
                try:
                    old_engine.build(report, report.canvas_layout, {}, report.monthly_goals)
                    entry["baseline_validation"] = "different"
                except ValidationError as old_exc:
                    entry["baseline_validation"] = "equal" if exc.detail == old_exc.detail else "different"
                except Exception as old_exc:
                    entry["baseline_validation"] = type(old_exc).__name__
        finally:
            signal.alarm(0)
        results.append(entry)
        print(json.dumps(entry), flush=True)
print(json.dumps({"total": len(results), "equal_pdf": sum(r.get("pdf") == "equal" for r in results), "equal_xlsx": sum(r.get("xlsx") == "equal" for r in results), "different": sum("different" in r.values() for r in results), "blocked": sum("blocked" in r or any(str(v).startswith("blocked:") for v in r.values()) for r in results)}))
