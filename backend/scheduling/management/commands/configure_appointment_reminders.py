from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from core.models import Audit, Unit
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from messaging.models import Message, Template
from scheduling.models import Appointment, Rule
from scheduling.services import PENDING, queue_appointment


class Command(BaseCommand):
    help = "Configure one reminder per appointment type, preserving history and transport settings."

    def add_arguments(self, parser):
        parser.add_argument("--unit", required=True)
        parser.add_argument("--days", type=int, default=5)
        parser.add_argument("--refresh-minutes", type=int, default=5)
        parser.add_argument("--disabled", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        days, interval = options["days"], options["refresh_minutes"]
        if not 1 <= days <= 365 or not 1 <= interval <= 1440:
            raise CommandError("Invalid days or refresh interval.")
        unit = Unit.objects.select_for_update(no_key=True).get(slug=options["unit"])
        now = timezone.now()
        counts = {"rules": 0, "cancelled": 0, "appointments_prepared": 0}
        for kind, label, hour in [
            ("consultation", "Consultas", "07:15"),
            ("exam", "Exames", "07:30"),
            ("lab", "Laboratório", "07:35"),
        ]:
            old = Rule.objects.filter(unit=unit, kind=kind).order_by("-enabled", "id").first()
            template = (
                old.template if old else Template.objects.filter(unit=unit, purpose="appointment").first()
            )
            if not template:
                raise CommandError("Configure an appointment template for this unit first.")
            rule, created = Rule.objects.get_or_create(
                unit=unit,
                code=f"{kind}-reminder",
                defaults={
                    "name": label,
                    "kind": kind,
                    "days_before": days,
                    "send_time": time.fromisoformat(hour),
                    "weekdays": list(range(7)),
                    "refresh_interval_minutes": interval,
                    "enabled": not options["disabled"],
                    "template": template,
                    "evidence": "Política de antecedência configurada pelo administrador.",
                },
            )
            others = Rule.objects.filter(unit=unit, kind=kind).exclude(pk=rule.pk)
            others.update(enabled=False)
            pending = Message.objects.filter(rule__in=others, state__in=PENDING)
            counts["cancelled"] += pending.update(state="cancelled")
            if not created:
                pending = Message.objects.filter(rule=rule, state__in=PENDING)
                counts["cancelled"] += pending.update(state="cancelled")
                rule.days_before, rule.refresh_interval_minutes = days, interval
                rule.enabled, rule.weekdays = not options["disabled"], list(range(7))
                rule.version += 1
                rule.save()
            counts["rules"] += 1
            # Rebuild only unsent reminders for known future appointments; never release a group.
            for appointment in Appointment.objects.filter(
                unit=unit, kind=kind, status="scheduled", scheduled_at__gt=now
            ):
                if Message.objects.filter(
                    appointment=appointment,
                    state__in=["accepted", "sent", "delivered", "read", "sending", "uncertain"],
                ).exists():
                    continue
                day = appointment.scheduled_at.astimezone(ZoneInfo(unit.timezone)).date() - timedelta(
                    days=days
                )
                stamp = datetime.combine(day, rule.send_time, ZoneInfo(unit.timezone))
                if day < now.astimezone(ZoneInfo(unit.timezone)).date():
                    continue
                queue_appointment(appointment, rule, stamp, now)
                Message.objects.filter(
                    appointment=appointment,
                    rule=rule,
                    rule_version=rule.version,
                    state="queued",
                    attempt_count=0,
                ).update(state="preview")
                counts["appointments_prepared"] += 1
        Audit.objects.create(
            unit=unit,
            action="reminders.policy_configured",
            details={"days_before": days, "refresh_interval_minutes": interval, **counts},
        )
        self.stdout.write(str(counts) + "; no groups released; transport unchanged.")
