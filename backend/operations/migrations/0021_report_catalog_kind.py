from django.db import migrations, models


def classify_catalog(apps, schema_editor):
    Report = apps.get_model("operations", "ReportDefinition")
    Grant = apps.get_model("operations", "ReportGrant")
    Automation = apps.get_model("operations", "ReportAutomation")
    Schedule = apps.get_model("operations", "ReportSchedule")
    from django.db.models import Q
    delivery_ids = set(Grant.objects.filter(Q(manual=True) | Q(automatic=True)).values_list("report_id", flat=True))
    delivery_ids.update(Automation.objects.values_list("report_id", flat=True))
    delivery_ids.update(Schedule.objects.values_list("report_id", flat=True))
    for report in Report.objects.all().iterator():
        legacy = report.legacy or {}
        record = legacy.get("record", {})
        internal = (
            report.review_queue
            or report.source == "legacy_pending"
            or str(record.get("RETORNO_TEXTO", "")).upper() == "S"
            or report.code.startswith("medical-")
            or "CABECALHO" in report.name.upper()
            or "RODAPE" in report.name.upper()
        )
        final = not internal and (
            report.source == "local"
            or report.pk in delivery_ids
            or not legacy
        )
        report.catalog_kind = "report" if final else "component"
        report.save(update_fields=["catalog_kind"])
        if not final:
            # Preserve legacy links and grants for investigation, but never schedule a component.
            Automation.objects.filter(report_id=report.pk, enabled=True).update(enabled=False)
            Schedule.objects.filter(report_id=report.pk, enabled=True).update(enabled=False)


class Migration(migrations.Migration):
    dependencies = [("operations", "0020_report_whatsapp_channel")]
    operations = [
        migrations.AddField(
            model_name="reportdefinition", name="catalog_kind",
            field=models.CharField(max_length=12, default="report", db_index=True,
                choices=[("report", "Relatório"), ("component", "Componente")]),
        ),
        migrations.RunPython(classify_catalog, migrations.RunPython.noop),
    ]
