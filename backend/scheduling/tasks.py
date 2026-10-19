from celery import shared_task
from django.db import transaction
from django.utils import timezone
from responses.services import mark_no_response

from scheduling.connectors import appointment_source
from scheduling.models import ImportRun, Rule
from scheduling.services import import_rule


@shared_task(name="scheduling.run_rule")
def run_rule(rule_id):
    rule = Rule.objects.select_related("unit", "template").get(pk=rule_id)
    import_rule(rule, appointment_source(rule.unit), retry=True)


@shared_task(name="scheduling.tick")
def tick():
    now = timezone.now()
    # A crashed importer is not silently retried. Make it visible for individual intervention.
    ImportRun.objects.filter(status="running", started_at__lt=now - timezone.timedelta(minutes=10)).update(
        status="failed", error="interrupted_import", completed_at=now
    )
    for rule in Rule.objects.filter(enabled=True).select_related("unit", "template"):
        source = appointment_source(rule.unit)
        if all(source.credentials()):
            import_rule(rule, source, now, retry=True, refresh=True)
    mark_no_response(now)
    from messaging.models import Message
    from messaging.services import issue_once

    with transaction.atomic():
        Message.objects.filter(state="queued", expires_at__lte=now).update(state="expired")
        for message in Message.objects.select_for_update().filter(
            state="sending", last_attempt_at__lt=now - timezone.timedelta(minutes=2)
        ):
            message.state, message.error_code = "uncertain", "worker_interrupted"
            message.save()
            issue_once(
                message,
                "worker_interrupted",
                "Worker interrompido durante o envio; reenvio automático bloqueado.",
            )
