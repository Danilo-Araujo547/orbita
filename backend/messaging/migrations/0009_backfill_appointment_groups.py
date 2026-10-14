from zoneinfo import ZoneInfo

from django.db import migrations


def backfill(apps, schema_editor):
    Message = apps.get_model("messaging", "Message")
    Group = apps.get_model("messaging", "AppointmentGroup")
    alias = schema_editor.connection.alias
    messages = (
        Message.objects.using(alias)
        .filter(appointment__isnull=False, rule__isnull=False, group__isnull=True)
        .select_related("appointment", "unit")
        .order_by("scheduled_for", "id")
    )
    for message in messages.iterator(chunk_size=500):
        appointment = message.appointment
        group, _ = Group.objects.using(alias).get_or_create(
            unit_id=message.unit_id,
            kind=appointment.kind,
            appointment_date=appointment.scheduled_at.astimezone(ZoneInfo(message.unit.timezone)).date(),
            rule_id=message.rule_id,
            rule_version=message.rule_version,
            defaults={"scheduled_for": message.scheduled_for},
        )
        Message.objects.using(alias).filter(pk=message.pk).update(group_id=group.pk)


class Migration(migrations.Migration):
    dependencies = [("messaging", "0008_appointment_groups")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
