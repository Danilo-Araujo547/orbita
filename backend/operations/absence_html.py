"""Reviewed HTML absence-export parser. Uploaded code is never executed."""

import re
import unicodedata
from datetime import datetime
from html.parser import HTMLParser

from scheduling.connectors import normalize_phone


def limpar(valor):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", valor)).strip() or None


def chave(valor):
    texto = unicodedata.normalize("NFKD", valor or "")
    return "".join(c for c in texto if not unicodedata.combining(c)).lower()


class Tabelas(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.pilha = []
        self.registros = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.pilha.append({"celulas": [], "atual": None, "id": None})
        elif self.pilha:
            row = self.pilha[-1]
            if tag in ("td", "th"):
                row["atual"] = []
            elif tag == "input":
                nome = dict(attrs).get("name", "")
                m = re.fullmatch(r"ID_HOR\[(\d+)\]", nome)
                if m:
                    row["id"] = m.group(1)
            elif tag in ("dt", "br", "p", "div") and row["atual"] is not None:
                row["atual"].append("\n")

    def handle_data(self, data):
        if self.pilha and self.pilha[-1]["atual"] is not None:
            self.pilha[-1]["atual"].append(data)

    def handle_endtag(self, tag):
        if not self.pilha:
            return
        row = self.pilha[-1]
        if tag in ("td", "th") and row["atual"] is not None:
            row["celulas"].append("".join(row["atual"]))
            row["atual"] = None
        elif tag == "tr":
            self.registros.append(self.pilha.pop())


COLUNAS = [
    "codigo",
    "paciente",
    "telefone",
    "data",
    "horario",
    "exame",
    "solicitante",
    "executante",
    "profissional",
    "motivo",
    "observacao",
]


def parse_absence(content):
    if content.startswith((b"PK", b"\xd0\xcf\x11\xe0")):
        raise ValueError("unsupported_file")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("cp1252")
    if not re.search(r"<table\b", text, re.I):
        raise ValueError("invalid_html")
    parser = Tabelas()
    parser.feed(text)
    parser.close()
    header = False
    rows = []
    for raw in parser.registros:
        cells = raw["celulas"]
        if len(cells) == 11 and chave(limpar(cells[0])) == "codigo":
            if [chave(limpar(c)) for c in cells] != COLUNAS:
                raise ValueError("invalid_header")
            header = True
            continue
        if not raw["id"]:
            if len(cells) == 11 and (limpar(cells[0]) or "").isdigit():
                raise ValueError("missing_identifier")
            continue
        if not header or len(cells) != 11:
            raise ValueError("invalid_layout")
        if len(rows) >= 10000:
            raise ValueError("row_limit")
        values = dict(zip(COLUNAS, (limpar(c) or "" for c in cells)))
        phones = [limpar(p) for p in re.split(r"[\n;|]+", cells[2]) if limpar(p)]
        row = {
            "external_id": raw["id"],
            "patient_external_id": values["codigo"],
            "patient": values["paciente"],
            "phone": phones[0] if phones else "",
            "raw_phone_numbers": phones,
            "procedure": values["exame"],
            "professional": values["profissional"],
            "solicitante": values["solicitante"],
            "executante": values["executante"],
            "source_reason": values["motivo"],
            "source_observation": values["observacao"],
        }
        try:
            day = datetime.strptime(values["data"].replace("-", "/"), "%d/%m/%Y")
            hour = datetime.strptime(
                values["horario"], "%H:%M:%S" if values["horario"].count(":") == 2 else "%H:%M"
            )
            row["occurred_at"] = datetime.combine(day.date(), hour.time()).isoformat()
            row["phone_numbers"] = list(dict.fromkeys(normalize_phone(p) for p in phones))
        except ValueError:
            row["occurred_at"] = ""
            row["_error"] = "invalid_date_or_phone"
        rows.append(row)
    if not rows:
        raise ValueError("empty_file")
    return rows
