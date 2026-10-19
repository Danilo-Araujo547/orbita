"""Create the replacement Flow without changing number encryption or existing Flows."""
import json
import os
import sys
from pathlib import Path

import django
import requests

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()
from messaging.models import MetaConfiguration
from messaging.meta_config import MetaReader, cipher

config = MetaConfiguration.objects.get(unit__slug="ame")
reader = MetaReader(config)
token = cipher().decrypt(config.token_ciphertext.encode()).decode()
headers = {"Authorization": "Bearer " + token}
flow_name, template_name = "Órbita — confirmação por webhook v2", "confirmacao_consulta_orbita_v2"
definition = (root / "backend/messaging/flows/confirmation_v2.json").read_bytes()

def post(path, **kwargs):
    response = requests.post(f"https://graph.facebook.com/{config.api_version}/{path}", headers=headers,
                             timeout=(5, 25), allow_redirects=False, **kwargs)
    data = response.json()
    if response.status_code >= 300 or "error" in data:
        error = data.get("error", {})
        print(json.dumps({"status": response.status_code, "code": error.get("code"), "detail": error.get("error_user_msg")}, ensure_ascii=True))
        raise RuntimeError("Meta operation rejected")
    return data

flows = reader.collection("flows", "id,name,status")
flow = next((f for f in flows if f["name"] == flow_name), None)
if not flow:
    flow = post(config.waba_id + "/flows", data={"name": flow_name, "categories": '["APPOINTMENT_BOOKING"]'})
    flow["status"] = "DRAFT"
if flow["status"] == "DRAFT":
    result = post(flow["id"] + "/assets", data={"name": "flow.json", "asset_type": "FLOW_JSON"},
                  files={"file": ("flow.json", definition, "application/json")})
    if result.get("validation_errors"):
        print(json.dumps({"validation_errors": result["validation_errors"]}))
        raise RuntimeError("Flow validation failed")
    post(flow["id"] + "/publish")
templates = MetaReader(config).collection("message_templates", "id,name,language,status,category,components")
template = next((t for t in templates if t["name"] == template_name and t["language"] == "pt_BR"), None)
if not template:
    template = post(config.waba_id + "/message_templates", json={
        "name": template_name, "language": "pt_BR", "category": "UTILITY", "components": [
            {"type": "BODY", "text": "Olá! Este é um teste de confirmação de agendamento do Órbita. Toque em Responder para confirmar ou recusar e deixar uma observação."},
            {"type": "BUTTONS", "buttons": [{"type": "FLOW", "text": "Responder", "flow_id": flow["id"],
                                              "flow_action": "NAVIGATE", "navigate_screen": "CONFIRMACAO"}]},
        ]})
summary = {"flow_id": flow["id"], "flow_name": flow_name, "template_name": template_name, "template_id": template.get("id"), "status": template.get("status")}
(root / "artifacts/confirmation-flow-v2.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=True))
