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
    "game_previews": 29, "shots": 16255, "shot_games": 92, "league_shot_zones": 7, "team_shot_zones": 420,
    "player_shot_zones": 2996, "game_shot_zones": 1288, "game_flow": 92, "game_runs": 352, "lineup_games": 3429,
    "lineup_season": 2356, "player_on_off": 442, "team_clutch": 30, "player_clutch": 258, "power_ratings": 390,
    "model_days": 13, "model_games": 121, "model_backtest": 1, "model_calibration": 5, "stories": 154, "player_baselines": 2652,
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


def test_lineup_minutes_add_up_to_240_plus_25_per_overtime(conn):
    rows = conn.execute("""
        SELECT lg.game_id, lg.team_code, sum(lg.secs) * 5 / 60 AS player_minutes, 240 + 25 * g.ot AS expected,
               bool_and(cardinality(lg.player_ids) = 5) AS fives
        FROM lineup_games lg JOIN games g ON g.id = lg.game_id
        GROUP BY lg.game_id, lg.team_code, g.ot""").fetchall()
    assert len(rows) == 184
    for r in rows:
        assert abs(r["player_minutes"] - r["expected"]) < 0.05 and r["fives"], r


def test_game_flow_ends_at_the_final_score(conn):
    bad = conn.execute("""
        SELECT f.game_id FROM game_flow f JOIN games g ON g.id = f.game_id
        WHERE f.away[cardinality(f.away)] <> g.away_score OR f.home[cardinality(f.home)] <> g.home_score
           OR f.num_periods <> g.num_periods OR f.lead_changes <> g.lead_changes""").fetchall()
    assert bad == []


def test_lineup_season_sums_lineup_games(conn):
    bad = conn.execute("""
        SELECT s.team_code, s.lineup_id FROM lineup_season s
        JOIN (SELECT team_code, lineup_id, count(*) AS games, sum(pts) AS pts, sum(opp_pts) AS opp, sum(secs) AS secs
              FROM lineup_games GROUP BY team_code, lineup_id) g USING (team_code, lineup_id)
        WHERE s.games <> g.games OR s.pts <> g.pts OR s.opp_pts <> g.opp OR abs(s.secs - g.secs) > 0.5""").fetchall()
    assert bad == []
    assert one(conn, "SELECT count(*) AS n FROM lineup_season")["n"] == \
        one(conn, "SELECT count(*) AS n FROM (SELECT DISTINCT team_code, lineup_id FROM lineup_games) x")["n"]


def test_injuries_link_to_players_and_games(conn):
    r = one(conn, "SELECT count(*) FILTER (WHERE player_id IS NOT NULL) AS matched, "
                  "count(*) FILTER (WHERE game_id IS NULL) AS no_game FROM injuries WHERE snapshot_date = '2026-11-02'")
    assert r["no_game"] == 0
    # every injured player the digest lists as "no games for X this season" is the one without a match
    unmatched = (GOLDEN / "digest.txt").read_text().count("(no games for ")
    assert (r["matched"], unmatched) == (57, 43)


def test_past_dates_match_the_box_scores(conn):
    """Every date before the run: each final in `games` carries the box-score points of both teams and the winner."""
    rows = conn.execute("""
        SELECT g.id, g.away_score, g.home_score, g.winner_code, a.pts AS a_pts, h.pts AS h_pts,
               CASE WHEN a.pts > h.pts THEN g.away_code ELSE g.home_code END AS box_winner
        FROM games g
        JOIN team_games a ON a.game_id = g.id AND a.team_code = g.away_code
        JOIN team_games h ON h.game_id = g.id AND h.team_code = g.home_code
        WHERE g.game_date < '2026-11-02'""").fetchall()
    assert len(rows) == 92
    for r in rows:
        assert (r["away_score"], r["home_score"]) == (r["a_pts"], r["h_pts"]), r["id"]
        assert r["winner_code"] == r["box_winner"], r["id"]
    # and every final on the schedule before the run has its box score
    assert one(conn, "SELECT count(*) AS n FROM games WHERE status = 'STATUS_FINAL' AND game_date < '2026-11-02' "
                     "AND id NOT IN (SELECT game_id FROM team_games)")["n"] == 0


def test_previews_cover_the_next_three_days(conn):
    rows = conn.execute("SELECT game_date, count(*) AS n FROM game_previews WHERE snapshot_date = '2026-11-02' "
                        "GROUP BY game_date ORDER BY game_date").fetchall()
    sched = conn.execute("SELECT game_date, count(*) AS n FROM games WHERE game_date BETWEEN '2026-11-02' AND '2026-11-04' "
                         "GROUP BY game_date ORDER BY game_date").fetchall()
    assert rows == sched
    assert [(str(r["game_date"]), r["n"]) for r in rows] == [("2026-11-02", 15), ("2026-11-04", 14)]


def test_model_tables(conn):
    """Every final has a prediction made before its date; the look-ahead's games have one too, with tonight's line."""
    bad = conn.execute("SELECT g.id FROM games g LEFT JOIN model_games m ON m.game_id = g.id "
                       "WHERE g.status = 'STATUS_FINAL' AND g.game_date < '2026-11-02' AND m.game_id IS NULL").fetchall()
    assert bad == []
    assert one(conn, "SELECT count(*) AS n FROM model_games WHERE as_of > game_date")["n"] == 0
    assert one(conn, "SELECT count(*) AS n FROM model_games m JOIN game_previews p ON p.game_id = m.game_id "
                     "AND p.snapshot_date = '2026-11-02' AND m.actual_margin IS NULL")["n"] == 29
    # tonight's lines come from the golden odds.json
    assert one(conn, "SELECT count(*) AS n FROM model_games WHERE line_source = 'odds'")["n"] == 15
    per_day = conn.execute("SELECT as_of, count(*) AS n FROM power_ratings GROUP BY as_of").fetchall()
    assert per_day and all(r["n"] == 30 for r in per_day)
    days = one(conn, "SELECT count(*) AS n FROM model_days")["n"]
    assert days == len(per_day)
    bt = one(conn, "SELECT * FROM model_backtest WHERE season = 2027")
    assert bt["games"] == 92 and bt["line_games"] == 92
    assert one(conn, "SELECT sum(games) AS n FROM model_calibration WHERE season = 2027")["n"] == 92


def test_shots_match_box_scores(conn):
    rows = conn.execute("""
        SELECT tg.game_id, tg.team_code, tg.fga, tg.fgm, tg.tpm, tg.pts - tg.ftm AS fg_pts,
               count(s.seq) AS shots, count(*) FILTER (WHERE s.made) AS made,
               count(*) FILTER (WHERE s.made AND s.three) AS threes, coalesce(sum(s.points), 0) AS points
        FROM team_games tg LEFT JOIN shots s USING (game_id, team_code)
        GROUP BY tg.game_id, tg.team_code, tg.fga, tg.fgm, tg.tpm, tg.pts, tg.ftm""").fetchall()
    assert len(rows) == 184
    assert all((r["made"], r["threes"], r["points"]) == (r["fgm"], r["tpm"], r["fg_pts"]) for r in rows)
    assert sum(r["fga"] == r["shots"] for r in rows) == 174 and max(abs(r["fga"] - r["shots"]) for r in rows) == 1


def test_shot_zone_tables_agree(conn):
    # the "all" row of each table is the sum of its zones, and the stored game zones match the shots
    bad = conn.execute("""
        SELECT z.game_id, z.team_code FROM game_shot_zones z
        JOIN (SELECT game_id, team_code, zone, count(*) AS fga, count(*) FILTER (WHERE made) AS fgm, sum(points) AS pts
              FROM shots GROUP BY game_id, team_code, zone) s USING (game_id, team_code, zone)
        WHERE (z.fga, z.fgm, z.pts) <> (s.fga, s.fgm, s.pts)""").fetchall()
    assert bad == []
    for table, keys in (("league_shot_zones", "season"), ("team_shot_zones", "season, team_code, side"),
                        ("player_shot_zones", "season, player_id"), ("game_shot_zones", "game_id, team_code")):
        bad = conn.execute(f"""
            SELECT {keys} FROM {table} GROUP BY {keys}
            HAVING sum(fga) FILTER (WHERE zone = 'all') <> sum(fga) FILTER (WHERE zone <> 'all')
                OR sum(pts) FILTER (WHERE zone = 'all') <> sum(pts) FILTER (WHERE zone <> 'all')""").fetchall()
        assert bad == [], table


def test_shot_loader_rewrites_only_changed_games(seeded_db):
    import datetime as dt

    from helpers import HOOPR

    from nba_pipeline.compute import compute
    from nba_pipeline.load import load_shots
    from nba_pipeline.shots import build_shots
    from nba_pipeline.sources.hoopr import read_season, read_shots, season_paths, shots_path

    pb, tb, sc = read_season(season_paths(2027, HOOPR))
    build = compute(pb, tb, sc, dt.date(2026, 11, 2), 2027)
    raw = read_shots(shots_path(2027, HOOPR))
    gid = 401909906
    first = raw[(raw.game_id == gid) & ~raw.type_text.str.startswith("Free Throw")].index[0]
    changed = build_shots(raw.drop(index=first), build)  # ESPN drops one shot of one game
    with psycopg.connect(seeded_db, row_factory=dict_row) as c:
        with c.transaction(force_rollback=True):
            assert load_shots(c, build_shots(raw, build), 2027)["shot_games"] == 0  # same data: nothing to rewrite
            counts = load_shots(c, changed, 2027)
            assert counts["shot_games"] == 1 and counts["shots"] == 184
            assert one(c, "SELECT count(*) AS n FROM shots WHERE game_id = %s", (gid,))["n"] == 184
            assert one(c, "SELECT count(*) AS n FROM shots")["n"] == 16254
            # no shot file: the shot tables stay as they are
            assert load_shots(c, build_shots(None, build), 2027) == {}
            assert one(c, "SELECT count(*) AS n FROM shots")["n"] == 16254


def test_stories_point_at_real_lines(conn):
    """Every player story's game is one he played, and its stored line is that box score line."""
    bad = conn.execute("""
        SELECT s.story_id FROM stories s
        LEFT JOIN player_games pg ON pg.game_id = s.game_id AND pg.player_id = s.player_id
        WHERE s.player_id IS NOT NULL AND (pg.player_id IS NULL OR pg.did_not_play
              OR (s.evidence ? 'line' AND (s.evidence->'line'->>'pts')::int <> pg.pts))""").fetchall()
    assert bad == []
    bad = conn.execute("""
        SELECT s.story_id FROM stories s LEFT JOIN team_games tg ON tg.game_id = s.game_id AND tg.team_code = s.team_code
        WHERE tg.game_id IS NULL OR s.story_date <> tg.game_date""").fetchall()
    assert bad == []


def test_stories_are_ranked_by_score(conn):
    rows = conn.execute("SELECT story_date, rank, score FROM stories ORDER BY story_date, rank").fetchall()
    by_night = {}
    for r in rows:
        by_night.setdefault(r["story_date"], []).append(r)
    for night, rs in by_night.items():
        assert [r["rank"] for r in rs] == list(range(1, len(rs) + 1)) and len(rs) <= 20, night
        assert all(a["score"] >= b["score"] for a, b in zip(rs, rs[1:])), night


def test_official_seeds_applied(conn):
    assert one(conn, "SELECT seed, record_seed, seed_source FROM team_season WHERE team_code = 'BOS'") == \
        {"seed": 3, "record_seed": 2, "seed_source": "official"}


def test_seed_is_idempotent(seeded_db):
    from nba_pipeline.run import seed
    with psycopg.connect(seeded_db, row_factory=dict_row, autocommit=True) as c:
        before = {t: one(c, f"SELECT count(*) AS n FROM {t}")["n"] for t in EXPECTED_COUNTS}
        # a game ESPN has since taken off the schedule: the next run removes it
        c.execute("INSERT INTO games (id, season, season_type, game_date, code, away_code, home_code, status) "
                  "VALUES (1, 2027, 2, '2026-12-01', 'BOS@NYK', 'BOS', 'NYK', 'STATUS_SCHEDULED')")
    res = seed(FIXTURES_DIR, migrate_first=True, database_url=seeded_db)
    assert res.errors == []
    with psycopg.connect(seeded_db, row_factory=dict_row, autocommit=True) as c:
        after = {t: one(c, f"SELECT count(*) AS n FROM {t}")["n"] for t in EXPECTED_COUNTS}
        runs = c.execute("SELECT status FROM pipeline_runs ORDER BY id").fetchall()
        assert migrate(c) == []  # nothing pending
    assert before == after == EXPECTED_COUNTS
    assert res.counts["games_removed"] == 1
    assert [r["status"] for r in runs] == ["ok", "ok"]


def test_migrations_are_drizzle_compatible(seeded_db):
    with psycopg.connect(seeded_db, row_factory=dict_row) as c:
        rows = c.execute('SELECT hash, created_at FROM drizzle."__drizzle_migrations"').fetchall()
    from nba_pipeline.db import read_migrations
    assert [(r["hash"], int(r["created_at"])) for r in rows] == [(m["hash"], m["when"]) for m in read_migrations()]
