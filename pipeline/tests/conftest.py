"""Shared fixtures. Database tests create a throwaway database next to TEST_DATABASE_URL (or DATABASE_URL)
and drop it afterwards; they are skipped when no Postgres is reachable."""
from __future__ import annotations

import os
import uuid

import psycopg
import pytest
from psycopg.conninfo import make_conninfo

from nba_pipeline.config import FIXTURES_DIR, database_url


@pytest.fixture(scope="session")
def admin_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL") or database_url(required=False)
    if not url:
        pytest.skip("no TEST_DATABASE_URL or DATABASE_URL: database tests skipped")
    try:
        psycopg.connect(url, connect_timeout=3).close()
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres not reachable: {e}")
    return url


@pytest.fixture(scope="session")
def temp_db(admin_url):
    name = f"nba_test_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(admin_url, autocommit=True) as c:
        c.execute(f'CREATE DATABASE "{name}"')
    url = make_conninfo(admin_url, dbname=name)
    try:
        yield url
    finally:
        with psycopg.connect(admin_url, autocommit=True) as c:
            c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture(scope="session")
def seeded_db(temp_db):
    from nba_pipeline.run import seed
    result = seed(FIXTURES_DIR, migrate_first=True, database_url=temp_db)
    assert result.errors == []
    return temp_db


def pytest_configure(config):
    config.addinivalue_line("markers", "db: needs a Postgres database")

