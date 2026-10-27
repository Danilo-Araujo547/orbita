from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("operations", "0022_report_receiving_permissions")]
    operations = [
        migrations.AddField(model_name="reportwhatsappconfiguration", name="menu_title", field=models.CharField(max_length=60, default="Relatórios")),
        migrations.AddField(model_name="reportwhatsappconfiguration", name="menu_button", field=models.CharField(max_length=20, default="Ver relatórios")),
        migrations.AddField(model_name="reportwhatsappconfiguration", name="menu_section", field=models.CharField(max_length=24, default="Disponíveis para você")),
    ]
