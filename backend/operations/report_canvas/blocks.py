import math
import re
from .registry import BLOCKS
from .schema import fail


def numeric(value):
    if value in (None, ""): return None
    if isinstance(value,bool): fail("Valor booleano não pode compor uma série numérica.")
    try: result=float(value)
    except (ValueError,TypeError,OverflowError): fail("A coluna selecionada deve ser numérica.")
    if not math.isfinite(result): fail("Valor numérico inválido.")
    return result


def field(data,name):
    if name not in data.columns: fail("Coluna não encontrada: "+str(name))
    return data.columns.index(name)


class TextBlock:
    def prepare(self,b,ctx):
        def sub(match):
            key=match.group(1)
            value=ctx.parameters.get(key,ctx.report.name if key=="report_name" else match.group(0))
            if "." in key:
                source,column=key.split(".",1)
                data=ctx.datasets.get(source)
                if data and column in data.columns and data.rows:value=data.rows[0][data.columns.index(column)]
            if isinstance(value,str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T.*",value):
                from datetime import datetime
                try:value=datetime.fromisoformat(value).strftime("%d/%m/%Y %H:%M:%S")
                except ValueError:pass
            if isinstance(value,str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}",value):
                from datetime import date
                try:value=date.fromisoformat(value).strftime("%d/%m/%Y")
                except ValueError:pass
            return str(value)
        return {**b,"text":re.sub(r"{{\s*([A-Za-z][A-Za-z0-9_.]*)\s*}}",sub,b.get("text",""))}

class ImageBlock:
    def prepare(self,b,ctx):return {**b,"image":ctx.assets[b["asset_id"]]}

class TableBlock:
    def prepare(self,b,ctx):
        d=ctx.datasets[b["source_id"]];columns=b["options"].get("columns") or d.columns
        widths=b["options"].get("column_widths",[])
        if widths and len(widths)!=len(columns):fail("Informe uma largura para cada coluna da tabela.")
        indices=[field(d,c) for c in columns]
        return {**b,"columns":columns,"rows":[[r[i] for i in indices] for r in d.rows]}

class KPIBlock:
    def prepare(self,b,ctx):
        d=ctx.datasets[b["source_id"]];opt=b["options"];mode=opt.get("aggregate","sum")
        if not d.rows:value=None
        elif mode=="count":value=len(d.rows)
        else:
            index=field(d,opt.get("value_field") or (d.columns[1] if len(d.columns)>1 else d.columns[0]))
            values=[numeric(row[index]) for row in d.rows];values=[v for v in values if v is not None]
            value=(sum(values) if mode=="sum" else values[0]) if values else None
        return {**b,"value":value}

class ChartBlock:
    def prepare(self,b,ctx):
        d=ctx.datasets[b["source_id"]];opt=b["options"]
        if len(d.rows)>500:fail("Gráficos aceitam até 500 pontos; agregue os dados na fonte.")
        x=opt.get("x_field") or d.columns[0];ys=opt.get("y_fields") or d.columns[1:2]
        if not ys or len(ys)>6:fail("Selecione de 1 a 6 séries numéricas.")
        xi=field(d,x);indices=[field(d,y) for y in ys]
        rows=[[str(r[xi]),*[numeric(r[i]) for i in indices]] for r in d.rows]
        if b["type"]=="pie" and any(r[1] is not None and r[1]<0 for r in rows):fail("Gráfico de pizza não aceita valores negativos.")
        return {**b,"columns":[x,*ys],"rows":rows}

BLOCKS.register("text",TextBlock())
BLOCKS.register("image",ImageBlock())
BLOCKS.register("table",TableBlock())
BLOCKS.register("kpi",KPIBlock())
for kind in ("line","bar","pie"):BLOCKS.register(kind,ChartBlock())
