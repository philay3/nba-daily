"""Database rows -> the ten dashboard JSON files (the original engine's shapes and ordering).

`dashboard_files(tables)` is the only code that builds those shapes. `tables` comes either from a
fresh build in memory (`tables_from_build`) or from Postgres (`read_tables`), so the parity tests
cover the computation and the database round trip with the same function.

Ordering rules reproduce the engine (which inherited some from hoopR's file order):
  games         tip, then game code
  results       tip descending, then ESPN id (hoopR schedule order)
  box_players   tip, ESPN id, road team first, then box order (hoopR player-box order)
  box_teams     team code
  box_compare   results order, then the engine's stat list order
  team_season   net rating descending (pandas sort on team-code order, ties as the engine breaks them)
  player_season team, then minutes rank on the team
  standings     conference, win pct, wins, team (seed may be the official one)
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pandas as pd

from nba_pipeline.compute import BETTER_HIGH, BETTER_LOW, TEAM_STAT_KEYS
from nba_pipeline.config import ET

TEN = ["games", "results", "box_players", "box_teams", "box_compare", "team_season", "player_season",
       "injuries", "standings", "brief"]


# ------------------------------------------------------------------ tables (same structure from memory or DB)

def tables_from_build(build, odds: list[dict], injuries: list[dict], editorial: list[dict]) -> dict:
    day, yday = build.today.isoformat(), build.yesterday.isoformat()
    last_ids = {g["id"] for g in build.games if g["game_date"] == yday}
    return dict(
        day=build.today, season=build.season,
        meta=dict(notes=list(build.meta.get("notes", [])), last_night_missing=list(build.meta.get("last_night_missing", []))),
        teams={t["code"]: t for t in build.teams},
        tonight=[g for g in build.games if g["game_date"] == day],
        last_night=[g for g in build.games if g["game_date"] == yday],
        team_games=[r for r in build.team_games if r["game_id"] in last_ids],
        player_games=[r for r in build.player_games if r["game_id"] in last_ids],
        player_game_deltas=[r for r in build.player_game_deltas if r["game_id"] in last_ids],
        game_gaps=[r for r in build.game_gaps if r["game_id"] in last_ids],
        team_season=list(build.team_season), player_season=list(build.player_season),
        injuries=list(injuries), odds=list(odds), editorial=list(editorial),
    )


def _rows(conn, sql: str, params=()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def _iso_utc(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        v = dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
    return v.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _datestr(v) -> str | None:
    return v.isoformat() if isinstance(v, dt.date) else v


def _fix_game(g: dict) -> dict:
    g = dict(g)
    g["tip"] = _iso_utc(g.get("tip"))
    g["game_date"] = _datestr(g["game_date"])
    return g


def read_tables(conn, day: dt.date, season: int | None = None) -> dict:
    """Everything the dashboard files and the digest need for one date, read from Postgres."""
    yday = day - dt.timedelta(days=1)
    run = conn.execute("SELECT season, notes FROM pipeline_runs WHERE run_date = %s AND status <> 'running' "
                       "ORDER BY id DESC LIMIT 1", (day,)).fetchone()
    if season is None:
        season = run["season"] if run else conn.execute(
            "SELECT max(season) AS s FROM team_season").fetchone()["s"]
    games = [_fix_game(g) for g in _rows(conn, "SELECT * FROM games WHERE game_date IN (%s, %s)", (day, yday))]
    last_ids = [g["id"] for g in games if g["game_date"] == yday.isoformat()]
    have_box = {r["game_id"] for r in _rows(conn, "SELECT DISTINCT game_id FROM team_games WHERE game_id = ANY(%s)", (last_ids,))}
    return dict(
        day=day, season=season,
        meta=dict(notes=list((run or {}).get("notes") or []),
                  last_night_missing=[g["id"] for g in games if g["id"] in last_ids and g["id"] not in have_box]),
        teams={t["code"]: t for t in _rows(conn, "SELECT * FROM teams")},
        tonight=[g for g in games if g["game_date"] == day.isoformat()],
        last_night=[g for g in games if g["game_date"] == yday.isoformat()],
        team_games=[_with_date(r) for r in _rows(conn, "SELECT * FROM team_games WHERE game_id = ANY(%s)", (last_ids,))],
        player_games=[_with_date(r) for r in _rows(conn, "SELECT * FROM player_games WHERE game_id = ANY(%s)", (last_ids,))],
        player_game_deltas=[_with_date(r) for r in _rows(conn, "SELECT * FROM player_game_deltas WHERE game_id = ANY(%s)", (last_ids,))],
        game_gaps=_rows(conn, "SELECT * FROM game_gaps WHERE game_id = ANY(%s)", (last_ids,)),
        team_season=[_with_date(r) for r in _rows(conn, "SELECT * FROM team_season WHERE season = %s", (season,))],
        player_season=[_with_date(r) for r in _rows(conn, "SELECT * FROM player_season WHERE season = %s", (season,))],
        injuries=[_with_date(r) for r in _rows(conn, "SELECT * FROM injuries WHERE snapshot_date = %s ORDER BY sort_order", (day,))],
        odds=[_with_date(r) for r in _rows(conn, "SELECT * FROM odds WHERE snapshot_date = %s", (day,))],
        editorial=[_with_date(r) for r in _rows(conn, "SELECT * FROM editorial WHERE date = %s", (day,))],
    )


def _with_date(r: dict) -> dict:
    return {k: (_datestr(v) if isinstance(v, dt.date) and not isinstance(v, dt.datetime) else v) for k, v in r.items()}


# ------------------------------------------------------------------ the ten files

def _tip_ts(g: dict) -> float:
    return dt.datetime.fromisoformat(g["tip"].replace("Z", "+00:00")).timestamp() if g.get("tip") else 0.0


def _time_et(tip: str) -> str:
    t = dt.datetime.fromisoformat(tip.replace("Z", "+00:00")).astimezone(ET)
    return t.strftime("%-I:%M %p")


def team_season_rows(tables: dict) -> list[dict]:
    teams = tables["teams"]
    rows = []
    for ts in sorted(tables["team_season"], key=lambda r: r["team_code"]):
        t = teams.get(ts["team_code"], {})
        rec = dict(team=ts["team_code"], name=t.get("display_name", ts["team_code"]),
                   nickname=t.get("nickname", ts["team_code"]), conf=t.get("conference"),
                   gp=ts["gp"], w=ts["w"], l=ts["l"], home_rec=ts["home_rec"], road_rec=ts["road_rec"],
                   streak=ts["streak"], l5_rec=ts["l5_rec"])
        for k in TEAM_STAT_KEYS:
            rec[k] = ts[k]
        for k in BETTER_HIGH + BETTER_LOW:
            rec[k + "_rk"] = ts[k + "_rk"]
        rows.append(rec)
    if not rows:
        return []
    df = pd.DataFrame(rows).sort_values("net", ascending=False)
    return [{k: _py(v) for k, v in r.items()} for r in df.to_dict("records")]


def _py(v):
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and v != v:
        return None
    return v


def player_season_rows(tables: dict) -> list[dict]:
    rows = sorted(tables["player_season"], key=lambda r: (r["team_code"], r["team_mpg_rank"]))
    keys = ["gp", "gs", "mpg", "ppg", "rpg", "orpg", "apg", "spg", "bpg", "tovpg", "pfpg", "fg_pct", "fg3m_pg", "fg3_pct",
            "ft_pct", "ts_pct", "pm_total", "pm_pg", "hi_pts", "team_mpg_rank"]
    out = []
    for r in rows:
        rec = dict(player_id=r["player_id"], player=r["name"], team=r["team_code"], pos=r["position"] or "")
        rec.update({k: r[k] for k in keys})
        out.append(rec)
    return out


def _last_night_order(tables: dict) -> list[dict]:
    """Last night's games that have box scores, in hoopR schedule order (tip descending, then ESPN id)."""
    have = {r["game_id"] for r in tables["team_games"]}
    games = [g for g in tables["last_night"] if g["id"] in have]
    return sorted(games, key=lambda g: (-_tip_ts(g), g["id"]))


def results_rows(tables: dict) -> list[dict]:
    notes = {e["ref"]: e["text"] for e in tables["editorial"] if e["kind"] == "result"}
    tg = {(r["game_id"], r["team_code"]): r for r in tables["team_games"]}
    out = []
    for g in _last_night_order(tables):
        a, h = g["away_code"], g["home_code"]
        ar, hr = tg[(g["id"], a)], tg[(g["id"], h)]
        out.append(dict(game_id=g["code"], espn_id=g["id"], date=g["game_date"], matchup=f"{a} @ {h}", away=a, home=h,
                        away_score=ar["pts"], home_score=hr["pts"], winner=g["winner_code"],
                        periods=",".join(f"{x}-{y}" for x, y in zip(g["away_periods"] or [], g["home_periods"] or [])),
                        ot=g["ot"], away_max_lead=ar["largest_lead"], home_max_lead=hr["largest_lead"],
                        lead_changes=g["lead_changes"], upset=bool(g["upset"]), note=notes.get(g["code"], "")))
    return out


def box_teams_rows(tables: dict) -> list[dict]:
    code = {g["id"]: g["code"] for g in tables["last_night"]}
    keys = ["pts", "fgm", "fga", "fg_pct", "tpm", "tpa", "fg3_pct", "ftm", "fta", "ft_pct", "oreb", "dreb", "reb", "ast",
            "stl", "blk", "tov", "pf", "fb", "paint", "pts_off_to", "bench_pts", "largest_lead", "lead_changes", "poss",
            "ortg", "efg", "tov_pct", "orb_pct", "ftr", "ast_pct"]
    out = []
    for r in sorted(tables["team_games"], key=lambda r: r["team_code"]):
        rec = dict(game_id=code.get(r["game_id"]), espn_id=r["game_id"], team=r["team_code"], opp=r["opp_code"],
                   ha=r["home_away"])
        rec.update({k: r[k] for k in keys})
        out.append(rec)
    return out


def box_players_rows(tables: dict) -> list[dict]:
    games = {g["id"]: g for g in tables["last_night"]}
    have = {r["game_id"] for r in tables["team_games"]}
    deltas = {(d["game_id"], d["player_id"]): d for d in tables["player_game_deltas"]}

    def key(r):
        g = games[r["game_id"]]
        return (_tip_ts(g), g["id"], r["home_away"] != "away", r["box_order"])
    out = []
    for r in sorted((r for r in tables["player_games"] if r["game_id"] in have), key=key):
        is_dnp = bool(r["did_not_play"]) or not (r["min"] or 0) > 0
        reason = r.get("reason")
        row = dict(game_id=games[r["game_id"]]["code"], espn_id=r["game_id"], team=r["team_code"], opp=r["opp_code"],
                   player_id=r["player_id"], player=r["name"], pos=r["position"] or "", order=r["box_order"],
                   starter=bool(r["starter"]) and not is_dnp, dnp=is_dnp,
                   reason=(str(reason).strip().capitalize() if is_dnp and reason else ""))
        if not is_dnp:
            row.update(min=int(r["min"]), pts=r["pts"], fg=f"{r['fgm']}-{r['fga']}", tp=f"{r['tpm']}-{r['tpa']}",
                       ft=f"{r['ftm']}-{r['fta']}", oreb=r["oreb"], dreb=r["dreb"], reb=r["reb"], ast=r["ast"],
                       stl=r["stl"], blk=r["blk"], tov=r["tov"], pf=r["pf"], pm=r["plus_minus"], ts_pct=r["ts_pct"])
            d = deltas.get((r["game_id"], r["player_id"]))
            if d and d["gp_before"] > 0:
                row.update(gp_before=d["gp_before"], avg_min=d["avg_min"], avg_pts=d["avg_pts"], avg_reb=d["avg_reb"],
                           avg_ast=d["avg_ast"], avg_pm=d["avg_pm"], d_pts=d["d_pts"], d_reb=d["d_reb"],
                           d_ast=d["d_ast"], d_min=d["d_min"])
            else:
                row.update(gp_before=0)
            row["flags"] = d["flags"] if d else ""
        out.append(row)
    return out


def box_compare_rows(tables: dict) -> list[dict]:
    order = {g["id"]: i for i, g in enumerate(_last_night_order(tables))}
    code = {g["id"]: g["code"] for g in tables["last_night"]}
    rows = [r for r in tables["game_gaps"] if r["game_id"] in order]
    rows.sort(key=lambda r: (order[r["game_id"]], r["sort_order"] % 100))
    return [dict(game_id=code[r["game_id"]], key=r["key"], order=r["sort_order"], group=r["grp"], stat=r["stat"],
                 away=r["away_code"], home=r["home_code"], away_txt=r["away_txt"], home_txt=r["home_txt"],
                 gap_txt=r["gap_txt"], edge=r["edge"], edge_txt=r["edge_txt"], z=r["z"], level=r["level"],
                 volume=bool(r["volume"])) for r in rows]


def games_rows(tables: dict) -> list[dict]:
    teams = tables["teams"]
    ts = {r["team_code"]: r for r in tables["team_season"]}
    odds = {r["game_id"]: r for r in tables["odds"]}
    picks = {e["ref"]: e for e in tables["editorial"] if e["kind"] == "game"}
    out = []
    for g in tables["tonight"]:
        a, h = g["away_code"], g["home_code"]
        A, H = ts.get(a), ts.get(h)
        ar = f"{A['w']}-{A['l']}" if A else ""
        hr = f"{H['w']}-{H['l']}" if H else ""
        rest = {a: g["away_rest"], h: g["home_rest"]}
        row = dict(game_id=g["code"], espn_id=g["id"], tip=g["tip"], time_et=_time_et(g["tip"]), matchup=f"{a} @ {h}",
                   away=a, home=h, away_name=teams.get(a, {}).get("nickname", a), home_name=teams.get(h, {}).get("nickname", h),
                   away_record=ar, home_record=hr, records=f"{ar} · {hr}",
                   away_road=A["road_rec"] if A else "", home_home=H["home_rec"] if H else "",
                   espn_records=f"{g['espn_away_record'] or ''} · {g['espn_home_record'] or ''}",
                   away_rest=rest[a], home_rest=rest[h], b2b=", ".join(t for t in (a, h) if rest[t] == 0), tv=g["tv"])
        o = odds.get(g["id"], {})
        for k in ("line", "spread_abs", "total", "away_wp", "home_wp"):
            row[k] = o.get(k)
        aw, hw = row["away_wp"], row["home_wp"]
        if aw is not None and hw is not None:
            row["fav"], row["fav_wp"] = (a, aw) if aw >= hw else (h, hw)
        else:
            row["fav"], row["fav_wp"] = None, None
        e = picks.get(g["code"], {})
        row["watch"], row["tag"], row["note"] = e.get("watch"), e.get("tag", ""), e.get("text", "")
        out.append(row)
    out.sort(key=lambda r: (r["tip"], r["game_id"]))
    return out


def injuries_rows(tables: dict) -> list[dict]:
    """Tonight's teams only: the report also covers teams that play in the next two days (for the look-ahead)."""
    tonight = {g[k] for g in tables["tonight"] for k in ("away_code", "home_code")}
    rows = sorted((r for r in tables["injuries"] if r["team_code"] in tonight), key=lambda r: r["sort_order"])
    return [dict(game_id=r["game_code"], team=r["team_code"], player=r["player_name"], pos=r["position"],
                 status=r["status"], injury=r["injury"], note=r["note"]) for r in rows]


def standings_rows(tables: dict) -> list[dict]:
    teams = tables["teams"]
    rows = [dict(team=r["team_code"], name=teams.get(r["team_code"], {}).get("display_name", r["team_code"]),
                 conf=teams.get(r["team_code"], {}).get("conference"), w=r["w"], l=r["l"], seed=r["seed"])
            for r in tables["team_season"]]
    if not rows:
        return []
    st = pd.DataFrame(rows)
    st["pct"] = (st.w / (st.w + st.l)).round(3)
    st = st.sort_values(["conf", "pct", "w", "team"], ascending=[True, False, False, True])
    return [{k: _py(r[k]) for k in ("team", "name", "conf", "w", "l", "pct", "seed")} for r in st.to_dict("records")]


def brief_rows(tables: dict) -> list[dict]:
    rows = sorted((e for e in tables["editorial"] if e["kind"] in ("date", "headline", "surprise")), key=lambda e: e["seq"])
    return [dict(kind=e["kind"], order=e["sort_order"], title=e["title"], text=e["text"]) for e in rows]


def dashboard_files(tables: dict) -> dict[str, list]:
    return dict(games=games_rows(tables), results=results_rows(tables), box_players=box_players_rows(tables),
                box_teams=box_teams_rows(tables), box_compare=box_compare_rows(tables),
                team_season=team_season_rows(tables), player_season=player_season_rows(tables),
                injuries=injuries_rows(tables), standings=standings_rows(tables), brief=brief_rows(tables))


def write_files(files: dict[str, list], out: Path) -> None:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in files.items():
        (out / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False))
