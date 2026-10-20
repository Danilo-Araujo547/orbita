from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0006_unit_version")]
    operations = [
        migrations.AddField(
            model_name="unit",
            name="logo",
            field=models.TextField(blank=True, default=""),
        ),
    ]
