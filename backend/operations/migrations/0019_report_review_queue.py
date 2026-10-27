import re
import unicodedata

from django.db import migrations, models


def move_routines(apps, schema_editor):
    Report = apps.get_model("operations", "ReportDefinition")
    for report in Report.objects.filter(code__startswith="legacy123-").iterator():
        name = (
            unicodedata.normalize("NFKD", report.name)
            .encode("ascii", "ignore")
            .decode()
            .upper()
        )
        if re.search(r"\b(?:SINCR[A-Z]*|LIMPAR|LIMPEZA|APAGAR|EXCLUIR)(?:\b|_)", name):
            Report.objects.filter(pk=report.pk).update(review_queue=True, enabled=False)


class Migration(migrations.Migration):
    dependencies = [("operations", "0018_existing_report_history")]  # noqa: RUF012
    operations = [  # noqa: RUF012
        migrations.AddField(
            model_name="reportdefinition",
            name="review_queue",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(move_routines, migrations.RunPython.noop),
    ]
