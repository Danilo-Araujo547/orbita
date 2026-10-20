import uuid
from typing import Protocol

import requests
from django.conf import settings


class SendError(Exception):
    def __init__(self, code, transient=False, uncertain=False):
        self.code, self.transient, self.uncertain = code, transient, uncertain


class Transport(Protocol):
    channel_id: str

    def send(self, message) -> str: ...


class SimulatedTransport:
    channel_id = "simulated"

    def send(self, message):
        return "sim." + uuid.uuid4().hex


class MetaTransport:
    unit_id = None

    @property
    def channel_id(self):
        if self.unit_id:
            from messaging.models import MetaConfiguration

            return MetaConfiguration.objects.get(unit_id=self.unit_id).phone_number_id
        return settings.META_PHONE_NUMBER_ID

    def send(self, message):
        from messaging.meta_config import cipher
        from messaging.models import Attempt
        from messaging.pilot import configuration, enabled
        from messaging.services import send_guard

        if not enabled(message.unit):
            raise SendError("meta_sending_disabled")
        error = send_guard(message)
        if error:
            raise SendError(error)
        if (
            message.state != "sending"
            or not Attempt.objects.filter(
                message=message, number=message.attempt_count, completed_at=None
            ).exists()
        ):
            raise SendError("message_not_claimed")
        config = configuration(message.unit)
        components = []
        if message.parameters:
            components.append(
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": str(value)}
                        for value in message.parameters
                    ],
                }
            )
        for component in message.snapshot.get("components", []):
            if component.get("type") == "BUTTONS":
                for index, button in enumerate(component.get("buttons", [])):
                    if button.get("type") == "FLOW":
                        action = {"flow_token": str(message.pk)}
                        initial = message.snapshot.get("flow_action_data", {}).get(
                            str(index)
                        )
                        if initial is not None:
                            action["flow_action_data"] = initial
                        components.append(
                            {
                                "type": "button",
                                "sub_type": "flow",
                                "index": str(index),
                                "parameters": [{"type": "action", "action": action}],
                            }
                        )
        template = {
            "name": message.template_name,
            "language": {"code": message.template_language},
        }
        if components:
            template["components"] = components
        try:
            token = cipher().decrypt(config.token_ciphertext.encode()).decode()
            response = requests.post(
                f"https://graph.facebook.com/{config.api_version}/{config.phone_number_id}/messages",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": message.recipient,
                    "type": "template",
                    "template": template,
                },
                timeout=(5, 20),
                allow_redirects=False,
            )
        except requests.RequestException:
            raise SendError("meta_result_unknown", uncertain=True) from None
        if response.status_code >= 500 or 300 <= response.status_code < 400:
            raise SendError("meta_result_unknown", uncertain=True)
        try:
            data = response.json()
        except ValueError:
            raise SendError("meta_invalid_result", uncertain=True) from None
        if response.status_code >= 400 or "error" in data:
            code = data.get("error", {}).get("code") if isinstance(data, dict) else None
            raise SendError(
                f"meta_{code}" if isinstance(code, int) else "meta_request_rejected"
            )
        try:
            provider_id = data["messages"][0]["id"]
            if not isinstance(provider_id, str) or not provider_id.startswith("wamid."):
                raise ValueError()
            return provider_id
        except (KeyError, IndexError, TypeError, ValueError):
            raise SendError("meta_invalid_result", uncertain=True) from None


def get_transport():
    if settings.SEND_MODE == "simulated":
        return SimulatedTransport()
    if settings.SEND_MODE == "meta_test":
        return MetaTransport()
    raise SendError("unsupported_send_mode")
