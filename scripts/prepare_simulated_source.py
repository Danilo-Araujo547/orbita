"""Back up the local application DB and configure the separate SQLite source."""

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import django
from django.conf import settings

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

database = settings.DATABASES["default"]
if database["ENGINE"] != "django.db.backends.postgresql" or database["HOST"] != "127.0.0.1":
    raise RuntimeError("Local PostgreSQL required.")
backup = (
    root / "artifacts" / ("before-simulated-source-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".dump")
)
env = dict(os.environ, PGPASSWORD=database["PASSWORD"])
subprocess.run(
    [
        str(Path(os.environ["POSTGRES_BIN_DIR"]) / "pg_dump.exe"),
        "-h",
        database["HOST"],
        "-p",
        str(database["PORT"]),
        "-U",
        database["USER"],
        "-d",
        database["NAME"],
        "-Fc",
        "-f",
        str(backup),
    ],
    env=env,
    check=True,
    capture_output=True,
)
env_path = root / ".env"
lines = [
    line
    for line in env_path.read_text(encoding="utf-8-sig").splitlines()
    if not line.startswith(("SIMULATED_SQLITE_PATH=", "SIMULATED_SQLITE_UNIT="))
]
lines.extend(
    [
        "SIMULATED_SQLITE_PATH=" + (root / "data" / "simulated_appointments.sqlite3").as_posix(),
        "SIMULATED_SQLITE_UNIT=ame",
    ]
)
env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("Backup local criado. Fonte SQLite configurada para AME.")
