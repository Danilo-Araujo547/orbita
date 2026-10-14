from django.db import migrations
from django.utils import timezone


def backfill(apps, schema_editor):
    Appointment = apps.get_model("scheduling", "Appointment")
    Event = apps.get_model("operations", "SourceEvent")
    Case = apps.get_model("operations", "Case")
    Contact = apps.get_model("operations", "Contact")
    Interaction = apps.get_model("operations", "Interaction")
    Message = apps.get_model("messaging", "Message")
    for a in Appointment.objects.all().iterator():
        event, _ = Event.objects.get_or_create(unit_id=a.unit_id, source=a.source, kind=a.kind, external_id=a.external_id,
            defaults={"patient": a.patient, "phone": a.phone, "occurred_at": a.scheduled_at,
                      "revision": a.revision, "synthetic": a.synthetic, "appointment_id": a.pk,
                      "data": {"procedure": a.procedure, "appointment_type": a.appointment_type, "arrival_time": a.arrival_time, "status": a.status}})
        case, created = Case.objects.get_or_create(unit_id=a.unit_id, event=event, purpose="appointment")
        if created:
            Interaction.objects.create(case=case, kind="created", text="Acompanhamento criado para registro existente no Órbita.", occurred_at=timezone.now())
        if a.phone:
            Contact.objects.get_or_create(unit_id=a.unit_id, event=event, phone=a.phone)
        Message.objects.filter(appointment=a).update(case=case)
        latest = Message.objects.filter(appointment=a).exclude(response_state="not_requested").order_by("-created_at").first()
        if latest:
            case.outcome = latest.response_state if latest.response_state in {"confirmed", "declined", "review"} else ""
            case.response_state = "review" if latest.response_state == "review" else "answered" if case.outcome else "no_response" if latest.response_state == "no_response" else "pending"
            case.save()


class Migration(migrations.Migration):
    dependencies = [("operations", "0001_initial"), ("messaging", "0005_message_case_message_notification_key_and_more")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
