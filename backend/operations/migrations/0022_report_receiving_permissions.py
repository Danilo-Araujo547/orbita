from django.db import migrations
from django.db.models import Q


def promote_receivable_reports(apps, schema_editor):
    Report = apps.get_model("operations", "ReportDefinition")
    Grant = apps.get_model("operations", "ReportGrant")
    receiving = set(Grant.objects.filter(Q(manual=True) | Q(automatic=True)).values_list("report_id", flat=True))
    receiving.update(Report.objects.filter(reportaccess__isnull=False).values_list("id", flat=True))
    # Classification does not imply readiness. Preserve enabled/reviewed/review_queue,
    # SQL, legacy definitions, schedules and existing permissions exactly as stored.
    Report.objects.filter(pk__in=receiving).update(catalog_kind="report")


class Migration(migrations.Migration):
    dependencies = [("operations", "0021_report_catalog_kind")]
    operations = [migrations.RunPython(promote_receivable_reports, migrations.RunPython.noop)]
