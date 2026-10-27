"""Manual, read-only absence extraction into the existing CROSS pipeline."""

import json
import re
from datetime import datetime, time, timedelta

from django.db import transaction
from rest_framework.exceptions import ValidationError

from core.oracle_credentials import connect, connection_payload
from operations.sheets import confirm_sheet, preview_sheet
from operations.standardization import DEFAULT_MAPPINGS
from scheduling.connectors import normalize_phone

ITEM_TYPES = {
    "I": ("exam", "Imagem / Exames"),
    "A": ("consultation", "Consulta"),
    "L": ("lab", "Laboratório"),
}
ITEM_SELECTIONS = {"ALL": ("mixed", "Todos"), **ITEM_TYPES}

SQL = """
SELECT a.CD_PACIENTE, a.CD_IT_AGENDA_CENTRAL,
       NVL(a.NM_PACIENTE, p.NM_PACIENTE) NM_PACIENTE,
       ia.TP_ITEM, a.CD_ATENDIMENTO, ac.DT_AGENDA, a.HR_AGENDA,
       ia.DS_ITEM_AGENDAMENTO, ac.DS_CONSULTORIO,
       NVL(a.DT_NASCIMENTO, p.DT_NASCIMENTO) DT_NASCIMENTO,
       a.NR_CELULAR A_CELULAR, a.NR_DDD_CELULAR A_DDD_CELULAR,
       a.NR_FONE A_FONE, a.NR_DDD_FONE A_DDD_FONE,
       p.NR_CELULAR P_CELULAR, p.NR_DDD_CELULAR P_DDD_CELULAR,
       p.NR_FONE P_FONE, p.NR_DDD_FONE P_DDD_FONE
FROM DBAMV.IT_AGENDA_CENTRAL a
JOIN DBAMV.AGENDA_CENTRAL ac ON ac.CD_AGENDA_CENTRAL = a.CD_AGENDA_CENTRAL
JOIN DBAMV.ITEM_AGENDAMENTO ia ON ia.CD_ITEM_AGENDAMENTO = a.CD_ITEM_AGENDAMENTO
LEFT JOIN DBAMV.PACIENTE p ON p.CD_PACIENTE = a.CD_PACIENTE
WHERE a.CD_ATENDIMENTO IS NULL
  AND a.CD_PACIENTE IS NOT NULL
  AND ac.DT_AGENDA >= :start_day AND ac.DT_AGENDA < :end_day
  AND (ia.TP_ITEM = :item_type
       OR (:item_type = 'ALL' AND ia.TP_ITEM IN ('A', 'I', 'L')))
ORDER BY a.CD_IT_AGENDA_CENTRAL
"""


def text(value):
    return str(value).strip() if value is not None else ""


def mapped_row(raw):
    phones = []
    invalid_contacts = 0
    for prefix in ("A_CELULAR", "A_FONE", "P_CELULAR", "P_FONE"):
        value = re.sub(r"\D", "", text(raw.get(prefix)))
        if not value:
            continue
        ddd = re.sub(r"\D", "", text(raw.get(prefix.replace("_", "_DDD_", 1))))
        if len(value) in (8, 9) and len(ddd) == 2:
            value = ddd + value
        try:
            phone = normalize_phone(value)
        except ValueError:
            invalid_contacts += 1
            continue
        if phone not in phones:
            phones.append(phone)
    day = raw["DT_AGENDA"]
    hour = raw.get("HR_AGENDA")
    occurred = datetime.combine(day.date(), hour.time() if hour else time.min)
    kind, label = ITEM_TYPES[raw["TP_ITEM"]]
    birth = raw.get("DT_NASCIMENTO")
    return {
        "external_id": "oracle:" + text(raw["CD_IT_AGENDA_CENTRAL"]),
        "patient_external_id": text(raw["CD_PACIENTE"]),
        "patient": text(raw["NM_PACIENTE"]),
        "phone": phones[0] if phones else "",
        "phone_numbers": phones,
        "occurred_at": occurred.isoformat(),
        "procedure": text(raw["DS_ITEM_AGENDAMENTO"]),
        "executante": text(raw["DS_CONSULTORIO"]),
        "source_reason": "",
        "source_observation": "",
        "source_origin": "oracle_absences",
        "source_status": "no_linked_attendance",
        "source_appointment_id": text(raw["CD_IT_AGENDA_CENTRAL"]),
        "tp_item": raw["TP_ITEM"],
        "appointment_kind": kind,
        "Tipo atendimento": label,
        "Nascimento": birth.strftime("%d/%m/%Y") if birth else "",
        "invalid_contact_count": invalid_contacts,
        "_error": "invalid_phone_format" if not phones else "",
    }


def fetch_absences(unit, absence_date, item_type):
    if item_type not in ITEM_SELECTIONS:
        raise ValidationError("Tipo de atendimento inválido.")
    try:
        payload = connection_payload(unit)
        if not payload:
            raise ValueError("oracle_not_configured")
        payload = {
            **payload,
            "timeout_ms": min(payload.get("timeout_ms", 10000), 15000),
        }
        start = datetime.combine(absence_date, time.min)
        with connect(payload) as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.arraysize = 200
                    cursor.execute("SET TRANSACTION READ ONLY")
                    cursor.execute(
                        SQL,
                        start_day=start,
                        end_day=start + timedelta(days=1),
                        item_type=item_type,
                    )
                    names = [column[0] for column in cursor.description]
                    data = cursor.fetchmany(10001)
                    if len(data) > 10000:
                        raise ValidationError(
                            "Consulta excede 10.000 registros; revise a seleção."
                        )
                    return [mapped_row(dict(zip(names, row))) for row in data]
            finally:
                connection.rollback()
    except ValidationError:
        raise
    except Exception:
        # Driver errors can include connection details. Do not return/log their text.
        raise ValidationError(
            "Não foi possível consultar o Oracle da unidade. Verifique a conexão e as permissões de leitura."
        ) from None


@transaction.atomic
def generate_absences(unit, actor, layout, absence_date, item_type, template_id=None):
    if (
        layout.unit_id != unit.pk
        or layout.format != "absence_html"
        or not layout.verified
    ):
        raise ValidationError("Selecione um modelo de ausentes validado nesta unidade.")
    rows = fetch_absences(unit, absence_date, item_type)
    mapping = {
        **DEFAULT_MAPPINGS["absence_html"],
        "tipo2": "Tipo atendimento",
        "data_nascimento": "Nascimento",
        **layout.standard_mapping,
    }
    batch = preview_sheet(
        unit,
        layout,
        actor,
        f"Oracle · Ausentes {absence_date:%d-%m-%Y} · {ITEM_SELECTIONS[item_type][1]}",
        json.dumps(rows, sort_keys=True, ensure_ascii=False).encode(),
        template_id=template_id,
        standard_mapping=mapping,
        source_rows=rows,
        source_metadata={
            "origin": "oracle_absences",
            "absence_date": absence_date.isoformat(),
            "item_type": item_type,
            "appointment_kind": ITEM_SELECTIONS[item_type][0],
            "selection": "no_linked_attendance",
            "query_version": 2,
        },
    )
    # Materialize appointments, but never queue notifications here.
    if not batch.errors and batch.state == "preview":
        confirm_sheet(batch, "absence")
        batch.refresh_from_db()
    return batch
