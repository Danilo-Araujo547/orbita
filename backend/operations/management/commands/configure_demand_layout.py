from core.models import Audit, Membership, Unit
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from operations.models import ImportLayout


class Command(BaseCommand):
    help = "Register the reviewed CROSS demanda CSV model. Does not import records or create messages."

    def add_arguments(self, parser):
        parser.add_argument("--unit", required=True)
        parser.add_argument("--actor", required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        unit = Unit.objects.select_for_update().get(slug=options["unit"])
        user = (
            get_user_model()
            .objects.filter(username=options["actor"], is_active=True)
            .first()
        )
        if not user or not (
            user.is_superuser
            or Membership.objects.filter(user=user, unit=unit, role="admin").exists()
        ):
            raise CommandError("Active unit administrator required.")
        name = "Demanda por recurso (CROSS)"
        previous = (
            ImportLayout.objects.filter(unit=unit, name=name)
            .order_by("-version")
            .first()
        )
        if previous and previous.format == "cross_demand_csv":
            self.stdout.write(
                f"Layout {previous.pk}: already registered; no data imported."
            )
            return
        layout = ImportLayout.objects.create(
            unit=unit,
            name=name,
            version=previous.version + 1 if previous else 1,
            format="cross_demand_csv",
            mapping={},
            verified=True,
            evidence="31-column CSV structure validated; UTF-8/Windows-1252, entry date and multiple phone fields. Communication eligibility requires separate review.",
        )
        Audit.objects.create(
            unit=unit,
            actor=user,
            action="cross_demand_layout_registered",
            object_id=str(layout.pk),
            details={
                "format": layout.format,
                "version": layout.version,
                "records_imported": 0,
                "messages_created": 0,
            },
        )
        self.stdout.write(
            f"Layout {layout.pk}: registered; no records imported or messages created."
        )
