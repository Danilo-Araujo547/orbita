import csv
import hashlib
import io
import zipfile
from datetime import datetime
from xml.etree.ElementTree import ParseError
from zoneinfo import ZoneInfo

from django.db import transaction
from rest_framework.exceptions import ValidationError
from scheduling.connectors import normalize_phone

from operations.models import Case, Contact, SheetImport, SourceEvent
from operations.services import log

REQUIRED = {"external_id", "patient", "phone", "occurred_at"}


def preview_sheet(unit, layout, actor, filename, content):
    if layout.unit_id != unit.id or not layout.verified:
        raise ValidationError("Layout não validado para esta unidade.")
    if len(content) > 5 * 1024 * 1024:
        raise ValidationError("Arquivo excede 5 MB.")
    if not REQUIRED.issubset(layout.mapping):
        raise ValidationError("Layout precisa mapear identificador, paciente, telefone e data.")
    digest = hashlib.sha256(content).hexdigest()
    existing = SheetImport.objects.filter(unit=unit, layout=layout, digest=digest).first()
    if existing:
        return existing
    try:
        if filename.lower().endswith(".csv"):
            text = content.decode("utf-8-sig")
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
            source = csv.DictReader(io.StringIO(text), dialect=dialect)
        elif filename.lower().endswith(".xlsx"):
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if sum(f.file_size for f in archive.infolist()) > 30 * 1024 * 1024:
                    raise ValueError("expanded_file_too_large")
            from openpyxl import load_workbook

            workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            iterator = workbook.active.iter_rows(values_only=True)
            headers = [str(v or "").strip() for v in next(iterator)]
            source = (dict(zip(headers, values)) for values in iterator)
        else:
            raise ValueError("unsupported_file")
        rows, errors, seen, duplicates = [], [], {}, 0
        for number, raw in enumerate(source, 2):
            if number > 10001:
                raise ValueError("row_limit")
            row = {field: str(raw.get(column) or "").strip() for field, column in layout.mapping.items()}
            try:
                if any(not row.get(field) for field in REQUIRED):
                    raise ValueError("missing_fields")
                if len(row["external_id"]) > 200 or len(row["patient"]) > 200:
                    raise ValueError("field_too_long")
                row["phone"] = normalize_phone(row["phone"])
                day = datetime.fromisoformat(row["occurred_at"])
                if day.tzinfo is None:
                    day = day.replace(tzinfo=ZoneInfo(unit.timezone))
                row["occurred_at"] = day.isoformat()
                key = row["external_id"]
                if key in seen:
                    if seen[key] != row:
                        raise ValueError("conflicting_identifier")
                    duplicates += 1
                    continue
                seen[key] = row
                rows.append(row)
            except ValueError as exc:
                errors.append(
                    {
                        "line": number,
                        "code": str(exc)
                        if str(exc)
                        in {
                            "missing_fields",
                            "field_too_long",
                            "conflicting_identifier",
                            "invalid_phone_format",
                        }
                        else "invalid_date",
                    }
                )
        if not rows:
            errors.append({"line": 0, "code": "empty_file"})
    except (
        ValueError,
        UnicodeError,
        StopIteration,
        csv.Error,
        OSError,
        KeyError,
        zipfile.BadZipFile,
        ParseError,
        EOFError,
    ):
        raise ValidationError("Arquivo inválido; use CSV UTF-8 ou XLSX com o layout aprovado.") from None
    finally:
        if "workbook" in locals():
            workbook.close()
    return SheetImport.objects.create(
        unit=unit,
        layout=layout,
        digest=digest,
        rows=rows,
        errors=errors,
        duplicates=duplicates,
        created_by=actor,
    )


@transaction.atomic
def confirm_sheet(batch, purpose):
    batch = SheetImport.objects.select_for_update().get(pk=batch.pk)
    if purpose not in {"waitlist", "summons"} or batch.errors or batch.state != "preview":
        raise ValidationError("Importação precisa estar em prévia, sem erros, para CDR.")
    if not batch.layout.verified:
        raise ValidationError("Layout deixou de estar validado.")
    cases = []
    for row in batch.rows:
        event, created = SourceEvent.objects.get_or_create(
            unit=batch.unit,
            source=f"cross:{batch.layout_id}",
            kind="waitlist",
            external_id=row["external_id"],
            defaults={
                "patient": row["patient"],
                "phone": row["phone"],
                "occurred_at": datetime.fromisoformat(row["occurred_at"]),
                "data": row,
                "synthetic": False,
            },
        )
        if not created and (event.patient != row["patient"] or event.phone != row["phone"]):
            raise ValidationError(
                "Identificador já existente com contato ou paciente diferente; revisão necessária."
            )
        case, new = Case.objects.get_or_create(unit=batch.unit, event=event, purpose=purpose)
        if new:
            log(
                case,
                "imported",
                "Caso criado por importação CROSS.",
                data={"batch": str(batch.pk), "layout_version": batch.layout.version},
            )
        Contact.objects.get_or_create(unit=batch.unit, event=event, phone=event.phone)
        cases.append(str(case.pk))
    batch.state = "confirmed"
    batch.save(update_fields=["state"])
    return cases
