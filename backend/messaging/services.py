from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from core.models import Audit, Unit
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from responses.models import Issue

from messaging.models import Attempt, Message
from messaging.transports import MetaTransport, SendError, SimulatedTransport, get_transport


def manual_simulation(message):
    return bool(
        settings.SEND_MODE == "simulated"
        and message.snapshot.get("manual_group_simulation")
        and message.appointment_id
        and message.appointment.synthetic
        and message.appointment.source in {"synthetic", "sqlite_simulated"}
    )


def issue_once(message, code, description):
    contact_phone = (
        message.recipient if code not in {"conflicting_replies", "postoperative_attention"} else ""
    )
    if message.case_id:
        existing = Issue.objects.filter(
            unit=message.unit,
            message__case=message.case,
            category=code,
            contact_phone=contact_phone,
            resolved_at=None,
        ).first()
        if existing:
            return existing
    return Issue.objects.get_or_create(
        unit=message.unit,
        message=message,
        category=code,
        resolved_at=None,
        defaults={"description": description, "case": message.case, "contact_phone": contact_phone},
    )[0]


def send_guard(message):
    if message.snapshot.get("oracle_agenda"):
        return "oracle_agenda_preview_only"

    from messaging.pilot import authorized_recipients

    real = False
    if settings.SEND_MODE != "simulated":
        from messaging.pilot import guard

        error = guard(message)
        if error:
            return error
        real = True
    manual = manual_simulation(message)
    if message.unit.paused and not manual:
        return "paused"
    if message.snapshot.get("report_request"):
        from operations.models import ReportRequest
        from operations.reports import check_access

        try:
            job = ReportRequest.objects.select_related("report", "requester", "unit", "access").get(
                pk=message.snapshot["report_request"], unit=message.unit
            )
            check_access(job)
        except Exception:
            return "report_access_revoked"
    campaign_real = real and bool(message.snapshot.get("manual_campaign_real"))
    if message.template.purpose != message.purpose and not campaign_real:
        return "template_purpose_mismatch"
    if message.case_id:
        if message.case.outcome in {"declined", "leave_waitlist"}:
            return "case_not_eligible"
        if (
            message.rule_id
            and message.rule.response_condition == "confirmed"
            and message.case.outcome != "confirmed"
        ):
            return "response_condition_not_met"
        if (
            message.rule_id
            and message.rule.response_condition == "unanswered"
            and message.case.response_state not in {"pending", "no_response"}
        ):
            return "response_condition_not_met"
    from operations.models import Contact

    if Contact.objects.filter(unit=message.unit, phone=message.recipient, opted_out=True).exists():
        return "contact_opted_out"
    if (
        message.case_id
        and Contact.objects.filter(
            event=message.case.event, phone=message.recipient, status__in=["invalid", "wrong_person"]
        ).exists()
    ):
        return "contact_requires_review"
    if message.appointment_id is None:
        if not message.case_id or message.case.unit_id != message.unit_id:
            return "unit_mismatch"
        if message.case.event.revision != message.appointment_revision or message.case.state == "closed":
            return "source_changed"
        if campaign_real:
            if message.template.unit_id != message.unit_id or not message.template.approved_for_test:
                return "template_not_validated"
            return ""
        if not message.case.event.synthetic or message.case.event.source != "synthetic":
            return "real_event_blocked"
        if message.recipient not in authorized_recipients(message.unit):
            return "recipient_not_allowed"
        if settings.SEND_MODE == "meta_test" and message.unit.slug != settings.META_UNIT_SLUG:
            return "channel_unit_not_configured"
        if message.template.unit_id != message.unit_id or not message.template.approved_for_test:
            return "template_not_validated"
        return ""
    if message.appointment.data_issue:
        return message.appointment.data_issue
    if settings.SEND_MODE == "meta_test" and message.unit.slug != settings.META_UNIT_SLUG:
        return "channel_unit_not_configured"
    if not message.appointment.synthetic or message.appointment.source not in {
        "synthetic",
        "sqlite_simulated",
    }:
        return "real_appointment_blocked"
    if message.recipient not in authorized_recipients(message.unit) and not manual:
        return "recipient_not_allowed"
    if (
        message.appointment.status != "scheduled"
        or message.appointment_revision != message.appointment.revision
    ):
        return "appointment_changed"
    if message.rule_id and (
        (not message.rule.enabled and not manual and not real) or message.rule.version != message.rule_version
    ):
        return "rule_changed"
    if not message.template.approved_for_test and not manual:
        return "template_not_validated"
    if message.template.unit_id != message.unit_id or (
        message.rule_id and message.rule.unit_id != message.unit_id
    ):
        return "unit_mismatch"
    return ""


def dispatch(message_id, transport=None, now=None):
    now = now or timezone.now()
    transport = transport or get_transport()
    # Persist the claim BEFORE touching the network. A killed worker leaves 'sending',
    # which is quarantined as uncertain instead of causing a duplicate external send.
    with transaction.atomic():
        initial = Message.objects.only("unit_id", "appointment_id").get(pk=message_id)
        # Allow foreign-key checks for audit inserts while serializing unit changes.
        # FOR UPDATE here deadlocks with another worker committing its delivery.
        unit = Unit.objects.select_for_update(no_key=True).get(pk=initial.unit_id)
        from scheduling.models import Appointment

        if initial.appointment_id:
            Appointment.objects.select_for_update().get(pk=initial.appointment_id)
        message = (
            Message.objects.select_for_update(of=("self",))
            .select_related("appointment", "rule", "template")
            .get(pk=message_id)
        )
        message.unit = unit
        if settings.SEND_MODE == "meta_test" and settings.META_REAL_ENABLED:
            if type(transport) is not MetaTransport:
                raise ValueError("meta_transport_required")
            transport.unit_id = unit.pk
        if manual_simulation(message) and type(transport) is not SimulatedTransport:
            raise ValueError("simulation_transport_required")
        if message.state != Message.State.QUEUED:
            return message
        group = None
        if message.group_id:
            from messaging.models import AppointmentGroup

            group = AppointmentGroup.objects.select_for_update().get(pk=message.group_id)
            # Reconcile messages inserted by an importer concurrently with a schedule edit.
            if group.schedule_overridden and message.attempt_count == 0:
                message.scheduled_for = group.scheduled_for
                local = group.scheduled_for.astimezone(ZoneInfo(unit.timezone))
                day_end = datetime.combine(
                    local.date() + timedelta(days=1), time.min, ZoneInfo(unit.timezone)
                )
                message.expires_at = min(
                    day_end,
                    group.scheduled_for + timedelta(hours=message.snapshot.get("validity_hours", 24)),
                    message.appointment.scheduled_at,
                )
                message.save(update_fields=["scheduled_for", "expires_at"])
        if message.scheduled_for > now:
            return message
        if message.expires_at <= now or (
            message.appointment_id
            and message.purpose == "appointment"
            and message.appointment.scheduled_at <= now
        ):
            message.state = Message.State.EXPIRED
            message.save()
            return message
        error = send_guard(message)
        if error in {"paused", "campaign_sending_disabled"} or (
            error == "pilot_daily_limit" and message.snapshot.get("manual_campaign_real")
        ):
            return message
        if error:
            message.state, message.error_code = Message.State.BLOCKED, error
            message.save()
            issue_once(message, error, "Envio bloqueado pelas regras do ambiente de teste.")
            return message
        if message.attempt_count >= 3:
            message.state = Message.State.FAILED
            message.save()
            return message
        if message.snapshot.get("manual_campaign_real"):
            from operations.models import Campaign

            campaign = Campaign.objects.select_for_update().get(pk=message.snapshot["campaign"], unit=unit)
            if campaign.next_send_at and campaign.next_send_at > now:
                return message
            campaign.next_send_at = now + timedelta(seconds=5)
            campaign.save(update_fields=["next_send_at"])
        if group:
            if group.next_send_at and group.next_send_at > now:
                return message
            group.next_send_at = now + timedelta(seconds=group.delay_seconds)
            group.save(update_fields=["next_send_at"])
            message.snapshot = {
                **message.snapshot,
                "group_schedule": {
                    "id": str(group.pk),
                    "version": group.version,
                    "scheduled_for": group.scheduled_for.isoformat(),
                    "delay_seconds": group.delay_seconds,
                },
            }
        message.state, message.last_attempt_at = Message.State.SENDING, now
        message.channel_id = transport.channel_id
        if settings.SEND_MODE == "meta_test" and settings.META_DISPLAY_PHONE_NUMBER:
            message.snapshot = {**message.snapshot, "sender_phone": settings.META_DISPLAY_PHONE_NUMBER}
        message.attempt_count += 1
        message.save()
        attempt = Attempt.objects.create(message=message, number=message.attempt_count)
        attempt_id = attempt.pk
    try:
        provider_id = transport.send(message)
        failure = None
    except SendError as exc:
        provider_id, failure = None, exc
    except Exception:
        provider_id, failure = None, SendError("unexpected_result_unknown", uncertain=True)
    with transaction.atomic():
        message = Message.objects.select_for_update().get(pk=message_id)
        attempt = Attempt.objects.get(pk=attempt_id)
        if failure is None:
            message.provider_id = provider_id
            message.state, message.error_code, attempt.outcome = Message.State.ACCEPTED, "", "accepted"
            message.response_state = "pending"
        else:
            exc = failure
            attempt.outcome, attempt.error_code = "failed", exc.code
            message.error_code = exc.code
            if exc.uncertain:
                message.state, attempt.outcome = Message.State.UNCERTAIN, "uncertain"
            elif exc.transient and message.attempt_count < 3:
                message.state = Message.State.QUEUED
                message.scheduled_for = now + timedelta(minutes=1 if message.attempt_count == 1 else 5)
            else:
                message.state = Message.State.FAILED
            if message.state in [Message.State.FAILED, Message.State.UNCERTAIN]:
                issue_once(
                    message,
                    message.error_code,
                    "Falha no envio. Verifique o código e o histórico de tentativas.",
                )
        attempt.completed_at = now
        attempt.save()
        message.save()
        Audit.objects.create(
            unit=unit,
            action="message." + attempt.outcome,
            object_id=str(message.pk),
            details={"attempt": message.attempt_count, "code": message.error_code},
        )
    from responses.services import reconcile_statuses

    reconcile_statuses(message)
    return message


@transaction.atomic
def retry_individual(message, actor, now=None):
    now = now or timezone.now()
    message = (
        Message.objects.select_for_update(of=("self",))
        .select_related("appointment", "unit", "rule", "template")
        .get(pk=message.pk)
    )
    if message.state not in [Message.State.FAILED, Message.State.BLOCKED]:
        raise ValueError("Somente falhas conhecidas ou bloqueios podem ser reprocessados.")
    if message.expires_at <= now or message.attempt_count >= 3:
        raise ValueError("Mensagem vencida ou limite de tentativas atingido.")
    error = send_guard(message)
    if error:
        raise ValueError(error)
    message.state, message.error_code, message.scheduled_for = Message.State.QUEUED, "", now
    message.save()
    Audit.objects.create(unit=message.unit, actor=actor, action="message.retry", object_id=str(message.pk))
    return message
