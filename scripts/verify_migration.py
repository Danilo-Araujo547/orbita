"""Exercise backup, migrations and restore on private copies; never replace the live database."""

import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

root = Path(__file__).resolve().parent.parent
folder = root / "artifacts" / ("migration-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
folder.mkdir(parents=True)
source = root / "backend" / "local.sqlite3"
backup, trial, restored = [
    folder / name for name in ("before.sqlite3", "migrated.sqlite3", "restored.sqlite3")
]


def counts(connection):
    names = [r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    return {
        name: connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
        for name in names
        if name.startswith(("scheduling_", "messaging_", "responses_", "operations_"))
    }


with (
    sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as connection,
    sqlite3.connect(backup) as target,
):
    before = counts(connection)
    connection.backup(target)
with sqlite3.connect(backup) as connection, sqlite3.connect(trial) as target:
    connection.backup(target)
env = {**os.environ, "SQLITE_PATH": str(trial), "DATABASE_ENGINE": "sqlite"}
env.pop("DATABASE_HOST", None)
subprocess.run([sys.executable, str(root / "backend/manage.py"), "migrate", "--noinput"], env=env, check=True)
with sqlite3.connect(trial) as connection, sqlite3.connect(restored) as target:
    after = counts(connection)
    assert all(after[name] == total for name, total in before.items() if name != "django_migrations"), (
        "Existing record count changed"
    )
    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    connection.backup(target)
with sqlite3.connect(restored) as connection:
    assert counts(connection) == after
    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
result = {
    "backup": str(backup),
    "migration_copy": str(trial),
    "restored_copy": str(restored),
    "existing_counts_preserved": True,
    "restored_counts_match": True,
    "integrity": "ok",
    "counts": after,
}
(folder / "verification.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
