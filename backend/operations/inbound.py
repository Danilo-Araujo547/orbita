from core.models import Membership
from django.conf import settings
from django.db import transaction

from operations.models import ReportAccess, ReportRequest
from operations.reports import check_access, generate, validate_parameters


def request_report(event, unit):
    """Only an explicit command is intercepted; never consume ordinary patient replies."""
    from operations.reporting import inbound_catalog

    if inbound_catalog(event, unit):
        return True
    text = event.data.get("text", "").strip()
    pieces = text.split()
    if not pieces or pieces[0].upper() != "RELATORIO":
        return False
    access = (
        ReportAccess.objects.filter(
            unit=unit,
            phone=event.data.get("sender"),
            active=True,
            verified_at__isnull=False,
            user__is_active=True,
        )
        .select_related("user")
        .first()
    )
    if not access or not (
        access.user.is_superuser
        or Membership.objects.filter(unit=unit, user=access.user).exists()
    ):
        # Generic acknowledgment only; no catalog or private result is disclosed.
        event.data = {**event.data, "report_command_result": "unavailable"}
        event.processed = True
        event.save(update_fields=["data", "processed"])
        return True
    report = access.reports.filter(
        unit=unit, keyword__iexact=pieces[1] if len(pieces) > 1 else "", enabled=True
    ).first()
    if not report:
        event.data = {**event.data, "report_command_result": "unavailable"}
        event.processed = True
        event.save(update_fields=["data", "processed"])
        return True
    params = {}
    try:
        if len(pieces) not in {2, 4}:
            raise ValueError()
        if len(pieces) == 4:
            params = validate_parameters({"start": pieces[2], "end": pieces[3]})
        job = ReportRequest(
            unit=unit,
            report=report,
            requester=access.user,
            access=access,
            parameters=params,
            definition_version=report.version,
            format="pdf",
            inbound_event=event,
            delivery_state="blocked_channel_not_configured",
        )
        check_access(job)
        job.save()
        if settings.ASYNC_TASKS:
            from operations.tasks import run_report

            transaction.on_commit(lambda: run_report.delay(str(job.pk)))
        else:
            generate(job.pk)
        event.data = {**event.data, "report_command_result": "requested"}
    except Exception:
        event.data = {**event.data, "report_command_result": "unavailable"}
    event.processed = True
    event.save(update_fields=["data", "processed"])
    return True
