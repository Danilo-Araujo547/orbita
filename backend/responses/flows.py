"""Validate completed Flow responses without guessing which appointment they concern."""

import json
from uuid import UUID

from messaging.models import Message
from messaging.pilot import CONFIRMATION_TEMPLATE_V2


def parse_flow_reply(message, unit, channel):
    raw = message.get("interactive", {}).get("nfm_reply", {}).get("response_json", "")
    context = message.get("context", {}).get("id")
    extra = {"flow_response_raw": str(raw)[:8000]}
    invalid = ("[Resposta de formulário requer revisão]", "invalid-flow-context", "", extra)
    try:
        if not isinstance(raw, str) or len(raw) > 8000:
            return invalid
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get("formulario") != "orbita_confirmacao_v2":
            return invalid
        token = UUID(data["flow_token"])
        decision = data["decisao"]
        observation = data.get("observacao", "")
        if decision not in {"sim", "nao"} or not isinstance(observation, str) or len(observation) > 600:
            return invalid
        target = Message.objects.filter(
            pk=token,
            unit=unit,
            channel_id=channel,
            recipient=message.get("from"),
            template_name=CONFIRMATION_TEMPLATE_V2,
            state__in=["accepted", "sent", "delivered", "read"],
            provider_id__startswith="wamid.",
        ).first()
        if not target or (context and context != target.provider_id):
            return invalid
    except (ValueError, TypeError, KeyError, AttributeError):
        return invalid
    extra.update(flow_response=data, flow_observation=observation.strip())
    text = "SIM" if decision == "sim" else "NAO"
    if observation.strip():
        text += "\nObservação: " + observation.strip()
    return text, target.provider_id, "confirmed" if decision == "sim" else "declined", extra
