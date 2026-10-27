from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0011_campaign_next_send_at")]
    operations = [
        migrations.AlterField(
            model_name="importlayout",
            name="format",
            field=models.CharField(
                max_length=30,
                default="table",
                choices=[
                    ("table", "CSV/XLSX"),
                    ("absence_html", "Ausentes HTML (.xls)"),
                    ("cross_demand_csv", "Demanda por recurso CROSS (.csv)"),
                ],
            ),
        )
    ]
