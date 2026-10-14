"""Copy a consistent local SQLite snapshot to an empty PostgreSQL database."""

import hashlib
import json
import os
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / ".venv/Scripts/python.exe"
MANAGE = ROOT / "backend/manage.py"


def read_env(path):
    result = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.partition("=")
        if separator and key and not key.startswith("#"):
            result[key] = value
    return result


def canonical(path):
    rows = json.loads(path.read_text(encoding="utf-8"))
    rows.sort(key=lambda row: (row["model"], str(row.get("pk"))))
    counts = {}
    for row in rows:
        counts[row["model"]] = counts.get(row["model"], 0) + 1
    encoded = json.dumps(rows, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return counts, hashlib.sha256(encoded).hexdigest()


if __name__ == "__main__":
    staged = read_env(ROOT / "secrets/postgres.env")
    active = read_env(ROOT / ".env")
    target_env = {**os.environ, **active, **staged, "PYTHONUTF8": "1"}
    source = ROOT / "backend/local.sqlite3"
    folder = ROOT / "artifacts" / ("postgres-migration-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    folder.mkdir()
    with sqlite3.connect(source) as original, sqlite3.connect(folder / "before.sqlite3") as snapshot:
        original.backup(snapshot)
        assert snapshot.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    (folder / "before.env").write_bytes((ROOT / ".env").read_bytes())
    source_env = {
        **os.environ,
        **active,
        "DATABASE_ENGINE": "sqlite",
        "SQLITE_PATH": str(folder / "before.sqlite3"),
        "PYTHONUTF8": "1",
    }
    fixture_args = [
        "dumpdata",
        "--all",
        "--natural-foreign",
        "--exclude",
        "contenttypes",
        "--exclude",
        "auth.permission",
    ]
    subprocess.run(
        [PYTHON, MANAGE, *fixture_args, "--output", folder / "source.json"], env=source_env, check=True
    )
    # Refuse to append a fixture to an already populated target.
    import psycopg

    with psycopg.connect(
        host=staged["DATABASE_HOST"],
        port=staged["DATABASE_PORT"],
        dbname=staged["DATABASE_NAME"],
        user=staged["DATABASE_USER"],
        password=staged["DATABASE_PASSWORD"],
    ) as pg:
        table_count = pg.execute(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
        ).fetchone()[0]
        if table_count:
            assert pg.execute("SELECT count(*) FROM core_unit").fetchone()[0] == 0, (
                "Target contains application data"
            )
            assert pg.execute("SELECT count(*) FROM auth_user").fetchone()[0] == 0, "Target contains users"
    subprocess.run([PYTHON, MANAGE, "migrate", "--noinput"], env=target_env, check=True)
    subprocess.run([PYTHON, MANAGE, "loaddata", folder / "source.json"], env=target_env, check=True)
    subprocess.run(
        [PYTHON, MANAGE, *fixture_args, "--output", folder / "postgres.json"], env=target_env, check=True
    )
    source_counts, source_hash = canonical(folder / "source.json")
    target_counts, target_hash = canonical(folder / "postgres.json")
    assert source_counts == target_counts, "Migration record counts differ"
    assert source_hash == target_hash, "Migration contents differ"
    result = {
        "snapshot": str(folder / "before.sqlite3"),
        "counts": target_counts,
        "source_sha256": source_hash,
        "target_sha256": target_hash,
        "identical": True,
        "target": {key: value for key, value in staged.items() if key != "DATABASE_PASSWORD"},
    }
    (folder / "verification.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (ROOT / "artifacts/postgres-migration-latest.txt").write_text(str(folder), encoding="utf-8")
    print(json.dumps({"verified": True, "records": sum(target_counts.values()), "directory": str(folder)}))
