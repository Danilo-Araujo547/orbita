"""Migrate the local Oracle vault using its existing administrator credential, never logging secrets."""
import os
import sys
from pathlib import Path

import django

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()
from django.conf import settings
from django.db import transaction
from core.models import Audit, OracleConfiguration, Unit
from core.oracle_credentials import access, decrypt, derive, wrap_service_key

assert settings.DATABASES["default"]["HOST"] == "127.0.0.1"
password = os.getenv("BOOTSTRAP_PASSWORD", "")
with transaction.atomic():
    for config in OracleConfiguration.objects.select_related("owner", "unit"):
        Unit.objects.select_for_update().get(pk=config.unit_id)
        if config.service_key_ciphertext:
            config.operational_enabled = True
            decrypt(config, access(config)[0])
        else:
            if not password or not config.owner.check_password(password):
                raise RuntimeError("Administrator must activate the existing configuration in the panel.")
            key = derive(password, config.salt)
            decrypt(config, key)
            config.service_key_ciphertext = wrap_service_key(key)
            config.operational_enabled = True
        config.version += 1
        config.save(update_fields=["service_key_ciphertext", "operational_enabled", "version", "updated_at"])
        Audit.objects.create(unit=config.unit, actor=config.owner, action="oracle.continuous_access_enabled",
                             details={"version": config.version})
        print(f"Unidade {config.unit.slug}: acesso contínuo ativado; credenciais criptografadas preservadas.")
