import hashlib
import json
from datetime import timedelta

from core.models import Audit, Membership
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from messaging.models import Message
from rest_framework.exceptions import APIException, ValidationError
from scheduling.connectors import normalize_phone

from operations.models import (
    ActionReceipt,
    Case,
    Contact,
    Interaction,
    Purpose,
    SourceEvent,
)


class Conflict(APIException):
    status_code = 409
    default_detail = (
        "O registro foi alterado. Atualize os dados antes de tentar novamente."
    )


OUTCOMES = {
    Purpose.APPOINTMENT: {"confirmed", "declined", "wrong_person", "opt_out", "review"},
    Purpose.WAITLIST: {
        "stay_waitlist",
        "leave_waitlist",
        "wrong_person",
        "opt_out",
        "review",
    },
    Purpose.SUMMONS: {"acknowledged", "declined", "wrong_person", "opt_out", "review"},
    Purpose.POSTOPERATIVE: {
        "well",
        "needs_attention",
        "wrong_person",
        "opt_out",
        "review",
    },
    Purpose.ABSENCE: {
        "reason_received",
        "confirmed",
        "wrong_person",
        "opt_out",
        "review",
    },
    Purpose.MOVEMENT: {"acknowledged", "wrong_person", "opt_out", "review"},
    Purpose.REPORT: {"acknowledged", "wrong_person", "opt_out", "review"},
}


def log(case, kind, text, actor=None, **kwargs):
    return Interaction.objects.create(
        case=case,
        actor=actor,
        kind=kind,
        text=text,
        occurred_at=kwargs.pop("occurred_at", timezone.now()),
        **kwargs,
    )


@transaction.atomic
def ensure_appointment_case(appointment):
    from scheduling.models import Patient, PatientPhone
    from scheduling.services import contact_numbers

    patient = None
    if appointment.patient_external_id:
        patient, _ = Patient.objects.update_or_create(
            unit=appointment.unit,
            source=appointment.source,
            external_id=appointment.patient_external_id,
            defaults={"name": appointment.patient},
        )
        if appointment.patient_record_id != patient.pk:
            appointment.patient_record = patient
            appointment.save(update_fields=["patient_record"])
    event, created = SourceEvent.objects.get_or_create(
        unit=appointment.unit,
        source=appointment.source,
        kind=appointment.kind,
        external_id=appointment.external_id,
        defaults={
            "patient": appointment.patient,
            "phone": appointment.phone,
            "occurred_at": appointment.scheduled_at,
            "revision": appointment.revision,
            "synthetic": appointment.synthetic,
            "appointment": appointment,
            "data": {
                "procedure": appointment.procedure,
                "procedure_code": appointment.procedure_code,
                "appointment_type": appointment.appointment_type,
                "arrival_time": appointment.arrival_time,
                "status": appointment.status,
            },
        },
    )
    if not created and event.revision != appointment.revision:
        event.patient, event.phone = appointment.patient, appointment.phone
        event.occurred_at, event.revision = (
            appointment.scheduled_at,
            appointment.revision,
        )
        event.data = {
            "procedure": appointment.procedure,
            "procedure_code": appointment.procedure_code,
            "appointment_type": appointment.appointment_type,
            "arrival_time": appointment.arrival_time,
            "status": appointment.status,
        }
        event.save()
        for existing in event.cases.all():
            Case.objects.filter(pk=existing.pk).update(
                version=F("version") + 1,
                updated_at=timezone.now(),
                outcome="",
                response_state="pending",
                last_response_at=None,
                due_at=None,
                state="assigned" if existing.assignee_id else "open",
            )
            log(
                existing,
                "source_changed",
                "Dados atualizados pela origem.",
                data={"revision": event.revision},
            )
    case, new = Case.objects.get_or_create(
        unit=appointment.unit, event=event, purpose=Purpose.APPOINTMENT
    )
    if new:
        log(case, "created", "Acompanhamento criado a partir do agendamento.")
    for phone in contact_numbers(appointment.phone_numbers, appointment.phone):
        patient_phone = None
        if patient:
            patient_phone, _ = PatientPhone.objects.get_or_create(
                patient=patient, phone=phone
            )
        contact, _ = Contact.objects.get_or_create(
            unit=event.unit, event=event, phone=phone
        )
        if patient_phone and contact.patient_phone_id != patient_phone.pk:
            contact.patient_phone = patient_phone
            contact.status, contact.opted_out = (
                patient_phone.status,
                patient_phone.opted_out,
            )
            contact.save(update_fields=["patient_phone", "status", "opted_out"])
    return case


@transaction.atomic
def idempotent(unit, actor, key, payload, execute):
    if not isinstance(key, str) or not 8 <= len(key) <= 100:
        raise ValidationError("Informe Idempotency-Key entre 8 e 100 caracteres.")
    # Serialize actions per unit. This works together with the unique receipt constraint.
    type(unit).objects.select_for_update(no_key=True).get(pk=unit.pk)
    fingerprint = hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()
    receipt = ActionReceipt.objects.filter(unit=unit, actor=actor, key=key).first()
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise Conflict("Chave de idempotência já utilizada com outro conteúdo.")
        return receipt.result
    from rest_framework.renderers import JSONRenderer

    result = json.loads(JSONRenderer().render(execute()))
    ActionReceipt.objects.create(
        unit=unit, actor=actor, key=key, fingerprint=fingerprint, result=result
    )
    return result


def lock_case(case, version):
    # Conditional UPDATE also guards SQLite, where SELECT FOR UPDATE is ineffective.
    if type(version) is not int or not Case.objects.filter(
        pk=case.pk, version=version
    ).update(version=F("version") + 1, updated_at=timezone.now()):
        raise Conflict()
    case.refresh_from_db()
    return case


def eligible_operator(user, unit):
    return user.is_active and (
        user.is_superuser
        or Membership.objects.filter(
            unit=unit, user=user, role__in=["admin", "operator"]
        ).exists()
    )


def apply_outcome(
    case,
    outcome,
    actor=None,
    text="",
    channel="panel",
    occurred_at=None,
    reply_id=None,
    phone="",
    interlocutor="",
    message_id=None,
):
    if outcome not in OUTCOMES[case.purpose]:
        raise ValidationError("Resultado incompatível com a finalidade deste caso.")
    occurred_at = occurred_at or timezone.now()
    if reply_id:
        from responses.models import Reply

        phone = Reply.objects.get(pk=reply_id).sender
    historical = (
        case.last_response_at is not None and occurred_at < case.last_response_at
    )
    # Different contacts may legitimately respond out of order.
    if phone:
        historical = case.interactions.filter(
            kind="classification", data__phone=phone, occurred_at__gt=occurred_at
        ).exists()
    log(
        case,
        "classification",
        text or "Resposta classificada.",
        actor=actor,
        channel=channel,
        outcome=outcome,
        occurred_at=occurred_at,
        interlocutor=interlocutor,
        data={
            "reply_id": reply_id,
            "message_id": str(message_id) if message_id else None,
            "phone": phone,
            "revision": case.event.revision,
            "historical": historical,
            "previous_outcome": case.outcome,
        },
    )
    if historical:
        return
    aggregate = outcome
    if phone:
        latest = {}
        for action in case.interactions.filter(kind="classification").order_by(
            "-occurred_at", "-id"
        ):
            if action.data.get(
                "revision", case.event.revision
            ) != case.event.revision or action.data.get("historical"):
                continue
            key = action.data.get("phone", "")
            if not key:
                # A manual overall decision is authoritative until a newer response.
                if not latest:
                    aggregate = action.outcome
                break
            latest.setdefault(key, action.outcome)
        outcomes = set(latest.values())
        positive, negative = (
            {"confirmed", "stay_waitlist", "well", "acknowledged"},
            {"declined", "leave_waitlist", "needs_attention"},
        )
        if case.purpose == "appointment" and "confirmed" in outcomes:
            aggregate = "confirmed"
            from responses.models import Issue

            Issue.objects.filter(
                case=case, category="conflicting_replies", resolved_at__isnull=True
            ).update(
                resolved_at=timezone.now(),
                resolution="Agendamento confirmado por pelo menos um contato.",
            )
        elif outcomes & positive and outcomes & negative:
            aggregate = "review"
            message = case.messages.order_by("-created_at").first()
            if message:
                from messaging.services import issue_once

                issue_once(
                    message,
                    "conflicting_replies",
                    "Contatos responderam de forma divergente; revise o agendamento.",
                )
        elif outcomes & positive:
            aggregate = sorted(outcomes & positive)[0]
        elif outcomes & negative:
            aggregate = sorted(outcomes & negative)[0]
        else:
            aggregate = "review"
    case.outcome = aggregate
    case.last_response_at = max(occurred_at, case.last_response_at or occurred_at)
    case.due_at = None
    case.response_state = "review" if aggregate == "review" else "answered"
    if outcome == "needs_attention":
        case.priority = "high"
        if case.state == "closed":
            case.state = "open"
    case.version += 1
    case.save()
    if aggregate in {"declined", "leave_waitlist"}:
        Message.objects.filter(
            case=case, state__in=["queued", "preview", "blocked"]
        ).update(state="cancelled")
    if outcome in {"wrong_person", "opt_out"}:
        phone = phone or case.event.phone
        Contact.objects.filter(event=case.event, phone=phone).update(
            **(
                {"status": "wrong_person"}
                if outcome == "wrong_person"
                else {"opted_out": True}
            )
        )
    if outcome in {"wrong_person", "opt_out"}:
        from scheduling.models import PatientPhone

        patient_phones = Contact.objects.filter(
            event=case.event, phone=phone
        ).values_list("patient_phone_id", flat=True)
        PatientPhone.objects.filter(pk__in=patient_phones).update(
            **(
                {"status": "wrong_person"}
                if outcome == "wrong_person"
                else {"opted_out": True}
            )
        )
    if outcome == "opt_out":
        # Suppress this destination for the unit across cases, preserving all event identities.
        Contact.objects.filter(unit=case.unit, phone=phone).update(opted_out=True)
        Message.objects.filter(
            unit=case.unit, recipient=phone, state__in=["queued", "preview", "blocked"]
        ).update(state="cancelled")
    if outcome == "wrong_person":
        Message.objects.filter(
            case=case, recipient=phone, state__in=["queued", "preview", "blocked"]
        ).update(state="cancelled")
    from responses.models import Issue

    Issue.objects.filter(
        message__case=case, category="no_response", resolved_at__isnull=True
    ).update(
        resolved_at=timezone.now(), resolution="Resposta registrada no acompanhamento."
    )
    if outcome in {"needs_attention", "wrong_person", "review"}:
        message = (
            case.messages.filter(**({"recipient": phone} if phone else {}))
            .order_by("-created_at")
            .first()
        )
        if message:
            from messaging.services import issue_once

            issue_once(
                message,
                {
                    "needs_attention": "postoperative_attention",
                    "wrong_person": "wrong_person",
                    "review": "reply_review",
                }[outcome],
                "Resposta requer atendimento da equipe.",
            )
    Audit.objects.create(
        unit=case.unit,
        actor=actor,
        action="case.classified",
        object_id=str(case.pk),
        details={"purpose": case.purpose, "outcome": outcome},
    )


def contextual_classify(
    text,
    purpose="appointment",
    button_id="",
    content_type="text",
    response_policy="contextual",
):
    import unicodedata

    if content_type not in {"text", "button", "interactive"}:
        return "review"
    clean = "".join(
        c
        for c in unicodedata.normalize("NFD", text.strip().lower())
        if unicodedata.category(c) != "Mn"
    )
    if response_policy == "confirmation_test" and purpose == "absence":
        if clean in {"sim", "nao"} or button_id in {"confirmed", "declined"}:
            return "confirmed"
    if button_id in OUTCOMES.get(purpose, set()):
        return button_id
    if clean in {"3", "nao conheco essa pessoa", "nao conheco esta pessoa"}:
        return "wrong_person"
    if clean in {"parar", "sair", "nao quero receber mensagens"}:
        return "opt_out"
    positive = clean in {"sim", "1", "confirmo", "confirmar", "confirmar presenca"}
    negative = clean in {"nao", "2", "nao vou", "recusar", "nao comparecerei"}
    pairs = {
        "appointment": ("confirmed", "declined"),
        "waitlist": ("stay_waitlist", "leave_waitlist"),
        "postoperative": ("well", "needs_attention"),
        "summons": ("acknowledged", "declined"),
        "movement": ("acknowledged", "review"),
    }
    if purpose in pairs:
        return (
            pairs[purpose][0]
            if positive
            else pairs[purpose][1]
            if negative
            else "review"
        )
    return "review"


@transaction.atomic
def preview_campaign(campaign):
    if (
        campaign.state != "draft"
        or not campaign.template
        or campaign.template.unit_id != campaign.unit_id
    ):
        raise ValidationError(
            "Campanha deve estar em rascunho e possuir template da unidade."
        )
    test_confirmation = campaign.response_policy == "confirmation_test"
    if test_confirmation and (
        campaign.purpose != "absence"
        or campaign.template.name != "confirmacao_consulta_sqlite_v1"
    ):
        raise ValidationError(
            "Política de teste restrita ao template de confirmação da campanha de ausentes."
        )
    if campaign.template.purpose != campaign.purpose and not test_confirmation:
        raise ValidationError("Finalidade do template incompatível.")
    if not campaign.scheduled_for:
        raise ValidationError("Informe a data prevista.")
    messages = []
    for case in campaign.cases.select_related("event"):
        if case.unit_id != campaign.unit_id or case.purpose != campaign.purpose:
            raise ValidationError("Caso incompatível com a campanha.")
        event = case.event
        available = {
            "patient": event.patient,
            "date": timezone.localtime(event.occurred_at).strftime("%d/%m/%Y"),
            **event.data,
        }
        if test_confirmation:
            available.update(
                appointment_type="DO SEU ATENDIMENTO",
                arrival_time=timezone.localtime(event.occurred_at).strftime("%H:%M"),
            )
        parameter_fields = campaign.template.fields
        frozen = None
        if campaign.import_batch_id:
            batch = campaign.import_batch
            frozen = batch.configuration.get("template", {})
            if (
                batch.unit_id != campaign.unit_id
                or batch.template_id != campaign.template_id
                or frozen.get("version") != campaign.template.version
            ):
                raise ValidationError(
                    "Configuração do template da importação foi alterada; gere uma nova prévia."
                )
            parameter_fields = batch.configuration.get("parameter_fields", [])
            available = event.data.get("standardized", {})
        params = [str(available.get(field, "")) for field in parameter_fields]
        if any(not p.strip() for p in params):
            raise ValidationError("Parâmetros incompletos para um dos casos.")
        from messaging.models import Notification
        from scheduling.services import contact_numbers

        numbers = contact_numbers(
            event.appointment.phone_numbers
            if event.appointment_id
            else event.data.get("phone_numbers", []),
            event.phone,
        )
        notification, _ = Notification.objects.get_or_create(
            key=f"campaign:{campaign.pk}:{campaign.version}:{case.pk}:{event.revision}",
            defaults={
                "unit": campaign.unit,
                "appointment": event.appointment,
                "purpose": case.purpose,
                "revision": event.revision,
            },
        )
        for phone in numbers or [""]:
            try:
                recipient = normalize_phone(phone)
            except ValueError:
                raise ValidationError(
                    "Contato inválido; revise antes de criar a prévia."
                ) from None
            body = frozen["body"] if frozen else campaign.template.body
            for i, value in enumerate(params, 1):
                body = body.replace("{{" + str(i) + "}}", value)
            message, _ = Message.objects.get_or_create(
                notification_key=f"{notification.key}:{recipient}",
                defaults={
                    "notification": notification,
                    "unit": campaign.unit,
                    "case": case,
                    "purpose": case.purpose,
                    "appointment": event.appointment,
                    "appointment_revision": event.revision,
                    "rule_version": campaign.version,
                    "template": campaign.template,
                    "template_name": campaign.template.name,
                    "template_language": campaign.template.language,
                    "parameters": params,
                    "body": body,
                    "recipient": recipient,
                    "scheduled_for": campaign.scheduled_for,
                    "expires_at": campaign.scheduled_for + timedelta(days=1),
                    "state": "preview",
                    "snapshot": {
                        "campaign": campaign.pk,
                        "response_policy": campaign.response_policy,
                        "version": campaign.version,
                        "event_revision": event.revision,
                        "synthetic": event.synthetic,
                        "components": campaign.template.components,
                        "fields": parameter_fields,
                        "import_batch": str(campaign.import_batch_id)
                        if campaign.import_batch_id
                        else None,
                        "standard_schema_version": 1
                        if campaign.import_batch_id
                        else None,
                        "template_version": campaign.template.version,
                    },
                },
            )
            messages.append(str(message.pk))
    campaign.state = "preview"
    campaign.save(update_fields=["state"])
    return messages
