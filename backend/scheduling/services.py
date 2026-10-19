import re
from dataclasses import asdict
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from core.models import Audit
from messaging.models import Message, Notification
from responses.models import Issue
from scheduling.connectors import normalize_phone
from scheduling.models import Appointment, ImportRun, Rule

PENDING = [Message.State.PREVIEW, Message.State.QUEUED, Message.State.BLOCKED]


def render_template(template, appointment):
    available = {
        "patient": appointment.patient,
        "appointment_type": appointment.appointment_type,
        "procedure": appointment.procedure,
        "date": timezone.localtime(
            appointment.scheduled_at, ZoneInfo(appointment.unit.timezone)
        ).strftime("%d/%m/%Y"),
        "arrival_time": appointment.arrival_time,
    }
    if "preparation" in template.fields:
        from operations.models import Preparation

        preparation = (
            Preparation.objects.filter(
                unit=appointment.unit,
                procedure_code=appointment.procedure_code,
                active=True,
            ).first()
            if appointment.procedure_code
            else None
        )
        available["preparation"] = preparation.text if preparation else ""

    def field_value(field):
        if field.startswith("oracle:"):
            from scheduling.oracle_agendas import format_value

            _, column, kind = field.split(":")
            return format_value(appointment.source_values.get(column, ""), kind)
        return available[field]

    parameters = [field_value(field) for field in template.fields]
    if any(not value.strip() for value in parameters):
        raise ValueError("missing_template_parameter")
    body = template.body
    keys = list(dict.fromkeys(re.findall(r"{{\s*([^{} ]+)\s*}}", body)))
    if len(keys) != len(parameters):
        raise ValueError("missing_template_parameter")
    if keys and all(key.isdigit() for key in keys):
        keys.sort(key=int)
    lookup = dict(zip(keys, parameters))
    body = re.sub(r"{{\s*([^{} ]+)\s*}}", lambda match: lookup[match[1]], body)
    return parameters, body


@transaction.atomic
def queue_appointment(appointment, rule, scheduled_for, now=None):
    from operations.services import ensure_appointment_case

    case = ensure_appointment_case(appointment)
    now = now or timezone.now()
    from messaging.models import AppointmentGroup

    group, _ = AppointmentGroup.objects.get_or_create(
        unit=appointment.unit,
        kind=appointment.kind,
        appointment_date=appointment.scheduled_at.astimezone(
            ZoneInfo(appointment.unit.timezone)
        ).date(),
        rule=rule,
        rule_version=rule.version,
        defaults={"scheduled_for": scheduled_for},
    )
    if group.schedule_overridden:
        scheduled_for = group.scheduled_for
    local_day = scheduled_for.astimezone(ZoneInfo(rule.unit.timezone)).date()
    end_of_day = datetime.combine(
        local_day + timedelta(days=1), time.min, ZoneInfo(rule.unit.timezone)
    )
    expiry = min(
        end_of_day,
        scheduled_for + timedelta(hours=rule.validity_hours),
        appointment.scheduled_at,
    )
    # Bindings belong to the origin, even when it shares a Meta template.
    if hasattr(rule, "oracle_agenda"):
        from copy import copy

        from scheduling.oracle_agendas import template_keys

        agenda = rule.oracle_agenda
        template = copy(rule.template)
        template.version = agenda.version
        remote = agenda.template_snapshot
        template.body = next(
            c["text"] for c in remote["components"] if c["type"] == "BODY"
        )
        template.name = remote["name"]
        template.language = remote["language"]
        template.components = remote["components"]
        template.fields = [
            "oracle:"
            + agenda.parameter_mapping[k]["column"]
            + ":"
            + agenda.parameter_mapping[k]["format"]
            for k in template_keys(remote)
        ]
        rule.template = template
    try:
        params, body = render_template(rule.template, appointment)
        parameter_error = ""
    except (ValueError, KeyError):
        params, body, parameter_error = [], "", "missing_template_parameter"
    notification, _ = Notification.objects.get_or_create(
        key=f"appointment:{appointment.pk}:{rule.pk}:{rule.version}:{appointment.revision}",
        defaults={
            "unit": appointment.unit,
            "appointment": appointment,
            "revision": appointment.revision,
        },
    )
    messages = []
    for phone in appointment.phone_numbers or [appointment.phone]:
        try:
            recipient, phone_error = normalize_phone(phone), ""
        except ValueError:
            recipient, phone_error = phone, "invalid_phone_format"
        messages.append(
            _queue_recipient(
                appointment,
                rule,
                scheduled_for,
                now,
                case,
                notification,
                recipient,
                phone_error,
                parameter_error,
                params,
                body,
                expiry,
            )
        )
    for message in messages:
        if message.group_id is None:
            message.group = group
            message.save(update_fields=["group"])
    return messages[0]


def _queue_recipient(
    appointment,
    rule,
    scheduled_for,
    now,
    case,
    notification,
    recipient,
    phone_error,
    parameter_error,
    params,
    body,
    expiry,
):
    error = appointment.data_issue or phone_error or parameter_error
    state = Message.State.QUEUED if appointment.synthetic else Message.State.PREVIEW
    if error:
        state = Message.State.BLOCKED
    if now >= expiry:
        state = Message.State.EXPIRED
    message, created = Message.objects.get_or_create(
        appointment=appointment,
        rule=rule,
        rule_version=rule.version,
        appointment_revision=appointment.revision,
        recipient=recipient,
        defaults={
            "notification": notification,
            "unit": appointment.unit,
            "case": case,
            "purpose": "appointment",
            "snapshot": {
                "rule": rule.code,
                "version": rule.version,
                "days_before": rule.days_before,
                "response_condition": rule.response_condition,
                "validity_hours": rule.validity_hours,
                "fields": rule.template.fields,
                "components": rule.template.components,
                "template_version": rule.template.version,
                "preparation_code": appointment.procedure_code,
            },
            "template": rule.template,
            "template_name": rule.template.name,
            "template_language": rule.template.language,
            "parameters": params,
            "body": body,
            "scheduled_for": scheduled_for,
            "expires_at": expiry,
            "state": state,
            "error_code": error,
        },
    )
    if created and error:
        Issue.objects.create(
            unit=appointment.unit,
            case=case,
            contact_phone=recipient,
            message=message,
            category=error,
            description={
                "ambiguous_contact": "Mais de um contato para o mesmo agendamento; número não escolhido automaticamente.",
                "ambiguous_source_record": "Dados conflitantes para o mesmo agendamento na origem.",
            }.get(
                error,
                "Formato de telefone inválido."
                if phone_error
                else "Parâmetros incompletos no template.",
            ),
        )
    return message


@transaction.atomic
def upsert_appointment(unit, data):
    values = asdict(data)
    values["source_values"] = dict(values.get("source_values", ()))
    values["phone_numbers"] = contact_numbers(
        values.get("phone_numbers"), values["phone"]
    )
    values["phone"] = values["phone_numbers"][0] if values["phone_numbers"] else ""
    key = {
        "unit": unit,
        "source": values.pop("source"),
        "kind": values.pop("kind"),
        "external_id": values.pop("external_id"),
    }
    appointment, created = Appointment.objects.select_for_update().get_or_create(
        **key, defaults=values
    )
    if not created:
        # Real data can never promote an existing real appointment to synthetic through this connector.
        values["synthetic"] = appointment.synthetic and values["synthetic"]
        changed = any(
            getattr(appointment, field) != value for field, value in values.items()
        )
        if changed:
            for field, value in values.items():
                setattr(appointment, field, value)
            appointment.revision += 1
            appointment.save()
            Message.objects.filter(appointment=appointment, state__in=PENDING).update(
                state=Message.State.CANCELLED
            )
            Issue.objects.filter(
                message__appointment=appointment,
                message__state=Message.State.CANCELLED,
                resolved_at__isnull=True,
            ).update(
                resolved_at=timezone.now(),
                resolution="Lembrete invalidado por alteração dos dados de origem.",
            )
            Audit.objects.create(
                unit=unit,
                action="appointment.changed",
                object_id=str(appointment.pk),
                details={"revision": appointment.revision},
            )
        else:
            appointment.save(update_fields=["last_seen_at"])
    from operations.services import ensure_appointment_case

    ensure_appointment_case(appointment)
    return appointment


def contact_numbers(numbers, primary=""):
    result = set()
    for raw in [*(numbers or []), primary]:
        if not raw:
            continue
        try:
            result.add(normalize_phone(raw))
        except ValueError:
            result.add(str(raw).strip())
    return sorted(result)


def import_rule(rule, source, now=None, retry=False, refresh=False):
    if hasattr(rule, "oracle_agenda"):
        return None
    now = now or timezone.now()
    local = now.astimezone(ZoneInfo(rule.unit.timezone))
    if not rule.enabled or local.weekday() not in rule.weekdays:
        return None
    scheduled_for = datetime.combine(
        local.date(), rule.send_time, ZoneInfo(rule.unit.timezone)
    )
    if now < scheduled_for:
        return None
    with transaction.atomic():
        run, created = ImportRun.objects.select_for_update().get_or_create(
            rule=rule, run_date=local.date(), defaults={"unit": rule.unit}
        )
        if not created:
            if run.status == "running":
                return run
            elapsed = run.completed_at is None or now >= run.completed_at + timedelta(
                minutes=rule.refresh_interval_minutes
            )
            if run.status == "completed" and not (refresh and elapsed):
                return run
            if run.status == "failed" and (not retry or (refresh and not elapsed)):
                return run
            run.status = "running"
            run.error = ""
            run.started_at = now
            run.save()
    try:
        target = local.date() + timedelta(days=rule.days_before)
        rows = source.fetch(rule.kind, target, rule.unit.timezone)
        with transaction.atomic():
            current = Rule.objects.select_for_update().get(pk=rule.pk)
            if not current.enabled or current.version != rule.version:
                raise ValueError("rule_changed_during_import")
            for data in rows:
                if (
                    data.kind != rule.kind
                    or data.scheduled_at.astimezone(ZoneInfo(rule.unit.timezone)).date()
                    != target
                ):
                    raise ValueError("source_contract_mismatch")
                appointment = upsert_appointment(rule.unit, data)
                queue_appointment(appointment, rule, scheduled_for, now)
            run.status, run.imported = "completed", len(rows)
            run.completed_at = now
            run.save()
    except Exception as exc:  # noqa: BLE001 - sanitize connector error codes
        # Do not persist SQL, patient data or credential-bearing exception messages.
        oracle_code = getattr(exc.args[0], "full_code", "") if exc.args else ""
        safe_code = (
            oracle_code
            if re.fullmatch(r"(?:ORA|DPI|DPY)-\d+", str(oracle_code))
            else type(exc).__name__
        )
        run.status, run.error, run.completed_at = "failed", safe_code, now
        run.save(update_fields=["status", "error", "completed_at"])
    return run
