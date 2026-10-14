from django.db import migrations


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Appointment = apps.get_model("scheduling", "Appointment")
    Message = apps.get_model("messaging", "Message")
    Notification = apps.get_model("messaging", "Notification")
    Issue = apps.get_model("responses", "Issue")
    for appointment in Appointment.objects.using(alias).all().iterator():
        Appointment.objects.using(alias).filter(pk=appointment.pk).update(
            phone_numbers=[appointment.phone] if appointment.phone else []
        )
    for message in Message.objects.using(alias).all().iterator():
        key = (f"appointment:{message.appointment_id}:{message.rule_id}:{message.rule_version}:{message.appointment_revision}"
               if message.rule_id else f"legacy:{message.pk}")
        notification, _ = Notification.objects.using(alias).get_or_create(
            key=key, defaults={"unit_id": message.unit_id, "appointment_id": message.appointment_id,
                               "purpose": message.purpose, "revision": message.appointment_revision}
        )
        Message.objects.using(alias).filter(pk=message.pk).update(notification_id=notification.pk)
        Issue.objects.using(alias).filter(message_id=message.pk).update(
            case_id=message.case_id, contact_phone=message.recipient
        )


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0006_contact_patient_phone"),
        ("responses", "0002_issue_case_issue_contact_phone"),
        ("messaging", "0007_notification_remove_message_reminder_identity_and_more"),
    ]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
