from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0005_oracle_persistent_access")]
    operations = [
        migrations.AddField(model_name="unit", name="version", field=models.PositiveIntegerField(default=1)),
        migrations.AddField(
            model_name="unit",
            name="authorized_recipients",
            field=models.JSONField(null=True, default=None, blank=True),
        ),
    ]
