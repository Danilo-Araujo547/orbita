import hashlib
import json
from pathlib import Path
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from operations.models import ReportSnapshotConfiguration
from operations.legacy_bed_snapshots import import_history


class Command(BaseCommand):
    help = "Import verified legacy bed history without connecting to or modifying the legacy server."

    def add_arguments(self, parser):
        parser.add_argument("--unit", required=True)
        parser.add_argument("--configuration", required=True, type=int)
        parser.add_argument("--file", required=True)
        parser.add_argument("--actor", required=True)

    def handle(self, *args, **opts):
        path = Path(opts["file"])
        if not path.is_file() or path.stat().st_size > 10*1024*1024:
            raise CommandError("Arquivo indisponível ou acima de 10 MB.")
        data = path.read_bytes()
        try: payload = json.loads(data.decode("utf-8-sig"))
        except (ValueError, UnicodeError): raise CommandError("JSON inválido.") from None
        config = ReportSnapshotConfiguration.objects.get(pk=opts["configuration"], unit__slug=opts["unit"])
        actor = get_user_model().objects.get(username=opts["actor"], is_active=True)
        from operations.bed_snapshots import allowed_actor
        if not allowed_actor(actor, config.unit): raise CommandError("Administrador de relatórios necessário.")
        result = import_history(config, payload, checksum=hashlib.sha256(data).hexdigest(), actor=actor)
        self.stdout.write(json.dumps(result, ensure_ascii=False))
