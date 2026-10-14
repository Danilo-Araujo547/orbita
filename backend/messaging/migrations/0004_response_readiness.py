from django.db import migrations


def correct_unsent(apps, schema_editor):
    Message = apps.get_model("messaging", "Message")
    Message.objects.filter(response_state="pending", state__in=["preview", "queued", "blocked", "expired", "cancelled"]).update(response_state="not_requested")


class Migration(migrations.Migration):
    dependencies = [("messaging", "0003_alter_message_response_state")]
    operations = [migrations.RunPython(correct_unsent, migrations.RunPython.noop)]
