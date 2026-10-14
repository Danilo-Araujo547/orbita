from celery import shared_task
from django.db.models import Q
from django.utils import timezone

from messaging.models import Message
from messaging.services import dispatch


@shared_task(name="messaging.dispatch_due")
def dispatch_due():
    now = timezone.now()
    ids = list(
        Message.objects.filter(state="queued", unit__paused=False)
        .filter(
            Q(scheduled_for__lte=now)
            | Q(group__schedule_overridden=True, group__scheduled_for__lte=now, attempt_count=0)
        )
        .filter(Q(group__isnull=True) | Q(group__next_send_at__isnull=True) | Q(group__next_send_at__lte=now))
        .order_by("scheduled_for", "created_at", "id")
        .values_list("id", flat=True)[:100]
    )
    for message_id in ids:
        dispatch(message_id)
