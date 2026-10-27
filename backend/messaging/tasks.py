from celery import shared_task
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from messaging.models import Message
from messaging.services import dispatch


@shared_task(name="messaging.dispatch_due")
def dispatch_due():
    dispatch_manual_due()
    now = timezone.now()
    ids = list(
        Message.objects.filter(state="queued", unit__paused=False)
        .filter(
            **(
                {"snapshot__manual_group_real": True}
                if settings.SEND_MODE == "meta_test"
                else {}
            )
        )
        .filter(
            Q(scheduled_for__lte=now)
            | Q(
                group__schedule_overridden=True,
                group__scheduled_for__lte=now,
                attempt_count=0,
            )
        )
        .filter(
            Q(group__isnull=True)
            | Q(group__next_send_at__isnull=True)
            | Q(group__next_send_at__lte=now)
        )
        .order_by("scheduled_for", "created_at", "id")
        .values_list("id", flat=True)[:100]
    )
    for message_id in ids:
        dispatch(message_id)


def dispatch_manual_due():
    """Only groups explicitly released for simulation; never global unpause."""
    from django.conf import settings

    if settings.SEND_MODE not in {"simulated", "meta_test"}:
        return
    if settings.SEND_MODE == "meta_test" and not settings.META_REAL_ENABLED:
        return
    now = timezone.now()
    from operations.models import Campaign

    active_campaigns = list(
        Campaign.objects.filter(sends_enabled=True).values_list("pk", flat=True)
    )
    ids = list(
        Message.objects.filter(
            state="queued",
            scheduled_for__lte=now,
        )
        .filter(
            Q(snapshot__manual_group_simulation=True)
            if settings.SEND_MODE == "simulated"
            else (
                Q(snapshot__manual_group_real=True, unit__paused=False)
                | Q(
                    snapshot__manual_campaign_real=True,
                    snapshot__campaign__in=active_campaigns,
                    unit__paused=False,
                )
                | Q(
                    snapshot__has_key="cross_batch",
                    snapshot__campaign__in=active_campaigns,
                    unit__paused=False,
                )
            )
        )
        .filter(Q(group__next_send_at__isnull=True) | Q(group__next_send_at__lte=now))
        .order_by("scheduled_for", "created_at", "id")
        .values_list("pk", flat=True)[:100]
    )
    for message_id in ids:
        dispatch(message_id)
