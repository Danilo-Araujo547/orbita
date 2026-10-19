"""Explicit, unit-scoped real transport for synthetic appointments and listed numbers."""

import re
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

from messaging.models import Attempt, MetaConfiguration, Template

# Contract inspected in the published Flow's flow.json (screen CONFIRMACAO).
CONFIRMATION_FLOW_ID = "1113114081215929"
CONFIRMATION_TEMPLATE_V2 = "confirmacao_consulta_orbita_v2"


def initial_flow_data(message, remote):
    data = {}
    for component in remote["components"]:
        if component.get("type") == "BUTTONS":
            for index, button in enumerate(component.get("buttons", [])):
                if button.get("type") == "FLOW" and (
                    str(button.get("flow_id")) == CONFIRMATION_FLOW_ID
                    or remote.get("name") == CONFIRMATION_TEMPLATE_V2
                ):
                    data[str(index)] = {
                        "medico": (
                            message.appointment.professional
                            if message.appointment_id
                            else message.case.event.data.get("professional")
                        )
                        or "Não informado",
                        "exame": message.appointment.procedure
                        if message.appointment_id
                        else message.case.event.data.get("procedure", ""),
                        "error_message": "",
                    }
    return data


def authorized_recipients(unit):
    return (
        tuple(unit.authorized_recipients)
        if unit.authorized_recipients is not None
        else settings.TEST_RECIPIENTS
    )


def enabled(unit):
    return bool(
        settings.SEND_MODE == "meta_test"
        and settings.META_REAL_ENABLED
        and unit.slug == settings.META_UNIT_SLUG
        and authorized_recipients(unit)
    )


def configuration(unit):
    config = MetaConfiguration.objects.filter(unit=unit).first()
    if not enabled(unit) or not config or config.validation_state != "valid":
        raise ValueError("meta_not_validated")
    if not config.checked_at or config.checked_at < timezone.now() - timedelta(hours=24):
        raise ValueError("meta_validation_expired")
    return config


def catalog_template(config, name=None):
    remote = next(
        (
            t
            for t in config.templates
            if t.get("name") == (name or settings.META_PILOT_TEMPLATE)
            and t.get("language") == "pt_BR"
            and t.get("status") == "APPROVED"
        ),
        None,
    )
    if not remote:
        raise ValueError("pilot_template_not_approved")
    # This pilot supports static text plus Flow/quick-reply buttons only.
    body = next((c.get("text", "") for c in remote["components"] if c.get("type") == "BODY"), "")
    if not body or re.search(r"\{\{", body):
        raise ValueError("pilot_template_mapping_required")
    for component in remote["components"]:
        kind = component.get("type")
        if kind in {"BODY", "FOOTER"}:
            continue
        if kind == "HEADER" and component.get("format") == "TEXT" and "{{" not in component.get("text", ""):
            continue
        if kind == "BUTTONS" and all(
            b.get("type") in {"FLOW", "QUICK_REPLY"} for b in component.get("buttons", [])
        ):
            continue
        raise ValueError("pilot_template_mapping_required")
    return remote, body


def prepare(message, template_name=None):
    config = configuration(message.unit)
    remote, body = catalog_template(config, template_name)
    template, _ = Template.objects.get_or_create(
        unit=message.unit,
        name=remote["name"],
        language=remote["language"],
        defaults={
            "body": body,
            "fields": [],
            "components": remote["components"],
            "purpose": "appointment",
            "approved_for_test": True,
        },
    )
    if (
        template.body != body
        or template.fields
        or template.components != remote["components"]
        or template.purpose != "appointment"
    ):
        raise ValueError("pilot_template_mapping_required")
    message.snapshot = {
        **message.snapshot,
        "template_version": template.version,
        "fields": [],
        "components": remote["components"],
        "meta_config_version": config.version,
        "meta_phone_number_id": config.phone_number_id,
        "meta_template_id": remote["id"],
        "sender_phone": config.display_phone_number,
        "flow_action_data": initial_flow_data(message, remote),
    }
    message.template = template
    message.template_name, message.template_language = template.name, template.language
    message.body, message.parameters = body, []


def guard(message):
    if not enabled(message.unit):
        return "meta_sending_disabled"
    if message.snapshot.get("manual_campaign_real"):
        return campaign_guard(message)
    if not message.snapshot.get("manual_group_real"):
        return "group_release_required"
    if not message.group_id or not message.appointment_id or message.purpose != "appointment":
        return "pilot_appointment_required"
    if message.unit.paused:
        return "paused"
    if message.recipient not in authorized_recipients(message.unit):
        return "recipient_not_allowed"
    try:
        config = configuration(message.unit)
        remote, body = catalog_template(config)
    except ValueError as error:
        return str(error)
    if (
        message.snapshot.get("meta_config_version") != config.version
        or message.snapshot.get("meta_phone_number_id") != config.phone_number_id
    ):
        return "meta_configuration_changed"
    if (
        message.template_name != remote["name"]
        or message.template_language != remote["language"]
        or message.snapshot.get("meta_template_id") != remote["id"]
        or message.body != body
        or message.parameters
        or message.snapshot.get("components") != remote["components"]
    ):
        return "pilot_template_changed"
    if initial_flow_data(message, remote) != message.snapshot.get("flow_action_data", {}):
        return "flow_initial_data_missing"
    start = datetime.combine(
        timezone.now().astimezone(ZoneInfo(message.unit.timezone)).date(),
        time.min,
        ZoneInfo(message.unit.timezone),
    )
    attempts = Attempt.objects.filter(message__unit=message.unit, started_at__gte=start)
    if message.state == "sending":
        attempts = attempts.exclude(message=message, number=message.attempt_count)
    if attempts.count() >= settings.META_PILOT_DAILY_LIMIT:
        return "pilot_daily_limit"
    return ""


def campaign_guard(message):
    from operations.models import Campaign, Contact

    campaign = Campaign.objects.filter(pk=message.snapshot.get("campaign"), unit=message.unit).first()
    if not campaign or not campaign.sends_enabled:
        return "campaign_sending_disabled"
    if message.unit.paused:
        return "paused"
    if (
        campaign.purpose != "absence"
        or campaign.response_policy != "confirmation_test"
        or not message.case_id
        or message.purpose != "absence"
        or message.case.unit_id != message.unit_id
        or message.case.purpose != campaign.purpose
        or not campaign.cases.filter(pk=message.case_id).exists()
        or message.snapshot.get("response_policy") != "confirmation_test"
    ):
        return "campaign_not_authorized"
    if not Contact.objects.filter(
        unit=message.unit, event=message.case.event, phone=message.recipient
    ).exists():
        return "recipient_not_allowed"
    try:
        config = configuration(message.unit)
        remote, body = catalog_template(config, "confirmacao_consulta_sqlite_v1")
    except ValueError as error:
        return str(error)
    if (
        message.snapshot.get("meta_config_version") != config.version
        or message.snapshot.get("meta_phone_number_id") != config.phone_number_id
    ):
        return "meta_configuration_changed"
    if (
        message.template_name != remote["name"]
        or message.template_language != remote["language"]
        or message.body != body
        or message.parameters
        or message.snapshot.get("meta_template_id") != remote["id"]
        or message.snapshot.get("components") != remote["components"]
        or initial_flow_data(message, remote) != message.snapshot.get("flow_action_data", {})
    ):
        return "pilot_template_changed"
    start = datetime.combine(
        timezone.localdate(timezone=ZoneInfo(message.unit.timezone)),
        time.min,
        ZoneInfo(message.unit.timezone),
    )
    attempts = Attempt.objects.filter(message__unit=message.unit, started_at__gte=start)
    if message.state == "sending":
        attempts = attempts.exclude(message=message, number=message.attempt_count)
    return "pilot_daily_limit" if attempts.count() >= settings.META_PILOT_DAILY_LIMIT else ""
