from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0004_oracle_configuration")]
    operations = [
        migrations.AddField(model_name="oracleconfiguration", name="service_key_ciphertext", field=models.TextField(blank=True, editable=False)),
        migrations.AddField(model_name="oracleconfiguration", name="operational_enabled", field=models.BooleanField(default=True)),
    ]
