"""Idempotent load of a build into Postgres, in one transaction.

- Facts (teams, players, games, team_games, player_games) are upserted by primary key; box rows that a
  newer source no longer has (for example a patched game later replaced by the mirror) are removed.
- Shots are facts too, but a season has about 220,000, so they are rewritten only for games whose shots
  changed (shot_games keeps a hash per game). Without a shot file the shot tables are left alone.
- Season tables and per-game derived tables are rebuilt for the season.
- Snapshots (odds, injuries, editorial, game_previews) replace that date's rows.
- Games that left this season's schedule without being played are deleted (with their odds and previews).
- Play-by-play tables (game flow, runs, lineups, on/off, clutch) are rebuilt for the season when the run has them.
Running the same day twice leaves the database unchanged.
"""
from __future__ import annotations

import datetime as dt

import psycopg
from psycopg.types.json import Jsonb

from nba_pipeline.compute import Build
from nba_pipeline.shots import SHOT_COLUMNS, ShotBuild

KEYS = {
    "teams": ["code"],
    "players": ["id"],
    "games": ["id"],
    "team_games": ["game_id", "team_code"],
    "player_games": ["game_id", "player_id"],
}
NO_UPDATED_AT = {"game_gaps", "player_game_deltas", "pipeline_runs", "odds", "injuries", "game_previews",
                 "game_flow", "game_runs", "lineup_games"}
PBP_GAME_TABLES = ["game_flow", "game_runs", "lineup_games"]
PBP_SEASON_TABLES = ["lineup_season", "player_on_off", "team_clutch", "player_clutch"]


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _insert_sql(table: str, cols: list[str], conflict: list[str] | None = None) -> str:
    sql = f"INSERT INTO {_q(table)} ({', '.join(_q(c) for c in cols)}) VALUES ({', '.join(['%s'] * len(cols))})"
    if conflict:
        sets = [f"{_q(c)} = EXCLUDED.{_q(c)}" for c in cols if c not in conflict]
        if table not in NO_UPDATED_AT:
            sets.append('"updated_at" = now()')
        sql += f" ON CONFLICT ({', '.join(_q(c) for c in conflict)}) DO UPDATE SET {', '.join(sets)}"
    return sql


def write_rows(conn: psycopg.Connection, table: str, rows: list[dict], conflict: list[str] | None = None) -> int:
    if not rows:
        return 0
    cols = list(rows[0].keys())
    sql = _insert_sql(table, cols, conflict)
    with conn.cursor() as cur:
        cur.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])
    return len(rows)


def copy_rows(conn: psycopg.Connection, table: str, rows: list[dict], cols: list[str]) -> int:
    """Bulk insert with COPY (a full season of shots is too many rows for INSERT one at a time)."""
    if not rows:
        return 0
    with conn.cursor() as cur:
        with cur.copy(f"COPY {_q(table)} ({', '.join(_q(c) for c in cols)}) FROM STDIN") as cp:
            for r in rows:
                cp.write_row(tuple(r[c] for c in cols))
    return len(rows)


def load_shots(conn: psycopg.Connection, shots: ShotBuild | None, season: int) -> dict[str, int]:
    """Rewrite the shots of games whose shots changed, then rebuild the season's zone profiles."""
    if shots is None or not shots.available:
        return {}
    have = {r["game_id"]: r["fingerprint"]
            for r in conn.execute("SELECT game_id, fingerprint FROM shot_games WHERE season = %s", (season,)).fetchall()}
    changed = [g for g in shots.shot_games if have.get(g["game_id"]) != g["fingerprint"]]
    counts = {"shots": 0, "shot_games": len(changed)}
    if changed:
        ids = [g["game_id"] for g in changed]
        conn.execute("DELETE FROM shots WHERE game_id = ANY(%s)", (ids,))
        keep = set(ids)
        counts["shots"] = copy_rows(conn, "shots", [r for r in shots.shots if r["game_id"] in keep], SHOT_COLUMNS)
        write_rows(conn, "shot_games", changed, ["game_id"])
    for table, rows in (("league_shot_zones", shots.league), ("team_shot_zones", shots.teams),
                        ("player_shot_zones", shots.players)):
        conn.execute(f"DELETE FROM {table} WHERE season = %s", (season,))
        counts[table] = write_rows(conn, table, rows)
    conn.execute("DELETE FROM game_shot_zones WHERE game_id IN (SELECT id FROM games WHERE season = %s)", (season,))
    counts["game_shot_zones"] = write_rows(conn, "game_shot_zones", shots.game_zones)
    return counts


def load_build(conn: psycopg.Connection, build: Build, odds: list[dict], injuries: list[dict],
               editorial: list[dict], previews: list[dict] | None = None, shots: ShotBuild | None = None,
               pbp=None) -> dict[str, int]:
    """Write everything for one run. The caller owns the transaction."""
    season, day = build.season, build.today.isoformat()
    counts: dict[str, int] = {}
    counts["teams"] = write_rows(conn, "teams", build.teams, KEYS["teams"])
    counts["players"] = write_rows(conn, "players", build.players, KEYS["players"])
    counts["games"] = write_rows(conn, "games", build.games, KEYS["games"])
    # games ESPN took off this season's schedule (never played, so no box score) go too
    ids = [g["id"] for g in build.games]
    if ids:
        gone = conn.execute(
            "DELETE FROM games g WHERE g.season = %s AND NOT (g.id = ANY(%s)) "
            "AND NOT EXISTS (SELECT 1 FROM team_games tg WHERE tg.game_id = g.id) RETURNING g.id",
            (season, ids)).fetchall()
        counts["games_removed"] = len(gone)

    # box scores: upsert, then drop rows of the same games that the new source no longer has
    counts["team_games"] = write_rows(conn, "team_games", build.team_games, KEYS["team_games"])
    counts["player_games"] = write_rows(conn, "player_games", build.player_games, KEYS["player_games"])
    gids = sorted({r["game_id"] for r in build.player_games})
    if gids:
        conn.execute(
            "DELETE FROM player_games pg WHERE pg.game_id = ANY(%s) AND NOT EXISTS ("
            "SELECT 1 FROM unnest(%s::int[], %s::bigint[]) AS k(g, p) WHERE k.g = pg.game_id AND k.p = pg.player_id)",
            (gids, [r["game_id"] for r in build.player_games], [r["player_id"] for r in build.player_games]))

    # season tables and per-game derived tables: rebuilt for the whole season
    conn.execute("DELETE FROM team_season WHERE season = %s", (season,))
    counts["team_season"] = write_rows(conn, "team_season", build.team_season)
    conn.execute("DELETE FROM player_season WHERE season = %s", (season,))
    counts["player_season"] = write_rows(conn, "player_season", build.player_season)
    conn.execute("DELETE FROM game_gaps WHERE game_id IN (SELECT id FROM games WHERE season = %s)", (season,))
    counts["game_gaps"] = write_rows(conn, "game_gaps", build.game_gaps)
    conn.execute("DELETE FROM player_game_deltas WHERE game_id IN (SELECT id FROM games WHERE season = %s)", (season,))
    counts["player_game_deltas"] = write_rows(conn, "player_game_deltas", build.player_game_deltas)
    counts.update(load_shots(conn, shots, season))

    # dated snapshots: replace the run date's rows
    conn.execute("DELETE FROM odds WHERE snapshot_date = %s", (day,))
    counts["odds"] = write_rows(conn, "odds", odds)
    conn.execute("DELETE FROM injuries WHERE snapshot_date = %s", (day,))
    counts["injuries"] = write_rows(conn, "injuries", injuries)
    conn.execute("DELETE FROM editorial WHERE date = %s", (day,))
    counts["editorial"] = write_rows(conn, "editorial", editorial)
    conn.execute("DELETE FROM game_previews WHERE snapshot_date = %s", (day,))
    counts["game_previews"] = write_rows(conn, "game_previews", previews or [])

    # play-by-play: per-game and season tables rebuilt for the season (left alone when the run had no play-by-play)
    if pbp is not None:
        for table in PBP_GAME_TABLES:
            conn.execute(f"DELETE FROM {_q(table)} WHERE game_id IN (SELECT id FROM games WHERE season = %s)", (season,))
            counts[table] = write_rows(conn, table, getattr(pbp, table))
        for table in PBP_SEASON_TABLES:
            conn.execute(f"DELETE FROM {_q(table)} WHERE season = %s", (season,))
            counts[table] = write_rows(conn, table, getattr(pbp, table))
    return counts


def start_run(conn: psycopg.Connection, day: dt.date, season: int, command: str, args: dict) -> int:
    with conn.transaction():
        row = conn.execute("INSERT INTO pipeline_runs (run_date, season, command, status, args) "
                           "VALUES (%s, %s, %s, 'running', %s) RETURNING id",
                           (day, season, command, Jsonb(args))).fetchone()
    return row["id"]


def finish_run(conn: psycopg.Connection, run_id: int, status: str, counts: dict | None = None, notes: list | None = None,
               warnings: list | None = None, errors: list | None = None, error: str | None = None) -> None:
    with conn.transaction():
        conn.execute("UPDATE pipeline_runs SET status = %s, finished_at = now(), counts = %s, notes = %s, warnings = %s, "
                     "errors = %s, error = %s WHERE id = %s",
                     (status, Jsonb(counts or {}), Jsonb(notes or []), Jsonb(warnings or []), Jsonb(errors or []), error,
                      run_id))
