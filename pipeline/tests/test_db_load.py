"""Load the fixture day into a temporary database and check the data holds together."""
from __future__ import annotations

import psycopg
import pytest
from psycopg.rows import dict_row

from helpers import GOLDEN

from nba_pipeline.config import FIXTURES_DIR
from nba_pipeline.db import migrate

pytestmark = pytest.mark.db

EXPECTED_COUNTS = {
    "teams": 30, "players": 461, "games": 1200, "team_games": 184, "player_games": 2509, "team_season": 30,
    "player_season": 442, "game_gaps": 2300, "player_game_deltas": 2072, "odds": 15, "injuries": 100, "editorial": 28,
}


@pytest.fixture(scope="module")
def conn(seeded_db):
    with psycopg.connect(seeded_db, row_factory=dict_row, autocommit=True) as c:
        yield c


def one(conn, sql, params=()):
    return conn.execute(sql, params).fetchone()


def test_row_counts(conn):
    for table, n in EXPECTED_COUNTS.items():
        assert one(conn, f"SELECT count(*) AS n FROM {table}")["n"] == n, table


def test_player_points_add_up_to_team_points(conn):
    bad = conn.execute("""
        SELECT tg.game_id, tg.team_code, tg.pts, sum(coalesce(pg.pts, 0)) AS players
        FROM team_games tg JOIN player_games pg USING (game_id, team_code)
        GROUP BY tg.game_id, tg.team_code, tg.pts
        HAVING sum(coalesce(pg.pts, 0)) <> tg.pts""").fetchall()
    assert bad == []


def test_period_scores_add_up_to_finals(conn):
    rows = conn.execute("""
        SELECT id, away_score, home_score,
               (SELECT sum(x) FROM unnest(away_periods) x) AS a, (SELECT sum(x) FROM unnest(home_periods) x) AS h,
               cardinality(away_periods) AS n, ot
        FROM games WHERE status = 'STATUS_FINAL'""").fetchall()
    assert len(rows) == 92
    for r in rows:
        assert (r["a"], r["h"]) == (r["away_score"], r["home_score"]), r["id"]
        assert r["n"] == 4 + r["ot"], r["id"]


def test_each_final_has_two_sides_and_one_winner(conn):
    bad = conn.execute("""
        SELECT g.id FROM games g JOIN team_games tg ON tg.game_id = g.id
        GROUP BY g.id HAVING count(*) <> 2 OR sum(tg.win::int) <> 1""").fetchall()
    assert bad == []
    assert one(conn, "SELECT count(*) AS n FROM games g WHERE winner_code IS NOT NULL")["n"] == 92


def test_possessions_are_shared_by_both_teams(conn):
    bad = conn.execute("""
        SELECT a.game_id FROM team_games a JOIN team_games b ON a.game_id = b.game_id AND a.team_code < b.team_code
        WHERE a.poss <> b.poss""").fetchall()
    assert bad == []


def test_season_records_match_box_scores(conn):
    bad = conn.execute("""
        SELECT ts.team_code FROM team_season ts
        JOIN (SELECT team_code, count(*) FILTER (WHERE win) AS w, count(*) FILTER (WHERE NOT win) AS l
              FROM team_games GROUP BY team_code) b USING (team_code)
        WHERE ts.w <> b.w OR ts.l <> b.l""").fetchall()
    assert bad == []


def test_injuries_link_to_players_and_games(conn):
    r = one(conn, "SELECT count(*) FILTER (WHERE player_id IS NOT NULL) AS matched, "
                  "count(*) FILTER (WHERE game_id IS NULL) AS no_game FROM injuries WHERE snapshot_date = '2026-11-02'")
    assert r["no_game"] == 0
    # every injured player the digest lists as "no games for X this season" is the one without a match
    unmatched = (GOLDEN / "digest.txt").read_text().count("(no games for ")
    assert (r["matched"], unmatched) == (57, 43)


def test_official_seeds_applied(conn):
    assert one(conn, "SELECT seed, record_seed, seed_source FROM team_season WHERE team_code = 'BOS'") == \
        {"seed": 3, "record_seed": 2, "seed_source": "official"}


def test_seed_is_idempotent(seeded_db):
    from nba_pipeline.run import seed
    with psycopg.connect(seeded_db, row_factory=dict_row, autocommit=True) as c:
        before = {t: one(c, f"SELECT count(*) AS n FROM {t}")["n"] for t in EXPECTED_COUNTS}
    res = seed(FIXTURES_DIR, migrate_first=True, database_url=seeded_db)
    assert res.errors == []
    with psycopg.connect(seeded_db, row_factory=dict_row, autocommit=True) as c:
        after = {t: one(c, f"SELECT count(*) AS n FROM {t}")["n"] for t in EXPECTED_COUNTS}
        runs = c.execute("SELECT status FROM pipeline_runs ORDER BY id").fetchall()
        assert migrate(c) == []  # nothing pending
    assert before == after == EXPECTED_COUNTS
    assert [r["status"] for r in runs] == ["ok", "ok"]


def test_migrations_are_drizzle_compatible(seeded_db):
    with psycopg.connect(seeded_db, row_factory=dict_row) as c:
        rows = c.execute('SELECT hash, created_at FROM drizzle."__drizzle_migrations"').fetchall()
    from nba_pipeline.db import read_migrations
    assert [(r["hash"], int(r["created_at"])) for r in rows] == [(m["hash"], m["when"]) for m in read_migrations()]
