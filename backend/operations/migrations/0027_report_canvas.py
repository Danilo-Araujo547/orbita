from django.db import migrations, models
import django.db.models.deletion
import uuid

class Migration(migrations.Migration):
    dependencies = [("operations", "0026_legacy_snapshot_unknown_schedule")]
    operations = [
        migrations.AddField(model_name="reportdefinition", name="canvas_layout", field=models.JSONField(default=dict, blank=True)),
        migrations.AddField(model_name="reportdefinition", name="canvas_enabled", field=models.BooleanField(default=False)),
        migrations.CreateModel(name="ReportCanvasAsset", fields=[
            ("id",models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False,serialize=False)),
            ("filename",models.CharField(max_length=160)),("data",models.BinaryField()),
            ("width",models.PositiveIntegerField()),("height",models.PositiveIntegerField()),
            ("sha256",models.CharField(max_length=64)),("created_at",models.DateTimeField(auto_now_add=True)),
            ("unit",models.ForeignKey(to="core.unit",on_delete=django.db.models.deletion.PROTECT)),
            ("report",models.ForeignKey(to="operations.reportdefinition",on_delete=django.db.models.deletion.CASCADE,related_name="canvas_assets"))
        ])]
