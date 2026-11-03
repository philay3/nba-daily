"""Postgres connection and a migrator compatible with drizzle-kit.

`migrate()` applies web/drizzle/*.sql in journal order and records them in
drizzle.__drizzle_migrations exactly like drizzle-orm's migrator (same hash,
same created_at), so `npm run db:migrate` and `python -m nba_pipeline migrate`
can be used interchangeably on the same database.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from nba_pipeline.config import MIGRATIONS_DIR, database_url

MIGRATIONS_SCHEMA = "drizzle"
MIGRATIONS_TABLE = "__drizzle_migrations"


def connect(url: str | None = None, autocommit: bool = False) -> psycopg.Connection:
    return psycopg.connect(url or database_url(), autocommit=autocommit, row_factory=dict_row)


def read_migrations(folder: Path = MIGRATIONS_DIR) -> list[dict]:
    journal = json.loads((folder / "meta" / "_journal.json").read_text())
    out = []
    for entry in journal["entries"]:
        raw = (folder / f"{entry['tag']}.sql").read_bytes()
        query = raw.decode("utf-8")
        out.append(dict(tag=entry["tag"], when=int(entry["when"]), hash=hashlib.sha256(raw).hexdigest(),
                        statements=query.split("--> statement-breakpoint")))
    return out


def migrate(conn: psycopg.Connection, folder: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply pending migrations in one transaction. Returns the tags applied."""
    applied = []
    with conn.transaction():
        conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{MIGRATIONS_SCHEMA}"')
        conn.execute(f'CREATE TABLE IF NOT EXISTS "{MIGRATIONS_SCHEMA}"."{MIGRATIONS_TABLE}" '
                     "(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)")
        last = conn.execute(f'SELECT created_at FROM "{MIGRATIONS_SCHEMA}"."{MIGRATIONS_TABLE}" '
                            "ORDER BY created_at DESC LIMIT 1").fetchone()
        last_when = int(last["created_at"]) if last else None
        for m in read_migrations(folder):
            if last_when is not None and last_when >= m["when"]:
                continue
            for stmt in m["statements"]:
                if stmt.strip():
                    conn.execute(stmt)
            conn.execute(f'INSERT INTO "{MIGRATIONS_SCHEMA}"."{MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (%s, %s)',
                         (m["hash"], m["when"]))
            applied.append(m["tag"])
    return applied
