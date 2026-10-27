"""Manual stock-loan report, Oracle read-only data and grouped A4 PDF."""
import base64
import hashlib
import io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from html import escape
from itertools import groupby
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from operations.report_engine import parameters, run_query

HANDLER = "stock_loans_v1"
LAYOUT_VERSION = "1"
DATE_KEYS = ("WPA_DATA_INICIAL", "WPA_DATA_FINAL")
COLUMNS = ("TP_EMPRESTIMO", "DT_EMPRESTIMO", "CPRODUTO", "PRODUTO", "UNIDADE", "QT_ENTRADA", "QT_ESTOQUE_ATUAL", "DS_LOCALIZACAO")


def report_readiness(report):
    missing = []
    if report.unit.slug != "scv" or report.code != "legacy123-1" or report.source != "sql":
        missing.append("Estoque: revisar unidade, código e fonte SQL.")
    if not report.connection_id or report.connection.engine != "oracle":
        missing.append("Estoque exige conexão Oracle da unidade.")
    if report.output_format != "pdf":
        missing.append("Estoque exige formato PDF.")
    if set(report.parameter_schema) != set(DATE_KEYS) or any(
        not isinstance(report.parameter_schema.get(k), dict)
        or report.parameter_schema[k].get("type") != "date"
        or not report.parameter_schema[k].get("required", True) for k in DATE_KEYS
    ):
        missing.append("Estoque exige data inicial e final obrigatórias.")
    if report.legacy.get("migration", {}).get("environment") not in {"homologacao", "producao"}:
        missing.append("Identifique o ambiente da validação de Estoque.")
    return missing


def prepare_values(report, values, *, origin, recipient):
    if origin not in {"panel", "whatsapp"}:
        raise PermissionDenied("Estoque: programação automática não homologada.")
    parsed = parameters(report, values)
    first, last = (parsed[k] for k in DATE_KEYS)
    if first > last:
        raise ValidationError("A data final deve ser igual ou posterior à data inicial.")
    if (last - first).days > 365:
        raise ValidationError("Selecione um período de até 366 dias.")
    return {k: parsed[k].isoformat() for k in DATE_KEYS}


def definition_snapshot(report):
    return {"layout_version": LAYOUT_VERSION, "query_sha256": hashlib.sha256(report.query_sql.encode()).hexdigest(),
            "environment": report.legacy.get("migration", {}).get("environment"),
            "connection_id": report.connection_id, "connection_version": report.connection.version}


def check_snapshot(job):
    if job.snapshot.get("stock_loans") != definition_snapshot(job.report):
        raise PermissionDenied("A definição ou o ambiente do relatório de Estoque foi alterado.")
    prepare_values(job.report, job.parameters, origin=job.origin, recipient=job.recipient)


def number(value):
    if value in (None, ""):
        return None
    try:
        result = Decimal(str(value))
        if not result.is_finite():
            raise InvalidOperation()
        return result
    except (InvalidOperation, ValueError):
        raise ValidationError("Valor numérico inválido no resultado de Estoque.") from None


def display_number(value):
    value = number(value)
    if value is None:
        return "-"
    text = format(value, ",f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text.replace(",", "_").replace(".", ",").replace("_", ".")


def display_date(value):
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%d/%m/%Y")
    except ValueError:
        raise ValidationError("Data inválida no resultado de Estoque.") from None


def render_stock_pdf(headers, rows, values, *, environment, generated_at=None):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    if environment not in {"homologacao", "producao"}:
        raise ValidationError("Ambiente do relatório de Estoque não identificado.")
    keys = [str(h).upper() for h in headers]
    if len(set(keys)) != len(keys) or not set((*COLUMNS, "DS_FORNECEDOR")).issubset(keys):
        raise ValidationError("Colunas do relatório de Estoque incompatíveis com o layout.")
    if any(len(r) != len(keys) for r in rows):
        raise ValidationError("Resultado de Estoque com colunas incompletas.")
    records = [dict(zip(keys, row)) for row in rows]
    records.sort(key=lambda r: str(r["DS_FORNECEDOR"]).casefold())
    out = io.BytesIO()
    width = A4[0] - 56
    body = ParagraphStyle("stock_body", fontName="Helvetica", fontSize=7.5, leading=10)
    bold = ParagraphStyle("stock_bold", parent=body, fontName="Helvetica-Bold")
    right = ParagraphStyle("stock_right", parent=body, alignment=TA_RIGHT)
    small = ParagraphStyle("stock_small", parent=body, fontSize=7, leading=9)
    para = lambda value, style=body: Paragraph(escape(str(value or "-")), style)
    generated_at = generated_at or timezone.now()
    period = "Período: " + display_date(values[DATE_KEYS[0]]) + " a " + display_date(values[DATE_KEYS[1]])
    env = "HOMOLOGAÇÃO" if environment == "homologacao" else "PRODUÇÃO"
    story = [Paragraph("Estoque - entrada e saída de empréstimos", ParagraphStyle("title", parent=bold, fontSize=14, leading=18)),
             Spacer(1, 6), para(period), para("Ambiente: " + env, bold), Spacer(1, 8),
             para("Estoque atual: posição no momento da consulta; não representa o saldo no fim do período.", small), Spacer(1, 10)]
    column_labels = [para(x, bold) for x in ("Tipo", "Data", "Código", "Produto", "Unidade", "Qtde.", "Est. atual", "Localização")]
    weights = [72,48,42,135,44,48,55,95]
    widths = [width*v/sum(weights) for v in weights]
    base_styles = [("BACKGROUND", (0,1),(-1,1), colors.HexColor("#e4eaf0")), ("VALIGN", (0,0),(-1,-1), "TOP"),
              ("LEFTPADDING", (0,0),(-1,-1), 4), ("RIGHTPADDING", (0,0),(-1,-1), 4),
              ("TOPPADDING", (0,0),(-1,-1), 5), ("BOTTOMPADDING", (0,0),(-1,-1), 5)]
    total_qty = Decimal(0); total_stock = Decimal(0); missing_stock = 0
    for supplier, group in groupby(records, key=lambda r: str(r["DS_FORNECEDOR"])):
        group = list(group)
        data = [[para("Fornecedor: " + supplier, bold)] + [""] * 7, column_labels]
        styles = list(base_styles) + [("SPAN",(0,0),(7,0)),("BACKGROUND",(0,0),(7,0), colors.HexColor("#eef3f6"))]
        qty = Decimal(0); stock = Decimal(0); absent = 0
        for record in group:
            row = []
            for col in COLUMNS:
                val = record[col]
                if col == "DT_EMPRESTIMO": val = display_date(val)
                if col in {"QT_ENTRADA", "QT_ESTOQUE_ATUAL"}: val = display_number(val)
                row.append(para(val, right if col.startswith("QT_") else body))
            data.append(row)
            qty += number(record["QT_ENTRADA"]) or Decimal(0)
            amount = number(record["QT_ESTOQUE_ATUAL"])
            if amount is None: absent += 1
            else: stock += amount
        idx = len(data)
        label = "Subtotal - " + str(len(group)) + (" item" if len(group) == 1 else " itens")
        data.append([para(label, bold), "", "", "", "", para(display_number(qty), right), para(display_number(stock) if not absent else "Incompleto", right), ""])
        styles.extend([("SPAN",(0,idx),(4,idx)),("LINEABOVE",(0,idx),(7,idx),.5,colors.HexColor("#aebbc4"))])
        table=Table(data, colWidths=widths, repeatRows=2, hAlign="LEFT")
        table.setStyle(TableStyle(styles));story.extend([table, Spacer(1,8)])
        total_qty += qty;total_stock += stock;missing_stock += absent
    if not records:
        story += [para("Não existem dados para a data selecionada."), Spacer(1, 8)]
    else:
        totals=[[para("Total geral - " + str(len(records)) + (" item" if len(records) == 1 else " itens"), bold), "", "", "", "", para(display_number(total_qty), right), para(display_number(total_stock) if not missing_stock else "Incompleto", right), ""]]
        table=Table(totals,colWidths=widths,hAlign="LEFT")
        table.setStyle(TableStyle([entry for entry in base_styles if entry[0] != "BACKGROUND"] + [("SPAN",(0,0),(4,0)),("BACKGROUND",(0,0),(7,0),colors.HexColor("#e4eaf0"))]))
        story.append(table)
    story += [Spacer(1,10), para("Subtotais e total geral somam as linhas exibidas, conforme o layout legado. O saldo atual pode se repetir por movimento; sua soma não é um saldo consolidado. Quantidades podem ter unidades diferentes.", small)]
    if missing_stock:
        story += [Spacer(1,4), para("Estoque não calculável em " + str(missing_stock) + " linha(s): fator da unidade ou saldo ausente. Totais de estoque identificados como incompletos.", small)]
    def footer(canvas, doc):
        canvas.saveState();canvas.setFont("Helvetica",7)
        canvas.setFillColor(colors.HexColor("#566473"))
        canvas.drawString(28,22,"SCV Messenger | " + env + " | " + generated_at.strftime("%d/%m/%Y %H:%M"))
        canvas.drawRightString(A4[0]-28,22,"Página " + str(doc.page));canvas.restoreState()
    SimpleDocTemplate(out,pagesize=A4,leftMargin=28,rightMargin=28,topMargin=30,bottomMargin=36,
                      title="Estoque - entrada e saída de empréstimos",author="SCV Messenger").build(story,onFirstPage=footer,onLaterPages=footer)
    return out.getvalue()


def generate(job):
    check_snapshot(job)
    headers,rows=run_query(job.report,job.parameters)
    content=render_stock_pdf(headers,rows,job.parameters,environment=job.snapshot["stock_loans"]["environment"],
        generated_at=timezone.localtime(timezone.now(),ZoneInfo(job.unit.timezone)))
    return base64.b64encode(content).decode(),len(rows)
