from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [("operations", "0027_report_canvas")]
    operations = [
        migrations.AddField(model_name="reportsnapshotconfiguration", name="dataset_kind", field=models.CharField(max_length=20,default="beds",choices=[("beds","Leitos totais"),("capacity","Capacidade SUS/convênio"),("lives","Vidas Sansaúde")])),
        migrations.AddField(model_name="reportsnapshotconfiguration", name="reference_offset_days", field=models.SmallIntegerField(default=0)),
        migrations.AddField(model_name="reportsnapshotconfiguration", name="consumers", field=models.ManyToManyField(blank=True,to="operations.reportdefinition",related_name="snapshot_dependencies")),
        migrations.AddField(model_name="reportsnapshotrun", name="period_type", field=models.CharField(max_length=8,default="day",choices=[("day","Diário"),("month","Mensal")])),
        migrations.CreateModel(name="ReportSnapshotDataRow",fields=[
            ("id",models.BigAutoField(auto_created=True,primary_key=True,serialize=False,verbose_name="ID")),
            ("record_key",models.CharField(max_length=200)),("payload",models.JSONField(default=dict)),
            ("unit",models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,to="core.unit")),
            ("run",models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,to="operations.reportsnapshotrun",related_name="data_rows")),
        ],options={"constraints":[models.UniqueConstraint(fields=("run","record_key"),name="snapshot_data_run_key")]})
    ]
