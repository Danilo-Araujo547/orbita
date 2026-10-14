"""Exercise pg_dump/pg_restore in an isolated temporary database."""

import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

import psycopg
from migrate_to_postgres import MANAGE, PYTHON, ROOT, canonical, read_env
from psycopg import sql

config = read_env(ROOT / "secrets/postgres.env")
active = read_env(ROOT / ".env")
folder = Path((ROOT / "artifacts/postgres-migration-latest.txt").read_text().strip())
dump_path = folder / "postgres.dump"
binary_dir = Path(config["POSTGRES_BIN_DIR"])
pg_env = {**os.environ, "PGPASSWORD": config["DATABASE_PASSWORD"]}
connection_args = [
    "-h",
    config["DATABASE_HOST"],
    "-p",
    config["DATABASE_PORT"],
    "-U",
    config["DATABASE_USER"],
]
subprocess.run(
    [
        binary_dir / "pg_dump.exe",
        *connection_args,
        "-Fc",
        "--no-owner",
        "--no-acl",
        "-f",
        dump_path,
        config["DATABASE_NAME"],
    ],
    env=pg_env,
    check=True,
)
restore_name = "orbita_restore_" + datetime.now().strftime("%Y%m%d%H%M%S")
with psycopg.connect(
    host=config["DATABASE_HOST"],
    port=config["DATABASE_PORT"],
    dbname="postgres",
    user="orbita_admin",
    password=os.environ["ORBITA_PG_ADMIN_PASSWORD"],
    autocommit=True,
) as admin:
    admin.execute(
        sql.SQL("CREATE DATABASE {} OWNER {} TEMPLATE template0").format(
            sql.Identifier(restore_name), sql.Identifier(config["DATABASE_USER"])
        )
    )
    try:
        subprocess.run(
            [
                binary_dir / "pg_restore.exe",
                *connection_args,
                "--no-owner",
                "--no-acl",
                "--exit-on-error",
                "-d",
                restore_name,
                dump_path,
            ],
            env=pg_env,
            check=True,
        )
        restore_env = {**os.environ, **active, **config, "DATABASE_NAME": restore_name, "PYTHONUTF8": "1"}
        restored = folder / "restored.json"
        subprocess.run(
            [
                PYTHON,
                MANAGE,
                "dumpdata",
                "--all",
                "--natural-foreign",
                "--exclude",
                "contenttypes",
                "--exclude",
                "auth.permission",
                "--output",
                restored,
            ],
            env=restore_env,
            check=True,
        )
        assert canonical(restored) == canonical(folder / "postgres.json"), "Restored contents differ"
        (folder / "restore-verification.json").write_text(
            json.dumps(
                {"restored_and_verified": True, "dump": str(dump_path), "sha256": canonical(restored)[1]},
                indent=2,
            ),
            encoding="utf-8",
        )
        print("Backup PostgreSQL restaurado e conteúdo integral verificado.")
    finally:
        admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(restore_name)))
