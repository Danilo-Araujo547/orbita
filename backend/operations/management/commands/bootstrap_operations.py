from core.models import Unit
from django.core.management.base import BaseCommand

from operations.catalog import seed_catalog


class Command(BaseCommand):
    help = "Cria o catálogo operacional por unidade, sem importar histórico ou liberar envios."

    def handle(self, *args, **options):
        for unit in Unit.objects.all():
            seed_catalog(unit)
        self.stdout.write("Catálogo operacional inicializado; envios não foram alterados.")
