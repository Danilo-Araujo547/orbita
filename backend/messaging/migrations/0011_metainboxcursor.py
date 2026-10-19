from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("messaging", "0010_metaconfiguration")]
    operations = [migrations.CreateModel(name="MetaInboxCursor", fields=[
        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
        ("position", models.PositiveBigIntegerField(default=0)),
        ("last_sync_at", models.DateTimeField(null=True)),
        ("unit", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, to="core.unit")),
    ])]
