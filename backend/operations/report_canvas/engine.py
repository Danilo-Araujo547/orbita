import base64
import copy
import hashlib
import json
from contextlib import ExitStack
from types import SimpleNamespace
from rest_framework.exceptions import PermissionDenied, ValidationError
from operations.models import ReportCanvasAsset
from .schema import validate_layout, fail
from .sources import resolve_report, signature, SOURCES
from .blocks import BLOCKS
from .registry import EXPORTERS


def validate_values(report,values):
    from operations.report_engine import parameters
    from operations.report_parameters import normalized_schema
    shadow=SimpleNamespace(parameter_schema=normalized_schema(report.parameter_schema))
    return parameters(shadow,values)


def assets_for(report,layout,*,metadata_only=False):
    ids={b["asset_id"] for p in layout["pages"] for b in p["blocks"] if b["type"]=="image"}
    query=ReportCanvasAsset.objects.filter(pk__in=ids,report=report,unit=report.unit)
    if metadata_only:query=query.only("id","sha256")
    assets={str(a.pk):a for a in query}
    if ids-set(assets):fail("Imagem não encontrada neste relatório/unidade.")
    return assets


def definition_snapshot(report,layout=None):
    layout=validate_layout(report.canvas_layout if layout is None else layout)
    if not any(p["blocks"] for p in layout["pages"]):fail("Adicione ao menos um bloco ao Canvas.")
    sources={}
    signatures={}
    for s in layout["sources"]:
        if s["type"]=="report":
            child=resolve_report(report,s)
            if child.pk not in signatures:signatures[child.pk]=signature(child)
            sources[s["id"]]={"id":child.pk,"signature":signatures[child.pk]}
    assets=assets_for(report,layout,metadata_only=True)
    return {"layout":layout,"sources":sources,"assets":{k:v.sha256 for k,v in assets.items()}}


def check_snapshot(job):
    current=definition_snapshot(job.report)
    if current != job.snapshot.get("canvas"):
        raise PermissionDenied("Layout, fonte ou imagem do Canvas alterados.")


def report_readiness(report):
    try:
        definition_snapshot(report)
        if report.output_format not in {"pdf","xlsx"}:fail("Canvas exporta PDF ou XLSX.")
    except ValidationError as exc:return [str(x) for x in exc.detail] if isinstance(exc.detail,list) else [str(exc.detail)]
    return []


def build(report,layout,parameters,goals):
    layout=validate_layout(layout)
    assets=assets_for(report,layout)
    with ExitStack() as stack:
        ctx=SimpleNamespace(report=report,parameters=parameters,goals=goals,assets=assets,datasets={},sessions={},native_cache={},stack=stack)
        used={b.get("source_id") for p in layout["pages"] for b in p["blocks"]}
        for s in layout["sources"]:
            if s["id"] in used:ctx.datasets[s["id"]]=SOURCES[s["type"]].read(ctx,s)
        if sum(len(d.rows) for d in ctx.datasets.values())>30000:fail("Limite total de 30.000 linhas no Canvas.")
        size=sum(len(json.dumps(d.rows,default=str).encode()) for d in ctx.datasets.values())
        if size>10*1024*1024:fail("Fontes excedem o limite de 10 MB.")
        pages=[{**p,"blocks":[BLOCKS[b["type"]].prepare(b,ctx) for b in p["blocks"]]} for p in layout["pages"]]
        count=sum(len(d.rows) for d in ctx.datasets.values()) if ctx.datasets else 1
        return {"name":report.name,"page":layout["page"],"pages":pages,"xlsx_mode":layout.get("xlsx_mode","layout")},count


def export(report,layout,parameters,goals,output_format):
    from . import pdf, xlsx  # Registers built-in strategies. No I/O during registration.
    if output_format not in EXPORTERS:fail("Formato não suportado pelo Canvas.")
    document,count=build(report,layout,parameters,goals)
    result=EXPORTERS[output_format].render(document)
    if len(result)>7*1024*1024:fail("Arquivo excede 7 MB.")
    return base64.b64encode(result).decode(),count


def generate(job):
    check_snapshot(job)
    return export(job.report,job.snapshot["canvas"]["layout"],job.parameters,job.snapshot.get("monthly_goals",[]),job.format)
