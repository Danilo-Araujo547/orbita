from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("operations", "0024_bed_snapshots_and_xlsx")]
    operations = [migrations.AddField(model_name="reportdefinition", name="monthly_goals", field=models.JSONField(default=list, blank=True))]
