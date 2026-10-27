import copy
import json
import math
import re
from rest_framework.exceptions import ValidationError

X_GROUPS = ("day", "week", "month", "quarter", "year")
Y_AGGREGATES = ("sum", "avg", "count", "min", "max")
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
IDENT = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,49}$")


def fail(message):
    raise ValidationError(message)


def fail_at(message, *, block_id=None, source_id=None, code=None):
    """Raise a ValidationError the editor can attach to a block/source.

    Response body: {"detail": message, "block_id"?, "source_id"?, "code"?}.
    Keys without a value are omitted (DRF would serialise None as "None").
    """
    detail = {"detail": message}
    for key, value in (("block_id", block_id), ("source_id", source_id), ("code", code)):
        if value is not None:
            detail[key] = value
    raise ValidationError(detail)


def error_messages(exc):
    """Plain list of messages from a plain or structured ValidationError."""
    detail = exc.detail
    if isinstance(detail, dict):
        message = detail.get("detail")
        return [str(x) for x in message] if isinstance(message, list) else [str(message if message is not None else detail)]
    return [str(x) for x in detail] if isinstance(detail, list) else [str(detail)]


def block_label(block):
    """Title when present, else the block id (used in every error message)."""
    title = block.get("title")
    return title.strip() if isinstance(title, str) and title.strip() else str(block.get("id", "?"))


def source_label(spec):
    """Optional editor label when present, else the source id."""
    label = spec.get("label") if isinstance(spec, dict) else None
    if isinstance(label, str) and label.strip():
        return label.strip()
    return str(spec.get("id", "?")) if isinstance(spec, dict) else "?"


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
            fail_at("Fonte inválida ou duplicada.", source_id=source.get("id") if isinstance(source,dict) and identity(source.get("id")) else None, code="source_invalid")
        ids.add(source["id"])
        label = source.get("label")
        if "label" in source and (not isinstance(label, str) or len(label) > 60):
            fail_at(f'Fonte "{source["id"]}": o nome deve ser um texto de até 60 caracteres.', source_id=source["id"], code="source_label_invalid")
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
                fail_at(f'Bloco "{block_label(b)}": fora dos limites da página. Reposicione ou redimensione o bloco.', block_id=b["id"], code="block_out_of_bounds")
            if b.get("source_id") and b["source_id"] not in ids:
                fail_at(f'Bloco "{block_label(b)}": a fonte "{b["source_id"]}" não existe neste relatório.', block_id=b["id"], source_id=b["source_id"], code="source_not_found")
            for key,limit in [("title",300),("text",20000)]:
                if not isinstance(b.get(key,""),str) or len(b.get(key,""))>limit:
                    fail_at(f'Bloco "{block_label(b)}": título ou texto inválido (até 300 e 20.000 caracteres).', block_id=b["id"], code="block_text_invalid")
            opt=b.setdefault("options",{})
            if not isinstance(opt,dict) or not color(opt.get("color","#075b94")) or not number(opt.get("font_size",14),6,100):
                fail_at(f'Bloco "{block_label(b)}": cor ou tamanho de fonte inválidos (fonte de 6 a 100).', block_id=b["id"], code="block_style_invalid")
            if opt.get("aggregate","sum") not in {"sum","count","first"} or type(opt.get("precision",0)) is not int or not 0 <= opt.get("precision",0) <= 4:
                fail_at(f'Bloco "{block_label(b)}": agregação ou precisão inválida (precisão de 0 a 4).', block_id=b["id"], code="block_aggregate_invalid")
            widths=opt.get("column_widths",[])
            if not isinstance(widths,list) or len(widths)>100 or any(not number(x,1,3000) for x in widths):fail_at(f'Bloco "{block_label(b)}": larguras de colunas inválidas.', block_id=b["id"], code="block_widths_invalid")
            for key in ["x_field","value_field"]:
                if not isinstance(opt.get(key,""),str) or len(opt.get(key,""))>100:
                    fail_at(f'Bloco "{block_label(b)}": nome de coluna inválido (até 100 caracteres).', block_id=b["id"], code="block_column_invalid")
            for key in ["columns","y_fields"]:
                values=opt.get(key,[])
                if not isinstance(values,list) or len(values)>100 or any(not isinstance(x,str) or not x or len(x)>100 for x in values):
                    fail_at(f'Bloco "{block_label(b)}": colunas inválidas (até 100 colunas de até 100 caracteres).', block_id=b["id"], code="block_columns_invalid")
            if "x_group" in opt and opt["x_group"] not in X_GROUPS:
                fail_at(f'Bloco "{block_label(b)}": agrupamento de datas inválido. Use dia, semana, mês, trimestre ou ano.', block_id=b["id"], code="x_group_invalid")
            if "y_aggregate" in opt and opt["y_aggregate"] not in Y_AGGREGATES:
                fail_at(f'Bloco "{block_label(b)}": agregação inválida. Use soma, média, contagem, mínimo ou máximo.', block_id=b["id"], code="y_aggregate_invalid")
            if "series_colors" in opt:
                palette=opt["series_colors"]
                if not isinstance(palette,list) or len(palette)>6 or any(not color(x) for x in palette):
                    fail_at(f'Bloco "{block_label(b)}": informe até 6 cores de série no formato #rrggbb.', block_id=b["id"], code="series_colors_invalid")
            if b["type"] in {"table","kpi","line","bar","pie"} and not b.get("source_id"):
                fail_at(f'Bloco "{block_label(b)}": selecione a fonte de dados.', block_id=b["id"], code="source_required")
            if b["type"]=="image":
                import uuid
                try: b["asset_id"]=str(uuid.UUID(str(b.get("asset_id",""))))
                except ValueError: fail_at(f'Bloco "{block_label(b)}": selecione uma imagem do relatório.', block_id=b["id"], code="asset_required")
    if v.get("xlsx_mode") == "table" and sum(b["type"] == "table" for p in pages for b in p["blocks"]) != 1:
        fail("Planilha tabular exige uma única tabela.")
    return v


def validate_complete(layout):
    """Reject drafts that cannot render: required columns missing.

    Drafts may omit these fields, so validate_layout stays permissive. Preview
    and activation call this on an already validated layout.
    """
    for page in layout["pages"]:
        for b in page["blocks"]:
            opt = b.get("options", {})
            where = f'Bloco "{block_label(b)}" (página "{page["name"]}")'
            if b["type"] in ("line", "bar", "pie"):
                if not opt.get("x_field"):
                    fail_at(f"{where}: selecione a coluna do eixo X.", block_id=b["id"], code="x_field_required")
                if not opt.get("y_fields"):
                    fail_at(f"{where}: selecione ao menos uma coluna de série (Y).", block_id=b["id"], code="y_fields_required")
            elif b["type"] == "kpi" and opt.get("aggregate", "sum") != "count" and not opt.get("value_field"):
                fail_at(f"{where}: selecione a coluna do valor do indicador.", block_id=b["id"], code="value_field_required")
