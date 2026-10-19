from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("scheduling", "0006_appointment_city_appointment_patient_external_id_and_more")]

    operations = [
        migrations.AddField(model_name="rule", name="refresh_interval_minutes", field=models.PositiveIntegerField(default=5)),
        migrations.AlterField(model_name="rule", name="days_before", field=models.PositiveIntegerField(default=5)),
    ]
