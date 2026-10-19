from pathlib import Path

from core.models import Audit, Membership, Unit
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from operations.models import Campaign, Case, ImportLayout
from operations.sheets import confirm_sheet, preview_sheet


class Command(BaseCommand):
    help = "Import a reviewed absence HTML export and create a draft. Never queues messages."

    def add_arguments(self, parser):
        parser.add_argument("file")
        parser.add_argument("--unit", required=True)
        parser.add_argument("--actor", required=True)
        parser.add_argument("--layout", type=int, required=True)
        parser.add_argument("--name", required=True)
        parser.add_argument("--expected-count", type=int, required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        unit = Unit.objects.select_for_update().get(slug=options["unit"])
        membership = (
            Membership.objects.filter(
                unit=unit, role="admin", user__username=options["actor"], user__is_active=True
            )
            .select_related("user")
            .first()
        )
        if not membership:
            raise CommandError("Active unit administrator required.")
        layout = ImportLayout.objects.get(
            pk=options["layout"], unit=unit, format="absence_html", verified=True
        )
        path = Path(options["file"])
        if path.stat().st_size > 5 * 1024 * 1024:
            raise CommandError("File exceeds 5 MB.")
        batch = preview_sheet(unit, layout, membership.user, path.name, path.read_bytes())
        if batch.errors or len(batch.rows) != options["expected_count"]:
            raise CommandError("Preview errors or unexpected record count; no records imported.")
        if batch.state == "preview":
            ids = confirm_sheet(batch, "absence")
        else:
            ids = list(
                Case.objects.filter(
                    unit=unit,
                    purpose="absence",
                    event__source=f"absence:{layout.pk}",
                    event__external_id__in=[r["external_id"] for r in batch.rows],
                ).values_list("pk", flat=True)
            )
        campaign = Campaign.objects.filter(unit=unit, name=options["name"], purpose="absence").first()
        if campaign:
            if set(map(str, campaign.cases.values_list("pk", flat=True))) != set(map(str, ids)):
                raise CommandError("Campaign name already exists with different records.")
        else:
            campaign = Campaign.objects.create(unit=unit, name=options["name"], purpose="absence")
            campaign.cases.set(ids)
            Audit.objects.create(
                unit=unit,
                actor=membership.user,
                action="absence_campaign_imported",
                object_id=str(campaign.pk),
                details={"batch": str(batch.pk), "records": len(ids), "state": "draft"},
            )
        self.stdout.write(
            f"Campaign {campaign.pk}: {len(ids)} records; state={campaign.state}; no messages queued."
        )
