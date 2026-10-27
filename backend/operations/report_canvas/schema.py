import copy
import json
import math
import re
from rest_framework.exceptions import ValidationError

COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
IDENT = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,49}$")


def fail(message):
    raise ValidationError(message)


def number(v, low, high):
    return type(v) in (int, float) and math.isfinite(v) and low <= v <= high


def color(value):
    return isinstance(value, str) and bool(COLOR.fullmatch(value))


def identity(value):
    return isinstance(value, str) and bool(IDENT.fullmatch(value))


def default_layout():
    return {"schema_version": 1, "page": {"width":794,"height":1123,"columns":24,"background":"#ffffff"}, "sources":[], "pages":[{"id":"p1","name":"Página 1","blocks":[]}]}


def validate_layout(value):
    from .blocks import BLOCKS
    from .sources import SOURCES
    try:
        size = len(json.dumps(value, allow_nan=False).encode())
    except (TypeError, ValueError):
        fail("Layout inválido.")
    if size > 750_000 or not isinstance(value, dict) or value.get("schema_version") != 1:
        fail("Layout inválido ou versão não suportada.")
    v = copy.deepcopy(value)
    if v.get("xlsx_mode", "layout") not in {"layout", "table"}:
        fail("Modo de planilha inválido.")
    page = v.get("page")
    if not isinstance(page, dict) or not number(page.get("width"),150,3000) or not number(page.get("height"),150,3000) or type(page.get("columns")) is not int or not 1 <= page["columns"] <= 48 or not color(page.get("background")):
        fail("Tamanho, colunas ou cor da página inválidos.")
    sources = v.get("sources")
    if not isinstance(sources,list) or len(sources)>30:
        fail("Limite de 30 fontes por relatório.")
    ids=set()
    for source in sources:
        if not isinstance(source,dict) or not identity(source.get("id")) or source["id"] in ids or source.get("type") not in SOURCES:
            fail("Fonte inválida ou duplicada.")
        ids.add(source["id"])
        SOURCES[source["type"]].validate(source)
    pages = v.get("pages")
    if not isinstance(pages,list) or not 1 <= len(pages) <= 30:
        fail("Informe entre 1 e 30 páginas.")
    page_ids=set();block_ids=set()
    for p in pages:
        if not isinstance(p,dict) or not identity(p.get("id")) or p["id"] in page_ids or not isinstance(p.get("name"),str) or not p["name"].strip() or len(p["name"])>100 or not isinstance(p.get("blocks"),list):
            fail("Página inválida ou duplicada.")
        page_ids.add(p["id"])
        for b in p["blocks"]:
            if not isinstance(b,dict) or not identity(b.get("id")) or b["id"] in block_ids or b.get("type") not in BLOCKS:
                fail("Bloco inválido ou duplicado.")
            block_ids.add(b["id"])
            if len(block_ids)>100:
                fail("Limite de 100 blocos.")
            if not number(b.get("x"),0,page["width"]) or not number(b.get("y"),0,page["height"]) or not number(b.get("width"),20,page["width"]) or not number(b.get("height"),20,page["height"]) or b["x"]+b["width"]>page["width"]+0.01 or b["y"]+b["height"]>page["height"]+0.01:
                fail("Bloco fora dos limites da página.")
            if b.get("source_id") and b["source_id"] not in ids:
                fail("Fonte do bloco não encontrada.")
            for key,limit in [("title",300),("text",20000)]:
                if not isinstance(b.get(key,""),str) or len(b.get(key,""))>limit:
                    fail("Texto do bloco inválido.")
            opt=b.setdefault("options",{})
            if not isinstance(opt,dict) or not color(opt.get("color","#075b94")) or not number(opt.get("font_size",14),6,100):
                fail("Aparência do bloco inválida.")
            if opt.get("aggregate","sum") not in {"sum","count","first"} or type(opt.get("precision",0)) is not int or not 0 <= opt.get("precision",0) <= 4:
                fail("Agregação ou precisão inválida.")
            widths=opt.get("column_widths",[])
            if not isinstance(widths,list) or len(widths)>100 or any(not number(x,1,3000) for x in widths):fail("Larguras de colunas inválidas.")
            for key in ["x_field","value_field"]:
                if not isinstance(opt.get(key,""),str) or len(opt.get(key,""))>100:
                    fail("Coluna inválida.")
            for key in ["columns","y_fields"]:
                values=opt.get(key,[])
                if not isinstance(values,list) or len(values)>100 or any(not isinstance(x,str) or not x or len(x)>100 for x in values):
                    fail("Colunas do bloco inválidas.")
            if b["type"] in {"table","kpi","line","bar","pie"} and not b.get("source_id"):
                fail("Selecione a fonte do bloco.")
            if b["type"]=="image":
                import uuid
                try: b["asset_id"]=str(uuid.UUID(str(b.get("asset_id",""))))
                except ValueError: fail("Selecione uma imagem do relatório.")
    if v.get("xlsx_mode") == "table" and sum(b["type"] == "table" for p in pages for b in p["blocks"]) != 1:
        fail("Planilha tabular exige uma única tabela.")
    return v
