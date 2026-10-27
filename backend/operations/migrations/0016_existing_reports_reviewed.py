from django.db import migrations


def forward(apps, schema_editor):
    apps.get_model("operations", "ReportDefinition").objects.filter(
        source="local"
    ).update(reviewed=True)


class Migration(migrations.Migration):
    dependencies = [("operations", "0015_report_catalog_connections")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
