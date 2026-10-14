from core.models import Audit
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from responses.models import Issue

from operations.models import Case
from operations.services import log


class Command(BaseCommand):
    help = "Recalcula confirmações existentes sem apagar respostas ou criar envios."

    @transaction.atomic
    def handle(self, *args, **options):
        changed = 0
        for case in (
            Case.objects.select_for_update().filter(purpose="appointment").exclude(outcome="confirmed")
        ):
            latest = {}
            for action in case.interactions.filter(kind="classification").order_by("-occurred_at", "-id"):
                if (
                    action.data.get("historical")
                    or action.data.get("revision", case.event.revision) != case.event.revision
                ):
                    continue
                phone = action.data.get("phone", "")
                if not phone:
                    break
                latest.setdefault(phone, action.outcome)
            if "confirmed" not in latest.values():
                continue
            previous = case.outcome
            case.outcome, case.response_state, case.due_at = "confirmed", "answered", None
            case.version += 1
            case.save(update_fields=["outcome", "response_state", "due_at", "version", "updated_at"])
            Issue.objects.filter(case=case, category="conflicting_replies", resolved_at__isnull=True).update(
                resolved_at=timezone.now(), resolution="Agendamento confirmado por pelo menos um contato."
            )
            log(
                case,
                "policy_recalculation",
                "Confirmação de um contato tem prioridade no agendamento.",
                outcome="confirmed",
                data={"previous_outcome": previous, "policy": "any_contact_confirms"},
            )
            Audit.objects.create(
                unit=case.unit,
                action="case.confirmation_recalculated",
                object_id=str(case.pk),
                details={"previous_outcome": previous, "policy": "any_contact_confirms"},
            )
            changed += 1
        self.stdout.write(f"Agendamentos recalculados: {changed}. Nenhuma mensagem enviada.")
