"""Load the local development configuration without overriding process variables."""

import os
from pathlib import Path


def load_local_env():
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.replace("_", "").isalnum() and key[0].isalpha():
                os.environ.setdefault(key, value)
