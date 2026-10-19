"""Switch the pilot to the reviewed Flow; pause until Meta approves its template."""
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import django

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import F
from django.test import override_settings
from django.utils import timezone
from core.models import Audit, Unit
from messaging.meta_config import MetaReader
from messaging.models import MetaConfiguration, Message
from messaging.pilot import CONFIRMATION_TEMPLATE_V2, prepare

unit = Unit.objects.get(slug="ame")
config = MetaConfiguration.objects.get(unit=unit)
account, phone, templates = MetaReader(config).validate()
approved = any(t["name"] == CONFIRMATION_TEMPLATE_V2 and t["language"] == "pt_BR" and t["status"] == "APPROVED" for t in templates)
db = settings.DATABASES["default"]
assert db["ENGINE"] == "django.db.backends.postgresql" and db["HOST"] == "127.0.0.1"
backup = root / "artifacts" / ("before-flow-v2-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".dump")
subprocess.run([str(Path(os.environ["POSTGRES_BIN_DIR"]) / "pg_dump.exe"), "-h", db["HOST"], "-p", str(db["PORT"]),
                "-U", db["USER"], "-d", db["NAME"], "-Fc", "-f", str(backup)],
               env=dict(os.environ, PGPASSWORD=db["PASSWORD"]), check=True, capture_output=True)
values = {"META_PILOT_TEMPLATE": CONFIRMATION_TEMPLATE_V2, "META_INBOX_SSH_HOST": "179.199.154.87",
          "META_INBOX_SSH_USER": "root", "META_INBOX_CONTAINER": "meta-whatsapp-webhook"}
env_path = root / ".env"
original_env = env_path.read_bytes()
try:
    with override_settings(META_PILOT_TEMPLATE=CONFIRMATION_TEMPLATE_V2), transaction.atomic():
        unit = Unit.objects.select_for_update().get(pk=unit.pk)
        unit.paused = not approved
        unit.save(update_fields=["paused"])
        config.templates, config.checked_at = templates, timezone.now()
        config.templates_synced_at = config.checked_at
        config.validation_state, config.validation_code = "valid", ""
        config.version += 1
        config.save()
        count = 0
        for message in Message.objects.filter(unit=unit, attempt_count=0, state__in=["queued", "preview", "blocked"],
                appointment_revision=F("appointment__revision")).select_related("unit", "appointment", "template"):
            message.snapshot.update(manual_group_real=False, manual_group_simulation=False)
            if approved:
                prepare(message)
            message.save(update_fields=["snapshot", "template", "template_name", "template_language", "body", "parameters"])
            count += 1
        lines = [line for line in original_env.decode("utf-8-sig").splitlines() if line.partition("=")[0] not in values]
        lines.extend(f"{key}={value}" for key,value in values.items())
        env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        Audit.objects.create(unit=unit, actor=get_user_model().objects.get(username="admin"), action="meta.flow_v2_configured",
            details={"template": CONFIRMATION_TEMPLATE_V2, "approved": approved, "paused": unit.paused,
                     "pending_messages": count, "manual_groups_only": True, "backup": backup.name})
except Exception:
    env_path.write_bytes(original_env)
    raise
print(f"Template aprovado: {approved}. Unidade pausada: {unit.paused}. Mensagens pendentes preservadas: {count}. Nenhum envio disparado.")
