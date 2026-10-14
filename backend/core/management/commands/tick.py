from django.core.management.base import BaseCommand
from messaging.tasks import dispatch_due
from scheduling.tasks import tick


class Command(BaseCommand):
    help = "Executa um ciclo local das tarefas, sem exigir broker. Respeita pausa e lista autorizada."

    def handle(self, *args, **options):
        tick()
        from operations.tasks import tick as operations_tick

        operations_tick()
        dispatch_due()
        self.stdout.write("Ciclo concluído.")
