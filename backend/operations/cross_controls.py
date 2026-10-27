"""Import-level queue controls. No transport calls are made by these actions."""

from collections import defaultdict
from datetime import timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.models import Audit, Unit
from messaging.models import Message
from operations.models import Campaign, ImportLayout, SheetImport
from operations.services import Conflict, preview_campaign
from operations.sheets import confirm_sheet
from operations.standardization import display_rows

PENDING = {"preview", "queued", "blocked", "cancelled", "expired"}
SENT = {"accepted", "sent", "delivered", "read"}


def category(batch):
    # A layout revision must not reset the category's history.
    return batch.layout.name.strip().casefold()


def record_identity(row):
    patient_id = str(row.get("patient_external_id") or "").strip()
    if patient_id:
        return ("patient", patient_id)
    # CROSS demand has a waiting-list record code, not a verified patient ID.
    # Never infer a patient identity from a shared phone or a name.
    return ("record", str(row.get("external_id") or "").strip())


def recent_history(unit):
    cutoff = timezone.now() - timedelta(days=30)
    history = defaultdict(list)
    messages = list(
        Message.objects.filter(
            unit=unit, state__in=SENT, provider_id__startswith="wamid."
        )
        .filter(Q(last_attempt_at__gt=cutoff) | Q(delivered_at__gt=cutoff))
        .select_related("case__event")
    )
    batch_ids = set()
    for message in messages:
        try:
            batch_ids.add(str(UUID(str(message.snapshot.get("import_batch")))))
        except (ValueError, TypeError):
            continue
    batches = {
        str(b.pk): b
        for b in SheetImport.objects.filter(unit=unit, pk__in=batch_ids).select_related(
            "layout"
        )
    }
    layouts = {
        str(layout.pk): layout for layout in ImportLayout.objects.filter(unit=unit)
    }
    for message in messages:
        if not message.case_id:
            continue
        origin = batches.get(str(message.snapshot.get("import_batch")))
        name = category(origin) if origin else ""
        if not origin:
            # Older imports did not have a campaign->batch link. Their event source
            # still identifies the layout without matching patient names or phones.
            prefix, _, layout_id = message.case.event.source.partition(":")
            layout = layouts.get(layout_id) if prefix in {"absence", "cross"} else None
            if not layout:
                continue
            name = layout.name.strip().casefold()
        stamp = message.last_attempt_at or message.delivered_at
        if not stamp or stamp <= cutoff:
            continue
        history[
            (
                name,
                message.purpose,
                record_identity(message.case.event.data),
            )
        ].append(stamp)
    return history


def batch_rows(batch, history=None):
    history = recent_history(batch.unit) if history is None else history
    campaign = getattr(batch, "campaign", None)
    purpose = (
        campaign.purpose
        if campaign
        else (batch.template.purpose if batch.template_id else "")
    )
    disabled = set(batch.disabled_records)
    result = []
    for row in display_rows(batch):
        record = str(row["external_id"])
        previous = history.get((category(batch), purpose, record_identity(row)), [])
        result.append(
            {
                **row,
                "record_id": record,
                "enabled": record not in disabled,
                "recent_send_count": len(previous),
                "last_sent_at": max(previous).isoformat() if previous else None,
                "history_match_basis": "patient_code"
                if record_identity(row)[0] == "patient"
                else "record_code",
            }
        )
    return result


def batch_status(batch, counts=None):
    campaign = getattr(batch, "campaign", None)
    if counts is None:
        messages = Message.objects.filter(
            unit=batch.unit, snapshot__import_batch=str(batch.pk)
        )
        counts = dict(
            messages.values("state")
            .annotate(total=Count("pk"))
            .values_list("state", "total")
        )
    return {
        "enabled": bool(campaign and campaign.sends_enabled),
        "scheduled_for": campaign.scheduled_for if campaign else None,
        "enabled_count": sum(
            str(row["external_id"]) not in batch.disabled_records for row in batch.rows
        ),
        "disabled_count": sum(
            str(row["external_id"]) in batch.disabled_records for row in batch.rows
        ),
        "message_counts": counts,
        "unit_paused": batch.unit.paused,
    }


def _messages(batch):
    return Message.objects.filter(unit=batch.unit, snapshot__import_batch=str(batch.pk))


def _queue(batch, campaign, scheduled_for, only_records=None):
    old_state = campaign.state
    campaign.state = "draft"
    campaign.scheduled_for = scheduled_for
    campaign.save(update_fields=["state", "scheduled_for"])
    ids = preview_campaign(campaign)
    eligible = []
    for message in Message.objects.filter(pk__in=ids).select_related("case__event"):
        record = str(message.case.event.external_id)
        if only_records is not None and record not in only_records:
            continue
        if record in batch.disabled_records:
            if message.attempt_count == 0 and message.state in PENDING:
                message.state, message.error_code = "cancelled", "cross_record_disabled"
                message.save(update_fields=["state", "error_code"])
            continue
        if message.attempt_count or message.state not in PENDING:
            continue
        message.snapshot = {**message.snapshot, "cross_batch": str(batch.pk)}
        message.state = "queued"
        message.error_code = ""
        message.scheduled_for = scheduled_for
        message.expires_at = scheduled_for + timedelta(days=1)
        message.save()
        eligible.append(message.pk)
    campaign.state = "released" if eligible or old_state == "released" else "preview"
    if only_records is None:
        campaign.next_send_at = None
    campaign.save(update_fields=["state", "next_send_at"])
    return len(eligible)


def _lock(batch, version):
    Unit.objects.select_for_update(no_key=True).get(pk=batch.unit_id)
    batch = (
        SheetImport.objects.select_for_update(of=("self",))
        .select_related("unit", "layout", "template")
        .get(pk=batch.pk)
    )
    if batch.version != version:
        raise Conflict()
    return batch


def _audit(batch, actor, action, details):
    batch.version += 1
    batch.save(update_fields=["version", "disabled_records"])
    Audit.objects.create(
        unit=batch.unit,
        actor=actor,
        action=action,
        object_id=str(batch.pk),
        details=details,
    )
    return batch


@transaction.atomic
def set_batch_enabled(batch, enabled, version, actor, now=None):
    batch = _lock(batch, version)
    now = now or timezone.now()
    campaign = getattr(batch, "campaign", None)
    if bool(campaign and campaign.sends_enabled) == enabled:
        return batch
    if enabled:
        if not batch.template_id or batch.errors:
            raise ValidationError(
                "Configure um template e corrija os erros antes de ativar."
            )
        if not any(
            str(row["external_id"]) not in batch.disabled_records for row in batch.rows
        ):
            raise ValidationError("Ative pelo menos um registro da importação.")
        if batch.state == "preview":
            confirm_sheet(batch, batch.template.purpose)
            batch.refresh_from_db()
        campaign = Campaign.objects.select_for_update().get(
            import_batch=batch, unit=batch.unit
        )
        _queue(batch, campaign, now + timedelta(minutes=30))
        campaign.sends_enabled = True
    elif campaign:
        campaign.sends_enabled = False
        # Keep accepted/failed/uncertain and in-flight attempts as historical facts.
        _messages(batch).filter(
            Q(state__in=PENDING, attempt_count=0) | Q(state="queued")
        ).update(state="cancelled", error_code="cross_import_disabled")
    if campaign:
        campaign.version += 1
        campaign.save(update_fields=["sends_enabled", "version"])
    return _audit(
        batch,
        actor,
        "cross.import_enabled" if enabled else "cross.import_disabled",
        {
            "enabled": enabled,
            "scheduled_for": campaign.scheduled_for.isoformat()
            if campaign and campaign.scheduled_for
            else None,
        },
    )


@transaction.atomic
def set_records_enabled(batch, records, enabled, version, actor, now=None):
    batch = _lock(batch, version)
    known = {str(row["external_id"]) for row in batch.rows}
    selected = set(records)
    if not selected or not selected <= known:
        raise ValidationError("Selecione registros pertencentes à importação.")
    disabled = set(batch.disabled_records)
    updated = disabled - selected if enabled else disabled | selected
    if updated == disabled:
        return batch
    batch.disabled_records = sorted(updated)
    batch.save(update_fields=["disabled_records"])
    campaign = getattr(batch, "campaign", None)
    if not enabled:
        _messages(batch).filter(case__event__external_id__in=selected).filter(
            Q(state__in=PENDING, attempt_count=0) | Q(state="queued")
        ).update(state="cancelled", error_code="cross_record_disabled")
    elif campaign and campaign.sends_enabled:
        scheduled = max(
            campaign.scheduled_for or timezone.now(),
            (now or timezone.now()) + timedelta(minutes=30),
        )
        original_schedule = campaign.scheduled_for
        _queue(batch, campaign, scheduled, only_records=selected)
        campaign.scheduled_for = original_schedule
        campaign.save(update_fields=["scheduled_for"])
    return _audit(
        batch,
        actor,
        "cross.records_enabled" if enabled else "cross.records_disabled",
        {"enabled": enabled, "records": sorted(selected)},
    )


def queue_guard(message):
    batch = SheetImport.objects.filter(
        pk=message.snapshot.get("cross_batch"), unit=message.unit
    ).first()
    if not batch or not message.case_id:
        return "cross_import_disabled"
    campaign = getattr(batch, "campaign", None)
    if not campaign or not campaign.sends_enabled:
        return "cross_import_disabled"
    if not campaign.cases.filter(pk=message.case_id, unit=message.unit).exists():
        return "cross_record_not_in_import"
    if str(message.case.event.external_id) in batch.disabled_records:
        return "cross_record_disabled"
    if (
        message.template_id != batch.template_id
        or message.template.version
        != batch.configuration.get("template", {}).get("version")
    ):
        return "cross_template_changed"
    return ""


def transport_guard(message):
    """Use the configured test channel, allowlist and approved Meta catalog unchanged."""
    from messaging.models import Attempt
    from messaging.pilot import authorized_recipients, configuration

    try:
        config = configuration(message.unit)
    except ValueError as error:
        return str(error)
    if message.recipient not in authorized_recipients(message.unit):
        return "recipient_not_allowed"
    frozen = message.snapshot.get("components", [])
    remote = next(
        (
            t
            for t in config.templates
            if t.get("name") == message.template_name
            and t.get("language") == message.template_language
            and t.get("status") == "APPROVED"
        ),
        None,
    )
    if not remote or remote.get("components", []) != frozen:
        return "cross_template_not_validated"
    remote_body = next(
        (part.get("text", "") for part in frozen if part.get("type") == "BODY"), ""
    )
    if remote_body != message.template.body:
        return "cross_template_not_validated"
    rendered = remote_body
    for index, value in enumerate(message.parameters, 1):
        rendered = rendered.replace("{{" + str(index) + "}}", str(value))
    if rendered != message.body:
        return "cross_template_parameters_invalid"
    from operations.standardization import template_bindings

    try:
        fields = template_bindings(message.template, message.snapshot.get("fields", []))
    except ValidationError:
        return "cross_template_parameters_invalid"
    if len(message.parameters) != len(fields) or any(
        not str(value).strip() for value in message.parameters
    ):
        return "cross_template_parameters_invalid"
    # Header/media/dynamic URL mapping is outside this body-parameter contract.
    for component in frozen:
        kind = component.get("type")
        if kind == "HEADER" and (
            component.get("format") != "TEXT" or "{{" in component.get("text", "")
        ):
            return "cross_template_component_not_supported"
        if kind == "BUTTONS" and any(
            button.get("type") not in {"QUICK_REPLY", "PHONE_NUMBER", "URL"}
            or "{{" in button.get("url", "")
            for button in component.get("buttons", [])
        ):
            return "cross_template_component_not_supported"
    start = timezone.localtime(
        timezone.now(), timezone=ZoneInfo(message.unit.timezone)
    ).replace(hour=0, minute=0, second=0, microsecond=0)
    from django.conf import settings

    attempts = Attempt.objects.filter(message__unit=message.unit, started_at__gte=start)
    if message.state == "sending":
        attempts = attempts.exclude(message=message, number=message.attempt_count)
    if attempts.count() >= settings.META_PILOT_DAILY_LIMIT:
        return "pilot_daily_limit"
    return ""


def filtered_records(batch, search="", recent_only=False, enabled=None):
    rows = batch_rows(batch)
    search = search.strip().casefold()
    if search:
        rows = [
            row
            for row in rows
            if any(
                search in str(row.get(key, "")).casefold()
                for key in [
                    "nome_completo",
                    "patient",
                    "codigo",
                    "record_id",
                    "phone_numbers",
                ]
            )
        ]
    if recent_only:
        rows = [row for row in rows if row["recent_send_count"]]
    if enabled is not None:
        rows = [row for row in rows if row["enabled"] == enabled]
    return rows
