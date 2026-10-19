import hashlib
import json
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from core.models import Unit
from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from messaging.models import Message, ProviderEvent
from messaging.services import issue_once

from responses.models import Reply

RANK = {"accepted": 1, "sent": 2, "delivered": 3, "read": 4}


def classify(text):
    from operations.services import contextual_classify

    return contextual_classify(text)


def event_time(value):
    try:
        result = datetime.fromtimestamp(int(value), dt_timezone.utc)
    except (ValueError, TypeError, OverflowError, OSError):
        raise ValueError("invalid_event_timestamp") from None
    if result > timezone.now() + timedelta(minutes=5):
        raise ValueError("future_event_timestamp")
    return result


def store_event(channel, provider_id, event_type, timestamp, data):
    raw_key = [channel, provider_id, event_type] + ([] if event_type == "reply" else [str(timestamp)])
    key = hashlib.sha256(json.dumps(raw_key).encode()).hexdigest()
    return ProviderEvent.objects.get_or_create(
        key=key,
        defaults={
            "channel_id": channel,
            "provider_id": provider_id,
            "event_type": event_type,
            "occurred_at": event_time(timestamp),
            "data": data,
        },
    )[0]


@transaction.atomic
def apply_status(event):
    event = ProviderEvent.objects.select_for_update().get(pk=event.pk)
    if event.processed:
        return
    message = (
        Message.objects.select_for_update()
        .filter(provider_id=event.provider_id, channel_id=event.channel_id)
        .first()
    )
    if not message:
        return  # Reconcile after the send commits if the webhook won the race.
    state = event.event_type
    if event.data.get("display_phone_number") and not message.snapshot.get("sender_phone"):
        message.snapshot = {**message.snapshot, "sender_phone": str(event.data["display_phone_number"])[:40]}
    if state in RANK and RANK[state] > RANK.get(message.state, 0):
        message.state = state
    elif state == "failed" and message.state not in {"delivered", "read"}:
        message.state = "failed"
        message.error_code = "meta_" + str(event.data.get("code", "delivery_failed"))
        issue_once(
            message,
            message.error_code,
            "Falha de entrega informada pelo provedor; não comprova telefone inválido.",
        )
    if state in {"delivered", "read"}:
        if message.delivered_at is None or event.occurred_at < message.delivered_at:
            message.delivered_at = event.occurred_at
    message.save()
    if (
        message.delivered_at
        and message.case_id
        and message.appointment_revision == message.case.event.revision
    ):
        from operations.models import Case, PurposePolicy

        policy = PurposePolicy.objects.filter(
            unit=message.unit, purpose=message.purpose, enabled=True
        ).first()
        deadline = message.delivered_at + timedelta(
            hours=policy.response_hours if policy else message.unit.response_hours
        )
        from django.db.models import Q

        Case.objects.filter(pk=message.case_id, response_state="pending").filter(
            Q(due_at__isnull=True) | Q(due_at__gt=deadline)
        ).update(due_at=deadline)
    from operations.models import ReportRequest

    ReportRequest.objects.filter(notification=message).update(delivery_state=message.state)
    event.processed = True
    event.save(update_fields=["processed"])


def reconcile_statuses(message):
    for event in (
        ProviderEvent.objects.filter(
            provider_id=message.provider_id, channel_id=message.channel_id, processed=False
        )
        .exclude(event_type="reply")
        .order_by("occurred_at")
    ):
        apply_status(event)


@transaction.atomic
def apply_reply(event, unit):
    event = ProviderEvent.objects.select_for_update().get(pk=event.pk)
    if event.processed:
        return
    from operations.inbound import request_report

    if request_report(event, unit):
        return
    data = event.data
    sender, text, context_id = data["sender"], data["text"], data.get("context_id")
    candidates = Message.objects.filter(
        unit=unit,
        recipient=sender,
        channel_id=event.channel_id,
        state__in=["accepted", "sent", "delivered", "read"],
    ).select_related("case__event")
    if context_id:
        # An unknown explicit context must not silently fall back to a different appointment.
        message = candidates.filter(provider_id=context_id).first()
    else:
        from django.db.models import Q

        candidates = candidates.filter(
            Q(case__isnull=True) | Q(appointment_revision=F("case__event__revision"))
        )
        candidates = candidates.filter(
            response_state__in=["pending", "no_response", "review"],
            created_at__gte=event.occurred_at - timedelta(days=30),
        )
        candidates = candidates.exclude(case__state="closed")
        choices, seen = [], set()
        for candidate in candidates.order_by("-created_at"):
            identity = candidate.case_id or candidate.pk
            if identity not in seen:
                seen.add(identity)
                choices.append(candidate)
            if len(choices) == 2:
                break
        message = choices[0] if len(choices) == 1 else None
    from operations.services import apply_outcome, contextual_classify

    classification = contextual_classify(
        text,
        message.purpose if message else "appointment",
        data.get("button_id", ""),
        data.get("content_type", "text"),
        response_policy=(
            message.snapshot.get("response_policy", "contextual")
            if message and message.template_name == "confirmacao_consulta_sqlite_v1"
            else "contextual"
        ),
    )
    reply = Reply.objects.create(
        unit=unit, event=event, message=message, sender=sender, text=text, classification=classification
    )
    if message and data.get("display_phone_number") and not message.snapshot.get("sender_phone"):
        message.snapshot = {**message.snapshot, "sender_phone": str(data["display_phone_number"])[:40]}
        message.save(update_fields=["snapshot", "updated_at"])
    if message and message.case_id:
        from operations.models import Case

        case = Case.objects.select_for_update().get(pk=message.case_id)
        if message.appointment_revision == case.event.revision:
            apply_outcome(
                case, classification, channel="whatsapp", occurred_at=event.occurred_at, reply_id=reply.pk
            )
            if data.get("flow_observation"):
                from operations.services import log

                log(
                    case,
                    "observation",
                    data["flow_observation"],
                    channel="whatsapp",
                    occurred_at=event.occurred_at,
                    data={"reply_id": reply.pk, "sender": sender, "sender_name": data.get("sender_name", "")},
                )
        else:
            from operations.services import log

            log(
                case,
                "stale_reply",
                "Resposta recebida para uma versão anterior; requer revisão da equipe.",
                channel="whatsapp",
                data={"reply_id": reply.pk, "revision": message.appointment_revision},
            )
            issue_once(message, "stale_reply", "Resposta vinculada à revisão anterior da origem.")
    if message is None:
        from responses.models import Issue

        Issue.objects.create(
            unit=unit,
            reply=reply,
            category="unlinked_reply",
            description="Resposta sem vínculo único. Selecione o lembrete antes de classificá-la.",
        )
    elif classification == "review":
        issue_once(message, "reply_review", "Resposta livre requer revisão da equipe.")
        if not Reply.objects.filter(message=message, event__occurred_at__gt=event.occurred_at).exists():
            message.response_state = "review"
            message.save(update_fields=["response_state", "updated_at"])
    else:
        # Keep every reply in history; only the latest event changes the current response.
        newer = Reply.objects.filter(message=message, event__occurred_at__gt=event.occurred_at).exists()
        if not newer:
            message.response_state = classification
            message.save(update_fields=["response_state", "updated_at"])
            from responses.models import Issue

            Issue.objects.filter(message=message, category="no_response", resolved_at__isnull=True).update(
                resolved_at=timezone.now(), resolution="Resposta recebida após o prazo."
            )
    event.processed = True
    event.save(update_fields=["processed"])


def ingest_webhook(payload, unit=None, channel_id=None, waba_id=None):
    if payload.get("object") != "whatsapp_business_account":
        raise ValueError("invalid_webhook_object")
    unit = unit or Unit.objects.get(slug=settings.META_UNIT_SLUG)
    expected_channel = channel_id or settings.META_PHONE_NUMBER_ID
    for entry in payload.get("entry", []):
        if waba_id and str(entry.get("id", "")) != waba_id:
            continue
        for change in entry.get("changes", []):
            value = change.get("value", {})
            channel = str(value.get("metadata", {}).get("phone_number_id", ""))
            if channel != expected_channel or not channel:
                continue
            for status in value.get("statuses", []):
                errors = status.get("errors") or [{}]
                event = store_event(
                    channel,
                    status["id"],
                    status["status"],
                    status["timestamp"],
                    {
                        "code": errors[0].get("code", ""),
                        "display_phone_number": value.get("metadata", {}).get("display_phone_number", ""),
                    },
                )
                apply_status(event)
            for msg in value.get("messages", []):
                flow_data = {}
                context_id = msg.get("context", {}).get("id")
                flow_button_id = ""
                text = msg.get("text", {}).get("body", "")
                if msg.get("type") == "button":
                    text = msg.get("button", {}).get("text", "")
                if msg.get("type") == "interactive":
                    button = msg.get("interactive", {}).get("button_reply", {})
                    text = button.get("title", "")
                    if msg.get("interactive", {}).get("type") == "nfm_reply":
                        from responses.flows import parse_flow_reply

                        text, context_id, flow_button_id, flow_data = parse_flow_reply(msg, unit, channel)
                if not text:
                    text = "[Conteúdo não textual]"
                event = store_event(
                    channel,
                    msg["id"],
                    "reply",
                    msg["timestamp"],
                    {
                        "sender": msg["from"],
                        "sender_name": next(
                            (
                                str(c.get("profile", {}).get("name", ""))[:200]
                                for c in value.get("contacts", [])
                                if c.get("wa_id") == msg["from"]
                            ),
                            "",
                        ),
                        "display_phone_number": value.get("metadata", {}).get("display_phone_number", ""),
                        "text": text[:8000],
                        "context_id": context_id,
                        "content_type": msg.get("type", "text"),
                        "button_id": flow_button_id
                        or msg.get("button", {}).get("payload", "")
                        or msg.get("interactive", {}).get("button_reply", {}).get("id", ""),
                        "media_id": (msg.get(msg.get("type", "")) or {}).get("id")
                        if isinstance(msg.get(msg.get("type", "")), dict)
                        else None,
                        **flow_data,
                    },
                )
                apply_reply(event, unit)


def mark_no_response(now=None):
    now = now or timezone.now()
    count = 0
    for unit in Unit.objects.all():
        messages = Message.objects.filter(
            unit=unit,
            response_state="pending",
            state__in=["delivered", "read"],
            delivered_at__isnull=False,
        )
        for message in messages:
            if message.case_id and message.appointment_revision != message.case.event.revision:
                continue
            from operations.models import PurposePolicy

            policy = PurposePolicy.objects.filter(unit=unit, purpose=message.purpose).first()
            hours = policy.response_hours if policy and policy.enabled else unit.response_hours
            if message.delivered_at > now - timedelta(hours=hours):
                continue
            if (
                message.purpose == "appointment"
                and message.appointment_id
                and message.appointment.scheduled_at <= now
            ):
                continue
            with transaction.atomic():
                current = Message.objects.select_for_update().get(pk=message.pk)
                if current.response_state != "pending":
                    continue
                current.response_state = "no_response"
                current.save(update_fields=["response_state", "updated_at"])
                if current.case_id:
                    from operations.models import Case

                    Case.objects.filter(pk=current.case_id, response_state="pending").update(
                        response_state="no_response", version=F("version") + 1
                    )
                count += 1
    return count
