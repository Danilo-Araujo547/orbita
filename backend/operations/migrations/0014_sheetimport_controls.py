from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        (
            "operations",
            "0013_campaign_import_batch_importlayout_default_template_and_more",
        )
    ]
    operations = [
        migrations.AddField(
            model_name="sheetimport",
            name="version",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="sheetimport",
            name="disabled_records",
            field=models.JSONField(default=list, blank=True),
        ),
    ]
