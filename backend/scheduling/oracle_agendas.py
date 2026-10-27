"""Rolling Oracle appointment window. Read-only source; notifications stay preview."""

import re
from dataclasses import replace
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from core.models import Audit
from messaging.models import Message
from scheduling.connectors import (
    AppointmentData,
    OracleSource,
    consolidate_rows,
    normalize_phone,
)
from scheduling.models import OracleAgenda, OracleAgendaDay
from scheduling.services import queue_appointment, upsert_appointment

DEFAULT_COLUMNS = {
    "external_id": "CD_AGENDA",
    "patient_external_id": "CD_PACIENTE",
    "patient": "PACIENTE",
    "date": "DTA_AGENDA",
    "time": "HORA_MARCADA",
    "arrival_time": "HORA_CHEGADA",
    "procedure": "ESPECIALIDADE",
    "appointment_type": "TIPO_CONSULTA",
    "professional": "MEDICO",
    "phone_columns": ["CELULAR"],
}
IDENTIFIER = re.compile(r"[A-Z][A-Z0-9_]{0,127}")
VIEW = re.compile(r"[A-Z][A-Z0-9_]{0,127}\.[A-Z][A-Z0-9_]{0,127}")


def safe_view(value):
    if not isinstance(value, str) or not VIEW.fullmatch(value):
        raise ValueError("invalid_view")
    return value


def describe(unit, view):
    safe_view(view)
    with OracleSource(unit).connect() as connection:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
                cursor.execute(f"SELECT * FROM {view} WHERE 1=0")
                columns = [
                    {
                        "name": d[0],
                        "type": str(d[1]).replace("<DbType ", "").rstrip(">"),
                    }
                    for d in cursor.description
                ]
                if len(columns) > 150:
                    raise ValueError("source_column_limit")
                return columns
        finally:
            connection.rollback()


def template_keys(template):
    """This first Oracle release supports body params and static text/quick replies."""
    if template.get("status") != "APPROVED" or template.get("language") != "pt_BR":
        raise ValueError("template_not_approved")
    keys = []
    for component in template.get("components", []):
        kind = component.get("type")
        if kind == "BODY":
            body = component.get("text", "")
            if "INATIVO" in body.upper() or template.get("name") == "hello_world":
                raise ValueError("template_inactive")
            keys = list(dict.fromkeys(re.findall(r"{{\s*([^{} ]+)\s*}}", body)))
        elif (
            kind == "FOOTER"
            or (
                kind == "HEADER"
                and component.get("format") == "TEXT"
                and "{{" not in component.get("text", "")
            )
            or kind == "BUTTONS"
            and all(
                b.get("type") == "QUICK_REPLY" for b in component.get("buttons", [])
            )
        ):
            continue
        else:
            raise ValueError("template_component_not_supported")
    if not any(
        c.get("type") == "BODY" and c.get("text")
        for c in template.get("components", [])
    ):
        raise ValueError("template_body_required")
    if len(keys) > 30:
        raise ValueError("template_parameter_limit")
    return sorted(keys, key=int) if keys and all(k.isdigit() for k in keys) else keys


def format_value(value, kind):
    value = str(value or "").strip()
    if not value:
        return ""
    if kind == "text":
        return value
    if kind == "date":
        try:
            return datetime.fromisoformat(value).strftime("%d/%m/%Y")
        except ValueError:
            return datetime.strptime(value, "%d/%m/%Y").strftime("%d/%m/%Y")
    if kind == "time":
        if "T" in value or re.match(r"\d{4}-\d{2}-\d{2} ", value):
            return datetime.fromisoformat(value).strftime("%H:%M")
        return time.fromisoformat(value).strftime("%H:%M")
    raise ValueError("invalid_parameter_format")


def scalar(value):
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return str(value).strip()


def phones(value):
    raw = str(value or "").strip()
    if not raw:
        return []
    # One formatted number or explicit separators; never merge several numbers.
    values = re.split(r"\s*(?:;|,|\||\r?\n| / )\s*", raw)
    result = []
    for part in values:
        if not part:
            continue
        try:
            result.append(normalize_phone(part))
        except ValueError:
            result.append(part)
    return sorted(set(result))


def source_date(value, date_format="native"):
    text = scalar(value)
    if date_format == "br_date":
        return datetime.strptime(text, "%d/%m/%Y").date()
    if date_format == "iso_date":
        return datetime.strptime(text, "%Y-%m-%d").date()
    if date_format != "native":
        raise ValueError("invalid_source_date_format")
    return datetime.fromisoformat(text).date()


def fetch_day(agenda, day):
    view = safe_view(agenda.view_name)
    columns = agenda.column_mapping
    date_column = columns["date"]
    requested = {v for v in columns.values() if isinstance(v, str) and v}
    requested.update(columns["phone_columns"])
    requested.update(v["column"] for v in agenda.parameter_mapping.values())
    if not all(IDENTIFIER.fullmatch(v) for v in requested):
        raise ValueError("invalid_source_column")
    available = {c["name"] for c in agenda.columns}
    if not requested <= available:
        raise ValueError("source_column_missing")
    names = sorted(requested)
    with OracleSource(agenda.unit).connect() as connection:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
                if agenda.date_format in {"br_date", "iso_date"}:
                    # VARCHAR dates from hospital views: no implicit Oracle NLS conversion.
                    fmt = "%d/%m/%Y" if agenda.date_format == "br_date" else "%Y-%m-%d"
                    cursor.execute(
                        f"SELECT {', '.join(names)} FROM {view} WHERE {date_column} = :source_day",
                        source_day=day.strftime(fmt),
                    )
                elif agenda.date_format == "native":
                    cursor.execute(
                        f"SELECT {', '.join(names)} FROM {view} WHERE {date_column} >= :start_day AND {date_column} < :end_day",
                        start_day=datetime.combine(day, time.min),
                        end_day=datetime.combine(day + timedelta(days=1), time.min),
                    )
                else:
                    raise ValueError("invalid_source_date_format")
                rows = cursor.fetchmany(10001)
                if len(rows) > 10000:
                    raise ValueError("source_row_limit")
                return [dict(zip(names, row)) for row in rows]
        finally:
            connection.rollback()


def normalized_rows(agenda, day, rows):
    m = agenda.column_mapping
    result = []
    for raw in rows:
        value = {k: scalar(v) for k, v in raw.items()}
        field = lambda name, value=value: value.get(m.get(name), "")
        event_date = source_date(field("date"), agenda.date_format)
        if event_date != day:
            raise ValueError("source_contract_mismatch")
        hour = format_value(field("time"), "time")
        if agenda.kind == "postprocedure" and not m.get("time"):
            hour = "00:00"
        if not field("external_id") or not field("patient") or not hour:
            raise ValueError("source_required_value_missing")
        contacts = sorted(
            {
                phone
                for column in m["phone_columns"]
                for phone in phones(value.get(column))
            }
        )
        # Phone-only row differences must not duplicate or conflict an appointment.
        stable = {k: v for k, v in value.items() if k not in m["phone_columns"]}
        result.append(
            AppointmentData(
                external_id=field("external_id"),
                kind=agenda.kind,
                patient=field("patient"),
                phone=contacts[0] if contacts else "",
                phone_numbers=tuple(contacts),
                patient_external_id=field("patient_external_id"),
                professional=field("professional"),
                procedure=field("procedure"),
                appointment_type=field("appointment_type"),
                scheduled_at=datetime.combine(
                    day, time.fromisoformat(hour), ZoneInfo(agenda.unit.timezone)
                ),
                arrival_time=field("arrival_time") or hour,
                source=f"oracle-agenda:{agenda.pk}",
                synthetic=False,
                source_values=tuple(sorted(stable.items())),
            )
        )
    merged = consolidate_rows(result)
    for index, item in enumerate(merged):
        matching = [
            raw for raw in rows if scalar(raw.get(m["external_id"])) == item.external_id
        ]
        contacts = {
            column: "; ".join(
                sorted({scalar(raw.get(column)) for raw in matching if raw.get(column)})
            )
            for column in m["phone_columns"]
        }
        merged[index] = replace(
            item,
            source_values=tuple(
                sorted({**dict(item.source_values), **contacts}.items())
            ),
        )
    return merged


def safe_error(exc):
    code = getattr(exc.args[0], "full_code", "") if exc.args else ""
    if re.fullmatch(r"(?:ORA|DPI|DPY)-\d+", str(code)):
        return str(code)
    allowed = {
        "oracle_locked",
        "oracle_not_configured",
        "source_row_limit",
        "source_column_missing",
        "invalid_view",
        "invalid_source_column",
        "source_contract_mismatch",
        "source_required_value_missing",
        "configuration_changed",
        "invalid_parameter_format",
        "invalid_source_date_format",
    }
    return str(exc) if str(exc) in allowed else "oracle_agenda_failed"


def window_dates(agenda, now):
    today = timezone.localtime(now, ZoneInfo(agenda.unit.timezone)).date()
    if agenda.kind == "postprocedure":
        return [today - timedelta(days=i) for i in reversed(range(agenda.horizon_days))]
    return [today + timedelta(days=i) for i in range(1, agenda.horizon_days + 1)]


def planned_send(agenda, appointment_day):
    """Move only reminders whose original send day is blocked, in unit time."""
    original = (
        appointment_day + timedelta(days=agenda.days_after)
        if getattr(agenda, "kind", "consultation") == "postprocedure"
        else appointment_day - timedelta(days=agenda.days_before)
    )
    allowed = set(agenda.send_weekdays)
    if not allowed or not allowed <= set(range(7)):
        raise ValueError("invalid_send_calendar")
    adjusted = original
    if original.weekday() not in allowed:
        direction = agenda.blocked_day_policy.get(str(original.weekday()), "previous")
        if direction not in {"previous", "next"}:
            raise ValueError("invalid_send_calendar")
        step = -1 if direction == "previous" else 1
        for offset in range(1, 7):
            candidate = original + timedelta(days=step * offset)
            if candidate.weekday() in allowed:
                adjusted = candidate
                break
    tz = ZoneInfo(agenda.unit.timezone)
    return (
        datetime.combine(original, agenda.send_time, tz),
        datetime.combine(adjusted, agenda.send_time, tz),
    )


def sync_agenda(agenda_id, now=None, fetcher=None, refresh=False):
    now = now or timezone.now()
    fetcher = fetcher or fetch_day
    with transaction.atomic():
        agenda = (
            OracleAgenda.objects.select_for_update()
            .select_related("unit", "rule__template")
            .get(pk=agenda_id)
        )
        if agenda.deleted_at:
            return
        if (
            agenda.last_state == "running"
            and agenda.last_started_at
            and agenda.last_started_at > now - timedelta(minutes=15)
        ):
            return
        agenda.last_state, agenda.last_error, agenda.last_started_at = (
            "running",
            "",
            now,
        )
        agenda.save(update_fields=["last_state", "last_error", "last_started_at"])
        version = agenda.version
    try:
        from messaging.models import MetaConfiguration

        meta = MetaConfiguration.objects.filter(
            unit=agenda.unit, validation_state="valid"
        ).first()
        if agenda.template_id and (
            not meta
            or meta.waba_id != agenda.template_snapshot.get("waba_id")
            or meta.phone_number_id != agenda.template_snapshot.get("phone_number_id")
        ):
            raise ValueError("configuration_changed")
        current_template = next(
            (
                t
                for t in (meta.templates if meta else [])
                if t.get("id") == agenda.template_id
            ),
            None,
        )
        if agenda.template_id and (
            not current_template
            or current_template.get("status") != "APPROVED"
            or current_template.get("components")
            != agenda.template_snapshot.get("components")
        ):
            raise ValueError("configuration_changed")
        completed = set(
            agenda.days.filter(version=version).values_list("date", flat=True)
        )
        for day in window_dates(agenda, now):
            if day in completed and not refresh:
                continue
            rows = fetcher(agenda, day)
            normalized = normalized_rows(agenda, day, rows)
            with transaction.atomic():
                current = OracleAgenda.objects.select_for_update().get(pk=agenda_id)
                if current.deleted_at or current.version != version:
                    raise ValueError("configuration_changed")
                rule = agenda.rule
                original_send, scheduled = planned_send(agenda, day)
                for data in normalized:
                    appointment = upsert_appointment(agenda.unit, data)
                    if not agenda.template_id:
                        continue  # Source-only draft: no notification or message is created.
                    queue_appointment(appointment, rule, scheduled, now)
                    for message in Message.objects.filter(
                        appointment=appointment,
                        rule=rule,
                        rule_version=rule.version,
                        appointment_revision=appointment.revision,
                    ):
                        message.snapshot = {
                            **message.snapshot,
                            "oracle_agenda": agenda.pk,
                            "oracle_agenda_version": version,
                            "send_calendar": {
                                "weekdays": agenda.send_weekdays,
                                "blocked_day_policy": agenda.blocked_day_policy,
                                "original_send_at": original_send.isoformat(),
                                "adjusted_send_at": scheduled.isoformat(),
                                "effective_send_at": message.scheduled_for.isoformat(),
                            },
                            "source_view": agenda.view_name,
                            "reference_date": "performed"
                            if agenda.kind == "postprocedure"
                            else "scheduled",
                            "days_after": agenda.days_after
                            if agenda.kind == "postprocedure"
                            else None,
                            "date_format": agenda.date_format,
                            "column_mapping": agenda.column_mapping,
                            "parameter_mapping": agenda.parameter_mapping,
                            "meta_template_id": agenda.template_id,
                            "meta_waba_id": agenda.template_snapshot.get("waba_id"),
                            "meta_phone_number_id": agenda.template_snapshot.get(
                                "phone_number_id"
                            ),
                        }
                        message.save(update_fields=["snapshot"])
                        if (
                            (
                                (
                                    agenda.kind != "postprocedure"
                                    and message.scheduled_for
                                    >= appointment.scheduled_at
                                )
                                or (
                                    agenda.kind == "postprocedure"
                                    and message.scheduled_for
                                    <= appointment.scheduled_at
                                )
                            )
                            and message.state in {"preview", "blocked", "expired"}
                            and not message.attempt_count
                        ):
                            calendar_error = (
                                "send_calendar_before_procedure"
                                if agenda.kind == "postprocedure"
                                else "send_calendar_after_appointment"
                            )
                            message.state, message.error_code = (
                                "blocked",
                                calendar_error,
                            )
                            message.save(update_fields=["state", "error_code"])
                            from messaging.services import issue_once

                            issue_once(
                                message,
                                calendar_error,
                                "O ajuste de dia programou o envio antes do procedimento. Revise o calendário de envios."
                                if agenda.kind == "postprocedure"
                                else "O ajuste de dia programou o lembrete para depois do horário do atendimento. Revise o calendário de envios.",
                            )
                current.last_started_at = timezone.now()
                current.save(update_fields=["last_started_at"])
                OracleAgendaDay.objects.update_or_create(
                    agenda=agenda,
                    version=version,
                    date=day,
                    defaults={
                        "row_count": len(rows),
                        "appointment_count": len(normalized),
                    },
                )
        state, error = "completed", ""
    except Exception as exc:
        state, error = "failed", safe_error(exc)
    OracleAgenda.objects.filter(pk=agenda_id, version=version).update(
        last_state=state, last_error=error, last_completed_at=timezone.now()
    )
    Audit.objects.create(
        unit=agenda.unit,
        action="oracle_agenda." + state,
        object_id=str(agenda_id),
        details={"version": version, "error": error},
    )
