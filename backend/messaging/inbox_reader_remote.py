"""Executed over SSH inside the existing receiver container. Read-only database access."""

import base64
import json
import sys

from database import connect

request = json.load(sys.stdin)
providers = set(request["providers"])
tokens = set(request["tokens"])
events = []
position = int(request["after"])
with connect() as connection:
    connection.execute("SET TRANSACTION READ ONLY")
    rows = connection.execute(
        "SELECT id, signature, raw_body FROM webhook_events WHERE id > %s AND waba_id = %s ORDER BY id LIMIT 100",
        (position, request["waba"]),
    ).fetchall()
    for event_id, signature, raw in rows:
        position = event_id
        raw = bytes(raw)
        payload = json.loads(raw)
        matched = False
        for entry in payload.get("entry", []):
            if str(entry.get("id", "")) != request["waba"]:
                continue
            for change in entry.get("changes", []):
                value = change.get("value", {})
                if str(value.get("metadata", {}).get("phone_number_id", "")) != request["channel"]:
                    continue
                if any(s.get("id") in providers for s in value.get("statuses", [])):
                    matched = True
                for message in value.get("messages", []):
                    if message.get("context", {}).get("id") in providers:
                        matched = True
                    try:
                        flow = json.loads(
                            message.get("interactive", {}).get("nfm_reply", {}).get("response_json", "{}")
                        )
                        if isinstance(flow, dict) and flow.get("flow_token") in tokens:
                            matched = True
                    except (ValueError, TypeError):
                        pass
        if matched:
            events.append({"id": event_id, "signature": signature, "raw": base64.b64encode(raw).decode()})
print(json.dumps({"position": position, "events": events}))
