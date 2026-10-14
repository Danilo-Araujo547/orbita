"""Provision missing local instance identity/secrets without printing them."""

from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet

root = Path(__file__).resolve().parent.parent
path = root / ".env"
content = path.read_text(encoding="utf-8-sig")
defined = {line.split("=", 1)[0] for line in content.splitlines() if "=" in line}
for name, value in (
    ("ORBITA_INSTANCE_ID", str(uuid4())),
    ("INSTANCE_CREDENTIALS_KEY", Fernet.generate_key().decode()),
    ("META_CREDENTIALS_KEY", Fernet.generate_key().decode()),
):
    # Never replace an existing setting, even an explicitly blank one.
    if name not in defined:
        content = content.rstrip() + f"\n{name}={value}\n"
path.write_text(content, encoding="utf-8")
