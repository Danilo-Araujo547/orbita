import uuid
from typing import Protocol

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
    @property
    def channel_id(self):
        return settings.META_PHONE_NUMBER_ID

    def send(self, message):
        # Intentionally unconditional. Credentials and read-only checks never enable sending.
        # This also blocks direct callers and report media uploads, independently of SEND_MODE.
        raise SendError("meta_sending_disabled")


def get_transport():
    if settings.SEND_MODE == "simulated":
        return SimulatedTransport()
    if settings.SEND_MODE == "meta_test":
        return MetaTransport()
    raise SendError("unsupported_send_mode")
