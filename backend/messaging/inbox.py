import base64
import hashlib
import hmac
import json
import shlex
import subprocess
from pathlib import Path

from core.models import Unit
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from responses.services import ingest_webhook

from messaging.meta_config import cipher
from messaging.models import Message, MetaConfiguration, MetaInboxCursor


def restrict_payload(payload, config, providers, tokens):
    entries = []
    for entry in payload.get("entry", []):
        if str(entry.get("id", "")) != config.waba_id:
            continue
        changes = []
        for change in entry.get("changes", []):
            value = change.get("value", {})
            if str(value.get("metadata", {}).get("phone_number_id", "")) != config.phone_number_id:
                continue
            statuses = [s for s in value.get("statuses", []) if s.get("id") in providers]
            messages = []
            for message in value.get("messages", []):
                match = message.get("context", {}).get("id") in providers
                try:
                    data = json.loads(
                        message.get("interactive", {}).get("nfm_reply", {}).get("response_json", "{}")
                    )
                    match = match or (isinstance(data, dict) and data.get("flow_token") in tokens)
                except (ValueError, TypeError):
                    pass
                if match:
                    messages.append(message)
            if statuses or messages:
                senders = {m.get("from") for m in messages}
                changes.append(
                    {
                        "field": "messages",
                        "value": {
                            "metadata": value.get("metadata", {}),
                            "statuses": statuses,
                            "messages": messages,
                            "contacts": [c for c in value.get("contacts", []) if c.get("wa_id") in senders],
                        },
                    }
                )
        if changes:
            entries.append({"id": config.waba_id, "changes": changes})
    return {"object": "whatsapp_business_account", "entry": entries}


def fetch_batch(query):
    source = Path(__file__).with_name("inbox_reader_remote.py").read_text(encoding="utf-8")
    remote = (
        "docker exec -i " + shlex.quote(settings.META_INBOX_CONTAINER) + " python -c " + shlex.quote(source)
    )
    result = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=5",
            settings.META_INBOX_SSH_USER + "@" + settings.META_INBOX_SSH_HOST,
            remote,
        ],
        input=json.dumps(query),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=20,
    )
    if result.returncode:
        raise ValueError("meta_inbox_connection_failed")
    if len(result.stdout) > 10_000_000:
        raise ValueError("meta_inbox_batch_too_large")
    return json.loads(result.stdout)


def pull_once(unit, reader=fetch_batch):
    config = MetaConfiguration.objects.get(unit=unit)
    if Message.objects.filter(unit=unit, state="sending").exists():
        return 0
    pairs = list(
        Message.objects.filter(
            unit=unit, channel_id=config.phone_number_id, provider_id__startswith="wamid."
        ).values_list("id", "provider_id")
    )
    if not pairs:
        return 0
    cursor, _ = MetaInboxCursor.objects.get_or_create(unit=unit)
    providers, tokens = {p[1] for p in pairs}, {str(p[0]) for p in pairs}
    batch = reader(
        {
            "after": cursor.position,
            "waba": config.waba_id,
            "channel": config.phone_number_id,
            "providers": sorted(providers),
            "tokens": sorted(tokens),
        }
    )
    position = int(batch["position"])
    if position < cursor.position:
        raise ValueError("meta_inbox_cursor_invalid")
    secret = cipher().decrypt(config.app_secret_ciphertext.encode())
    with transaction.atomic():
        Unit.objects.select_for_update(no_key=True).get(pk=unit.pk)
        current = MetaInboxCursor.objects.select_for_update().get(pk=cursor.pk)
        if current.position != cursor.position:
            return 0
        for event in batch["events"]:
            if not cursor.position < int(event["id"]) <= position:
                raise ValueError("meta_inbox_cursor_invalid")
            raw = base64.b64decode(event["raw"], validate=True)
            expected = "sha256=" + hmac.new(secret, raw, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, event["signature"]):
                raise ValueError("meta_inbox_invalid_signature")
            payload = restrict_payload(json.loads(raw), config, providers, tokens)
            ingest_webhook(payload, unit=unit, channel_id=config.phone_number_id, waba_id=config.waba_id)
        current.position, current.last_sync_at = position, timezone.now()
        current.save(update_fields=["position", "last_sync_at"])
    return len(batch["events"])
