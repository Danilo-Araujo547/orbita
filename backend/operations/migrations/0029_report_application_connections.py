from django.db import migrations,models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies=[("operations","0028_snapshot_datasets"),("core","0007_unit_logo")]
    operations=[
        migrations.CreateModel(name="ReportApplicationConnection",fields=[
            ("id",models.BigAutoField(auto_created=True,primary_key=True,serialize=False,verbose_name="ID")),
            ("name",models.CharField(max_length=150)),
            ("mode",models.CharField(max_length=10,choices=[("local","Instância local"),("remote","Instância remota")],default="local")),
            ("enabled",models.BooleanField(default=False)),("version",models.PositiveIntegerField(default=1)),
            ("unit",models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,related_name="report_app_connections",to="core.unit")),
            ("local_unit",models.ForeignKey(blank=True,null=True,on_delete=django.db.models.deletion.PROTECT,related_name="report_app_sources",to="core.unit")),
            ("remote_instance",models.ForeignKey(blank=True,null=True,on_delete=django.db.models.deletion.PROTECT,to="core.remoteinstance")),
        ]),
        migrations.AddConstraint(model_name="reportapplicationconnection",constraint=models.UniqueConstraint(fields=("unit","name"),name="report_app_connection_name")),
        migrations.AddField(model_name="reportdefinition",name="app_connection",field=models.ForeignKey(blank=True,null=True,on_delete=django.db.models.deletion.PROTECT,to="operations.reportapplicationconnection")),
    ]
