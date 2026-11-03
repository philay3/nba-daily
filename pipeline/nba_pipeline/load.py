"""Idempotent load of a build into Postgres, in one transaction.

- Facts (teams, players, games, team_games, player_games) are upserted by primary key; box rows that a
  newer source no longer has (for example a patched game later replaced by the mirror) are removed.
- Season tables and per-game derived tables are rebuilt for the season.
- Snapshots (odds, injuries, editorial) replace that date's rows.
Running the same day twice leaves the database unchanged.
"""
from __future__ import annotations

import datetime as dt

import psycopg
from psycopg.types.json import Jsonb

from nba_pipeline.compute import Build

KEYS = {
    "teams": ["code"],
    "players": ["id"],
    "games": ["id"],
    "team_games": ["game_id", "team_code"],
    "player_games": ["game_id", "player_id"],
}
NO_UPDATED_AT = {"game_gaps", "player_game_deltas", "pipeline_runs", "odds", "injuries"}


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


def load_build(conn: psycopg.Connection, build: Build, odds: list[dict], injuries: list[dict],
               editorial: list[dict]) -> dict[str, int]:
    """Write everything for one run. The caller owns the transaction."""
    season, day = build.season, build.today.isoformat()
    counts: dict[str, int] = {}
    counts["teams"] = write_rows(conn, "teams", build.teams, KEYS["teams"])
    counts["players"] = write_rows(conn, "players", build.players, KEYS["players"])
    counts["games"] = write_rows(conn, "games", build.games, KEYS["games"])

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

    # dated snapshots: replace the run date's rows
    conn.execute("DELETE FROM odds WHERE snapshot_date = %s", (day,))
    counts["odds"] = write_rows(conn, "odds", odds)
    conn.execute("DELETE FROM injuries WHERE snapshot_date = %s", (day,))
    counts["injuries"] = write_rows(conn, "injuries", injuries)
    conn.execute("DELETE FROM editorial WHERE date = %s", (day,))
    counts["editorial"] = write_rows(conn, "editorial", editorial)
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
