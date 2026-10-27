from zoneinfo import ZoneInfo

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from operations.models import ReportRequest, ReportSchedule
from operations.reports import check_access, generate


@shared_task(name="operations.report", soft_time_limit=120, time_limit=150)
def run_report(job_id):
    generate(job_id)


@shared_task(name="operations.tick")
def tick():
    from operations.reporting import tick_reports

    tick_reports()
    from operations.connectors import run_flow
    from operations.models import FlowRule, FlowRun

    FlowRun.objects.filter(
        state="running", started_at__lt=timezone.now() - timezone.timedelta(minutes=10)
    ).update(
        state="failed", error_code="interrupted_import", completed_at=timezone.now()
    )
    for rule in FlowRule.objects.filter(enabled=True).select_related(
        "unit", "source", "template"
    ):
        run_flow(rule)
    for schedule_id in ReportSchedule.objects.filter(enabled=True).values_list(
        "id", flat=True
    ):
        with transaction.atomic():
            schedule = (
                ReportSchedule.objects.select_for_update()
                .select_related("unit", "report", "access__user")
                .get(pk=schedule_id)
            )
            now = timezone.localtime(timezone.now(), ZoneInfo(schedule.unit.timezone))
            if (
                now.weekday() not in schedule.weekdays
                or now.time() < schedule.send_time
                or schedule.last_run_date == now.date()
            ):
                continue
            job = ReportRequest(
                unit=schedule.unit,
                report=schedule.report,
                requester=schedule.access.user,
                access=schedule.access,
                parameters=schedule.parameters,
                definition_version=schedule.report.version,
                format="pdf",
                delivery_state="blocked_channel_not_configured",
            )
            try:
                check_access(job)
            except Exception:
                continue
            job.save()
            schedule.last_run_date = now.date()
            schedule.save(update_fields=["last_run_date"])
            from django.conf import settings

            if settings.ASYNC_TASKS:
                transaction.on_commit(
                    lambda job_id=str(job.pk): run_report.delay(job_id)
                )
            else:
                generate(job.pk)


# Register catalog execution tasks on worker startup.
from operations.report_whatsapp import deliver_report  # noqa: F401
from operations.reporting import execute_report  # noqa: F401

from operations.bed_snapshots import collect_snapshot, tick_snapshots  # noqa: F401
