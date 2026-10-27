"""Stable intermediary contract for imported CROSS spreadsheets."""

import csv
import io
import re
from datetime import datetime

from rest_framework.exceptions import ValidationError

from scheduling.connectors import normalize_phone

STANDARD_FIELDS = (
    "nome_completo",
    "data",
    "hora",
    "celular",
    "celular2",
    "tipo",
    "horario_chegada",
    "data_nascimento",
    "codigo",
    "local",
    "tipo2",
    "obs",
)
ALIASES = {
    "patient": "nome_completo",
    "date": "data",
    "arrival_time": "horario_chegada",
    "phone": "celular",
    "procedure": "tipo",
    "external_id": "codigo",
    "city": "local",
    "source_observation": "obs",
    "appointment_type": "tipo2",
}
DEFAULT_MAPPINGS = {
    "cross_demand_csv": dict(
        zip(
            STANDARD_FIELDS,
            [
                "Nome",
                "Data Agenda",
                "Horário",
                "Telefone 1",
                "Telefone 2",
                "Especialidade",
                "",
                "",
                "Código",
                "Município",
                "Tipo Consulta",
                "Observação",
            ],
        )
    ),
    "absence_html": dict(
        zip(
            STANDARD_FIELDS,
            [
                "Paciente",
                "Data",
                "Horario",
                "Telefone 1",
                "Telefone 2",
                "Exame",
                "",
                "",
                "Codigo",
                "Executante",
                "",
                "Observacao",
            ],
        )
    ),
    "table": {field: field for field in STANDARD_FIELDS},
}


def validate_mapping(mapping):
    if not isinstance(mapping, dict) or any(
        key not in STANDARD_FIELDS or not isinstance(value, str) or len(value) > 200
        for key, value in mapping.items()
    ):
        raise ValidationError(
            "Mapeamento deve usar somente os 12 campos padronizados e nomes de coluna."
        )
    return {field: mapping.get(field, "").strip() for field in STANDARD_FIELDS}


def template_bindings(template, requested=None):
    if not isinstance(template.fields, list) or any(
        not isinstance(field, str) for field in template.fields
    ):
        raise ValidationError("Campos do template devem ser uma lista de nomes.")
    positions = {int(p) for p in re.findall(r"{{\s*(\d+)\s*}}", template.body)}
    count = max(positions) if positions else len(template.fields)
    if count > 30 or (positions and positions != set(range(1, count + 1))):
        raise ValidationError(
            "Parâmetros do template precisam ser sequenciais a partir de 1."
        )
    if requested is None:
        requested = [
            field if field in STANDARD_FIELDS else ALIASES.get(field, "")
            for field in template.fields
        ]
        if len(requested) != count or any(not field for field in requested):
            raise ValidationError(
                "Mapeie cada parâmetro do template para um campo padronizado."
            )
    if (
        not isinstance(requested, list)
        or len(requested) != count
        or any(field not in STANDARD_FIELDS for field in requested)
    ):
        raise ValidationError(
            "Cada parâmetro do template deve apontar para um dos 12 campos padronizados."
        )
    return requested


def standard_date(value):
    if not value:
        return ""
    value = str(value).strip()
    for fmt in ["%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"]:
        try:
            return datetime.strptime(value, fmt).strftime("%d/%m/%Y")
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(value).strftime("%d/%m/%Y")
    except ValueError:
        raise ValueError("invalid_standard_date") from None


def standard_time(value):
    if not value:
        return ""
    value = str(value).strip()
    for fmt in ["%H:%M", "%H:%M:%S"]:
        try:
            return datetime.strptime(value, fmt).strftime("%H:%M")
        except ValueError:
            pass
    raise ValueError("invalid_standard_time")


def standard_row(raw, row, mapping, layout_format):
    available = {
        str(key): str(value if value is not None else "").strip()
        for key, value in raw.items()
        if not isinstance(value, (dict, list))
    }
    numbers = row.get("phone_numbers", [row.get("phone", "")])
    if layout_format == "cross_demand_csv":
        available.update(
            {
                "Nome": row["patient"],
                "Código": row["external_id"],
                "Especialidade": row.get("procedure", ""),
                "Município": row.get("city", ""),
                "Data Agenda": row.get("source_appointment_date", ""),
                "Horário": row.get("source_appointment_time", ""),
                "Tipo Consulta": row.get("consultation_type", ""),
                "Observação": row.get("source_observation", ""),
                "Data Entrada": row.get("source_entered_at", ""),
                "Status": row.get("source_status", ""),
                "Prioridade": row.get("priority", ""),
                "Observação Status": row.get("source_status_observation", ""),
            }
        )
    elif layout_format == "absence_html":
        stamp = datetime.fromisoformat(row["occurred_at"])
        available.update(
            {
                "Paciente": row["patient"],
                "Codigo": row.get("patient_external_id", ""),
                "Data": stamp.strftime("%d/%m/%Y"),
                "Horario": stamp.strftime("%H:%M"),
                "Exame": row.get("procedure", ""),
                "Executante": row.get("executante", ""),
                "Observacao": row.get("source_observation", ""),
            }
        )
    available.update({f"Telefone {i + 1}": phone for i, phone in enumerate(numbers)})
    result = {
        field: available.get(mapping.get(field, ""), "") for field in STANDARD_FIELDS
    }
    for field in ["data", "data_nascimento"]:
        result[field] = standard_date(result[field])
    for field in ["hora", "horario_chegada"]:
        result[field] = standard_time(result[field])
    for field in ["celular", "celular2"]:
        if result[field]:
            result[field] = normalize_phone(result[field])
    return result


def unique_headers(headers):
    seen = {}
    result = []
    for value in headers:
        value = str(value if value is not None else "").strip()
        seen[value] = seen.get(value, 0) + 1
        result.append(value if seen[value] == 1 else f"{value}#{seen[value]}")
    return result


def csv_standard_rows(rows):
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";")
    writer.writerow(STANDARD_FIELDS)
    for row in rows:
        standard = row.get("standardized", {})
        values = []
        for field in STANDARD_FIELDS:
            value = str(standard.get(field, ""))
            if value.startswith(("\t", "\r", "\n")) or value.lstrip().startswith(
                ("=", "+", "-", "@")
            ):
                value = "'" + value
            values.append(value)
        writer.writerow(values)
    return "\ufeff" + out.getvalue()


def display_rows(batch):
    """Project legacy previews into the standard view without rewriting stored rows."""
    projected = []
    for original in batch.rows:
        row = dict(original)
        if not isinstance(row.get("standardized"), dict):
            mapping = (
                batch.configuration.get("standard_mapping")
                or DEFAULT_MAPPINGS[batch.layout.format]
            )
            try:
                standard = standard_row(row, row, mapping, batch.layout.format)
            except ValueError:
                standard = {field: "" for field in STANDARD_FIELDS}
            if batch.layout.format == "table":
                numbers = row.get("phone_numbers") or [row.get("phone", "")]
                fallback = {
                    "nome_completo": row.get("patient", ""),
                    "celular": numbers[0] if numbers else "",
                    "celular2": numbers[1] if len(numbers) > 1 else "",
                    "codigo": row.get("external_id", ""),
                    "tipo": row.get("procedure", ""),
                    "local": row.get("city", ""),
                    "obs": row.get("source_observation", ""),
                }
                standard = {
                    field: standard.get(field) or fallback.get(field, "")
                    for field in STANDARD_FIELDS
                }
            row.update(standard)
            row["standardized"] = standard
        projected.append(row)
    return projected
