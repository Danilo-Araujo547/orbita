from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest
from core.models import Unit
from messaging.models import Message
from messaging.services import send_guard
from operations.models import Contact, Interaction
from responses.models import Issue
from responses.services import apply_reply, mark_no_response, store_event
from scheduling.models import Appointment, Patient
from scheduling.services import queue_appointment, upsert_appointment


def multi(setup):
    row = replace(
        setup["row"], phone_numbers=(setup["row"].phone, "5511999990002"), patient_external_id="12345"
    )
    appointment = upsert_appointment(setup["unit"], row)
    queue_appointment(appointment, setup["rule"], setup["now"])
    messages = list(
        appointment.messages.filter(appointment_revision=appointment.revision).order_by("recipient")
    )
    for index, message in enumerate(messages):
        message.state, message.response_state, message.provider_id = "delivered", "pending", f"multi-{index}"
        message.delivered_at = setup["now"] - timedelta(hours=25)
        message.save()
    return appointment, messages


def reply(setup, message, text, seconds=0):
    event = store_event(
        "simulated",
        str(uuid4()),
        "reply",
        int((setup["now"] + timedelta(seconds=seconds)).timestamp()),
        {"sender": message.recipient, "text": text, "context_id": message.provider_id},
    )
    apply_reply(event, setup["unit"])


def test_confirmation_and_silence_one_patient_one_appointment(setup):
    appointment, messages = multi(setup)
    reply(setup, messages[0], "SIM")
    mark_no_response(setup["now"])
    case = appointment.sourceevent.cases.get(purpose="appointment")
    assert case.outcome == "confirmed" and case.response_state == "answered"
    assert not Issue.objects.filter(category="no_response").exists()
    assert Patient.objects.count() == Appointment.objects.count() == 1
    assert len({m.notification_id for m in messages}) == 1
    response = setup["client"].get("/api/v1/appointments/?unit=ame")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert len(response.data["results"][0]["tracking"]["contacts"]) == 2


def test_one_confirmation_wins_over_other_contact_declining_out_of_order(setup):
    appointment, messages = multi(setup)
    reply(setup, messages[0], "SIM", 2)
    reply(setup, messages[1], "NÃO", 1)
    reply(setup, messages[1], "NÃO", 3)
    case = appointment.sourceevent.cases.get(purpose="appointment")
    assert case.outcome == "confirmed" and case.response_state == "answered"
    assert Issue.objects.filter(case=case, category="conflicting_replies", resolved_at=None).count() == 0
    assert sum(m.replies.count() for m in messages) == 3
    assert appointment.sourceevent.cases.count() == 1


def test_pending_list_excludes_waiting_and_confirmed_even_with_declining_contact(setup):
    appointment, messages = multi(setup)
    client = setup["client"]
    url = "/api/v1/appointments/?unit=ame&operational_pending=true"
    assert client.get(url).data["count"] == 0
    reply(setup, messages[1], "NAO", 1)
    assert client.get(url).data["count"] == 1
    reply(setup, messages[0], "SIM", 2)
    assert client.get(url).data["count"] == 0
    assert client.get("/api/v1/appointments/?unit=ame").data["count"] == 1
    assert (
        client.get("/api/v1/appointments/export/?unit=ame&operational_pending=true")
        .content.decode("utf-8-sig")
        .count(appointment.external_id)
        == 0
    )


def test_reconcile_existing_divergence_is_idempotent(setup):
    from django.core.management import call_command

    appointment, messages = multi(setup)
    reply(setup, messages[0], "SIM")
    case = appointment.sourceevent.cases.get(purpose="appointment")
    case.outcome, case.response_state = "review", "review"
    case.save()
    issue = Issue.objects.create(
        unit=case.unit,
        case=case,
        message=messages[0],
        category="conflicting_replies",
        description="Divergência anterior",
    )
    call_command("reconcile_appointment_confirmations")
    case.refresh_from_db()
    issue.refresh_from_db()
    assert case.outcome == "confirmed" and issue.resolved_at
    version = case.version
    call_command("reconcile_appointment_confirmations")
    case.refresh_from_db()
    assert case.version == version


@pytest.mark.parametrize("text,status", [("PARAR", "opt_out"), ("Não conheço essa pessoa", "wrong_person")])
def test_contact_rejection_does_not_block_other_number(setup, text, status):
    appointment, messages = multi(setup)
    reply(setup, messages[1], text)
    contact = Contact.objects.get(event=appointment.sourceevent, phone=messages[1].recipient)
    assert contact.opted_out if status == "opt_out" else contact.status == "wrong_person"
    assert send_guard(messages[0]) == ""
    assert send_guard(messages[1]) in {"contact_opted_out", "contact_requires_review"}


def test_patient_identity_not_phone_or_name_and_idempotent_import(setup):
    appointment, _ = multi(setup)
    again = upsert_appointment(
        setup["unit"],
        replace(setup["row"], phone_numbers=tuple(appointment.phone_numbers), patient_external_id="12345"),
    )
    assert again.revision == appointment.revision
    other = upsert_appointment(
        setup["unit"], replace(setup["row"], external_id="SECOND", patient_external_id="999")
    )
    assert other.patient_record_id != appointment.patient_record_id
    same = upsert_appointment(
        setup["unit"], replace(setup["row"], external_id="THIRD", patient_external_id="12345")
    )
    assert same.patient_record_id == appointment.patient_record_id


def test_no_ownership_and_cross_unit_export(setup):
    multi(setup)
    case = setup["appointment"].sourceevent.cases.get()
    result = setup["client"].post(
        f"/api/v1/cases/{case.pk}/act/?unit=ame",
        {"action": "assign", "version": case.version, "text": "Assumir paciente"},
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid4()),
    )
    assert result.status_code == 400
    Unit.objects.create(slug="other", name="Outra")
    assert setup["client"].get("/api/v1/appointments/export/?unit=other").status_code == 403
    assert setup["client"].get("/api/v1/appointments/?date_basis=reply").status_code == 200
    assert setup["client"].get("/api/v1/appointments/?date_basis=send").status_code == 200


def test_recipient_uniqueness_and_phone_required_for_action(setup):
    appointment, messages = multi(setup)
    queue_appointment(appointment, setup["rule"], setup["now"])
    assert Message.objects.filter(notification_id=messages[0].notification_id).count() == 2
    case = appointment.sourceevent.cases.get()
    result = setup["client"].post(
        f"/api/v1/cases/{case.pk}/act/?unit=ame",
        {
            "action": "classify",
            "outcome": "confirmed",
            "version": case.version,
            "text": "Confirmou por telefone",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid4()),
    )
    assert result.status_code == 400


def test_waiting_since_uses_current_revision_confirmed_delivery(setup):
    appointment, messages = multi(setup)
    first = setup["now"] - timedelta(hours=25)
    messages[1].delivered_at = setup["now"] - timedelta(hours=2)
    messages[1].save()
    result = setup["client"].get(f"/api/v1/appointments/{appointment.pk}/?unit=ame")
    assert result.data["tracking"]["awaiting_since"] == first.isoformat()
    appointment.messages.update(delivered_at=None)
    result = setup["client"].get(f"/api/v1/appointments/{appointment.pk}/?unit=ame")
    assert result.data["tracking"]["awaiting_since"] is None
    appointment.revision += 1
    appointment.save(update_fields=["revision"])
    appointment.messages.update(delivered_at=first)
    result = setup["client"].get(f"/api/v1/appointments/{appointment.pk}/?unit=ame")
    assert result.data["tracking"]["awaiting_since"] is None


@pytest.mark.parametrize("kind", ["note", "call"])
def test_without_observations_filter_and_export(setup, kind):
    appointment, _ = multi(setup)
    case = appointment.sourceevent.cases.get(purpose="appointment")
    client = setup["client"]
    url = "/api/v1/appointments/?unit=ame&observations=false"
    assert client.get(url).data["count"] == 1
    Interaction.objects.create(case=case, kind="classification", text="Registro", occurred_at=setup["now"])
    assert client.get(url).data["count"] == 1
    Interaction.objects.create(case=case, kind=kind, text="Observação", occurred_at=setup["now"])
    assert client.get(url).data["count"] == 0
    assert client.get("/api/v1/appointments/?unit=ame&observations=true").data["count"] == 1
    exported = client.get("/api/v1/appointments/export/?unit=ame&observations=false")
    assert appointment.external_id not in exported.content.decode("utf-8-sig")
