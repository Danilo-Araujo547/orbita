from django.db import migrations


def forward(apps, schema_editor):
    Request = apps.get_model("operations", "ReportRequest")
    Execution = apps.get_model("operations", "ReportExecution")
    for item in Request.objects.all().iterator():
        job, created = Execution.objects.get_or_create(
            pk=item.pk,
            defaults={
                "unit_id": item.unit_id,
                "report_id": item.report_id,
                "requester_id": item.requester_id,
                "origin": "panel",
                "parameters": item.parameters,
                "definition_version": item.definition_version,
                "state": item.state,
                "format": item.format,
                "result": item.result,
                "error_code": item.error_code,
                "delivery_state": item.delivery_state,
                "completed_at": item.completed_at,
                "snapshot": {"previous_request": str(item.pk)},
            },
        )
        if created:
            Execution.objects.filter(pk=job.pk).update(created_at=item.created_at)


class Migration(migrations.Migration):
    dependencies = [("operations", "0017_preserve_legacy_recipients")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
