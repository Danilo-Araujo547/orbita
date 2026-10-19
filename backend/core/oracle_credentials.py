"""Encrypted Oracle vault with a server-encrypted persistent service key."""

import base64
import hashlib
import json
import os
import time
from threading import RLock

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from django.conf import settings

TTL = 12 * 60 * 60
_memory = {}
_lock = RLock()


def derive(password, salt):
    return base64.urlsafe_b64encode(
        Scrypt(salt=base64.urlsafe_b64decode(salt), length=32, n=2**15, r=8, p=1).derive(password.encode())
    )


def encrypt(payload, password):
    salt = base64.urlsafe_b64encode(os.urandom(16)).decode()
    key = derive(password, salt)
    return salt, Fernet(key).encrypt(json.dumps(payload).encode()).decode(), key


def decrypt(config, key):
    try:
        return json.loads(Fernet(key).decrypt(config.ciphertext.encode()))
    except (InvalidToken, ValueError):
        raise ValueError("oracle_locked") from None


def service_cipher():
    try:
        return Fernet(settings.ORACLE_CREDENTIALS_KEY.encode())
    except (ValueError, TypeError, AttributeError):
        raise ValueError("oracle_service_key_unavailable") from None


def wrap_service_key(key):
    return service_cipher().encrypt(key).decode()


def access(config):
    if not config.operational_enabled:
        return None
    if config.service_key_ciphertext:
        try:
            key = service_cipher().decrypt(config.service_key_ciphertext.encode())
        except (InvalidToken, UnicodeError):
            raise ValueError("oracle_service_key_unavailable") from None
        return key, None
    return lease(config)


def cache_name(config):
    # Password changes invalidate the runtime lease, even before its expiry.
    fingerprint = hashlib.sha256(config.owner.password.encode()).hexdigest()
    return f"orbita:{settings.ORBITA_INSTANCE_ID}:oracle:{config.pk}:{config.version}:{fingerprint}"


def redis_client():
    import redis

    return redis.Redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2, socket_timeout=2)


def lease(config, key=None, remove=False):
    name = cache_name(config)
    if settings.ASYNC_TASKS:
        # Shared by API and workers. Redis only receives a server-encrypted lease,
        # not the password or a plaintext database credential/key.
        cipher = Fernet(settings.INSTANCE_CREDENTIALS_KEY.encode())
        try:
            client = redis_client()
            if remove:
                client.delete(name)
            elif key is not None:
                client.setex(name, TTL, cipher.encrypt(key))
            else:
                cached = client.get(name)
                remaining = client.ttl(name)
                return (cipher.decrypt(cached), time.time() + remaining) if cached and remaining > 0 else None
        except Exception:
            raise ValueError("oracle_unlock_cache_unavailable") from None
        return None
    with _lock:
        # Development uses a process-local cache. Restarting the API locks it.
        now = time.time()
        for old in [k for k, (_, expiry) in _memory.items() if expiry <= now]:
            _memory.pop(old, None)
        if remove:
            _memory.pop(name, None)
        elif key is not None:
            _memory[name] = (key, now + TTL)
        return _memory.get(name)


def unlocked(config):
    value = access(config)
    if not value:
        raise ValueError("oracle_locked")
    return decrypt(config, value[0])


def connection_payload(unit):
    from core.models import OracleConfiguration

    config = (
        OracleConfiguration.objects.select_related("owner")
        .filter(unit__slug=unit.slug if unit else "ame")
        .first()
    )
    return unlocked(config) if config else None


def connect(payload):
    import oracledb

    if settings.ORACLE_THICK and oracledb.is_thin_mode():
        oracledb.init_oracle_client(lib_dir=settings.ORACLE_CLIENT_DIR or None)
    target = {"service_name" if payload["identifier_type"] == "service" else "sid": payload["identifier"]}
    dsn = oracledb.makedsn(payload["host"], payload["port"], **target)
    params = oracledb.ConnectParams(tcp_connect_timeout=5, retry_count=0)
    connection = oracledb.connect(
        user=payload["username"], password=payload["password"], dsn=dsn, params=params
    )
    connection.call_timeout = payload["timeout_ms"]
    return connection
