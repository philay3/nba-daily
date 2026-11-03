"""Parity with the original engine: the fixture day (hoopR files as downloaded 2026-11-02) plus the golden
inputs must reproduce every golden JSON file (exactly, or within 0.05 for floats) and the digest text."""
from __future__ import annotations

import pytest
from helpers import DAY, GOLDEN, HOOPR, INPUTS, TEN, golden, same
from psycopg.rows import dict_row

from nba_pipeline.digest import render_digest
from nba_pipeline.export import dashboard_files, read_tables
from nba_pipeline.pbp import PREFIX
from nba_pipeline.run import run_day


@pytest.fixture(scope="module")
def built():
    return run_day(DAY, source_dir=HOOPR, inputs_dir=INPUTS, use_espn=False, offline=True, write=False)


@pytest.mark.parametrize("name", TEN)
def test_in_memory_matches_golden(built, name):
    ok, where = same(built.files[name], golden(name))
    assert ok, where


def test_in_memory_row_counts(built):
    assert {k: len(v) for k, v in built.files.items()} == {k: len(golden(k)) for k in TEN}


def test_digest_matches_golden(built):
    assert built.digest == (GOLDEN / "digest.txt").read_text()


def test_meta_matches_golden(built):
    meta = golden("meta")
    for k in ("today", "yesterday", "season", "notes", "last_night_scheduled", "last_night_missing", "missing_games",
              "last_night_games", "teams", "players", "box_rows", "tonight", "season_games"):
        assert built.build.meta[k] == meta[k], k


def test_finish_checks_clean(built):
    """The engine's finish checks. The play-by-play step's own notes (a known gap in ESPN's feed on this day) are
    checked in test_pbp.py."""
    assert built.errors == []
    assert [w for w in built.warnings if not w.startswith(PREFIX)] == []


@pytest.mark.db
@pytest.mark.parametrize("name", TEN)
def test_database_round_trip_matches_golden(seeded_db, name):
    import psycopg
    with psycopg.connect(seeded_db, row_factory=dict_row) as conn:
        files = dashboard_files(read_tables(conn, DAY))
    ok, where = same(files[name], golden(name))
    assert ok, where


@pytest.mark.db
def test_database_digest_matches_golden(seeded_db):
    import psycopg
    with psycopg.connect(seeded_db, row_factory=dict_row) as conn:
        text = render_digest(read_tables(conn, DAY))
    assert text == (GOLDEN / "digest.txt").read_text()
