"""Parser for the reviewed CROSS demanda por recurso export."""

import csv
import io
import re
import unicodedata
from datetime import datetime

from scheduling.connectors import normalize_phone

HEADERS = [
    "Código",
    "Nome",
    "Telefone",
    "Município",
    "Especialidade",
    "Cid",
    "Tipo Consulta",
    "Profissional",
    "Idade do Paciente",
    "Mês/Ano Pretendido",
    "Turno",
    "Data Agenda",
    "Horário",
    "Data Entrada",
    "Status",
    "Filipeta",
    "Ret. Filipeta",
    "Prioridade",
    "Aceita Teleconsulta",
    "Observação",
    "Observação Status",
    "Alteração Especialidade/Exame - De",
    "Para",
    "Observação",
    "Usuário",
    "Data de alteração",
    "Alteração CID - De",
    "Para",
    "Observação",
    "Usuário",
    "Data de alteração",
]
PHONE = re.compile(r"\(\d{2}\)\s*\d{8,9}(?!\d)")


def header_key(value):
    return unicodedata.normalize("NFC", value.strip().lstrip("\ufeff")).casefold()


def phone_numbers(value):
    text = re.sub(r"\(\s*\)", "", value)
    tokens = PHONE.findall(text)
    if not tokens or PHONE.sub("", text).strip(" \t\r\n;,/|"):
        raise ValueError("invalid_phone_format")
    return tokens, list(dict.fromkeys(normalize_phone(token) for token in tokens))


def parse_demand(content):
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("cp1252")
    reader = csv.reader(io.StringIO(text), delimiter=";", strict=True)
    header = next(reader)
    if [header_key(c) for c in header] != [header_key(c) for c in HEADERS]:
        raise ValueError("invalid_header")
    rows = []
    for cells in reader:
        if len(rows) >= 10000:
            raise ValueError("row_limit")
        if len(cells) != len(HEADERS):
            raise ValueError("invalid_layout")
        cells = [value.strip() for value in cells]
        row = {
            "external_id": cells[0],
            "patient": cells[1],
            "phone": cells[2],
            "city": cells[3],
            "procedure": cells[4],
            "consultation_type": cells[6],
            "professional": cells[7],
            "requested_month": cells[9],
            "shift": cells[10],
            "source_status": cells[14],
            "priority": cells[17],
            "accepts_teleconsultation": cells[18],
            "source_observation": cells[19],
            "source_status_observation": cells[20],
            "source_entered_at": cells[13],
            "source_appointment_date": cells[11],
            "source_appointment_time": cells[12],
        }
        try:
            row["raw_phone_numbers"], row["phone_numbers"] = phone_numbers(cells[2])
            row["phone"] = row["phone_numbers"][0]
            row["occurred_at"] = datetime.strptime(
                cells[13], "%Y-%m-%d %H:%M:%S"
            ).isoformat()
        except ValueError:
            row["occurred_at"] = ""
            row["_error"] = "invalid_date_or_phone"
        rows.append(row)
    if not rows:
        raise ValueError("empty_file")
    return rows
