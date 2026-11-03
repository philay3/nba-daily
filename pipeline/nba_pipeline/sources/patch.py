"""PATCH FORMAT: a finished game the mirrors do not have yet, written from ESPN's game summary.

patch_<espn_id>.json:
{"game_id": 401909906, "away": "TOR", "home": "LAL", "periods": [[23, 36], [31, 30], [28, 38], [43, 27]],
 "teams": {"TOR": {"fgm":45,"fga":105,"tpm":17,"tpa":54,"ftm":18,"fta":25,"oreb":22,"dreb":25,"reb":47,"ast":35,
                   "stl":14,"blk":1,"tov":15,"pf":26,"fb":23,"paint":46,"pts_off_to":23,"largest_lead":5,"lead_changes":1}, "LAL": {...}},
 "players": [{"id": 3945274, "team": "LAL", "name": "Luka Doncic", "pos": "G", "starter": true, "dnp": false, "reason": "",
              "min": 35, "pts": 45, "fgm": 12, "fga": 23, "tpm": 8, "tpa": 12, "ftm": 13, "fta": 13, "oreb": 0, "dreb": 15,
              "reb": 15, "ast": 6, "stl": 5, "blk": 1, "tov": 7, "pf": 5, "pm": 27}, ...]}

Team codes may be ESPN's (GS, NY, NO, SA, UTAH, WSH) or ours. Players who did not play: "dnp": true and a "reason".
Team turnovers are ESPN's totalTurnovers, not turnovers (the total includes team turnovers).
Period scores: [] when unknown; the box score still counts and overtimes are inferred from minutes.
"""
from __future__ import annotations

import zlib

from nba_pipeline.teams import code
from nba_pipeline.util import num


def from_patch(p, game_date):
    """Ported unchanged from the original engine."""
    gid = int(p["game_id"])
    a, h = p["away"], p["home"]
    side = {a: "away", h: "home"}
    pts = {t: sum(int(x["pts"]) for x in p["players"] if x["team"] == t and not x.get("dnp")) for t in (a, h)}
    periods = [tuple(int(v) for v in q) for q in (p.get("periods") or [])]
    if periods and (sum(q[0] for q in periods) != pts[a] or sum(q[1] for q in periods) != pts[h]):
        raise ValueError(f"patch {gid}: player points {pts} do not match the period scores")
    if periods:
        n_per = len(periods)
    else:  # no line score: count overtimes from minutes (240 player-minutes per team in regulation, 25 more per overtime)
        mins = sum(float(x.get("min") or 0) for x in p["players"] if x["team"] == a and not x.get("dnp"))
        n_per = 4 + max(0, round((mins - 240) / 25))
    prow, trow = [], []
    for x in p["players"]:
        t = x["team"]
        dnp = bool(x.get("dnp"))
        pid = x.get("id") or zlib.crc32(f"{t}|{x['name']}".encode())
        g = (lambda k: None if dnp else num(x.get(k)))
        prow.append(dict(game_id=gid, game_date=game_date, team_abbreviation=t, opponent_team_abbreviation=h if t == a else a,
                         home_away=side[t], athlete_id=int(pid), athlete_display_name=x["name"],
                         athlete_position_abbreviation=x.get("pos", ""), starter=bool(x.get("starter")), did_not_play=dnp,
                         reason=x.get("reason", ""), minutes=g("min"), points=g("pts"), field_goals_made=g("fgm"),
                         field_goals_attempted=g("fga"), three_point_field_goals_made=g("tpm"),
                         three_point_field_goals_attempted=g("tpa"), free_throws_made=g("ftm"), free_throws_attempted=g("fta"),
                         offensive_rebounds=g("oreb"), defensive_rebounds=g("dreb"), rebounds=g("reb"), assists=g("ast"),
                         steals=g("stl"), blocks=g("blk"), turnovers=g("tov"), fouls=g("pf"),
                         plus_minus=None if dnp or x.get("pm") is None else str(int(x["pm"]))))
    for t in (a, h):
        s = p["teams"][t]
        trow.append(dict(game_id=gid, game_date=game_date, team_abbreviation=t, team_home_away=side[t], team_score=pts[t],
                         team_winner=pts[t] > pts[h if t == a else a], field_goals_made=s["fgm"], field_goals_attempted=s["fga"],
                         three_point_field_goals_made=s["tpm"], three_point_field_goals_attempted=s["tpa"],
                         free_throws_made=s["ftm"], free_throws_attempted=s["fta"], offensive_rebounds=s["oreb"],
                         defensive_rebounds=s["dreb"], total_rebounds=s["reb"], assists=s["ast"], steals=s["stl"],
                         blocks=s["blk"], total_turnovers=s["tov"], fouls=s["pf"], fast_break_points=s.get("fb", 0),
                         points_in_paint=s.get("paint", 0), turnover_points=s.get("pts_off_to", 0),
                         largest_lead=s.get("largest_lead", 0), lead_changes=s.get("lead_changes", 0)))
    return prow, trow, periods, n_per


TEAM_KEYS = [("fgm", "fga", "fieldGoalsMade-fieldGoalsAttempted"),
             ("tpm", "tpa", "threePointFieldGoalsMade-threePointFieldGoalsAttempted"),
             ("ftm", "fta", "freeThrowsMade-freeThrowsAttempted")]
TEAM_SINGLE = [("oreb", "offensiveRebounds"), ("dreb", "defensiveRebounds"), ("reb", "totalRebounds"), ("ast", "assists"),
               ("stl", "steals"), ("blk", "blocks"), ("tov", "totalTurnovers"), ("pf", "fouls"), ("fb", "fastBreakPoints"),
               ("paint", "pointsInPaint"), ("pts_off_to", "turnoverPoints"), ("largest_lead", "largestLead"),
               ("lead_changes", "leadChanges")]
PLAYER_PAIRS = [("fgm", "fga", "fieldGoalsMade-fieldGoalsAttempted"),
                ("tpm", "tpa", "threePointFieldGoalsMade-threePointFieldGoalsAttempted"),
                ("ftm", "fta", "freeThrowsMade-freeThrowsAttempted")]
PLAYER_SINGLE = [("oreb", "offensiveRebounds"), ("dreb", "defensiveRebounds"), ("reb", "rebounds"), ("ast", "assists"),
                 ("stl", "steals"), ("blk", "blocks"), ("tov", "turnovers"), ("pf", "fouls")]


def _int(v) -> int:
    n = num(v)
    return int(n) if n is not None else 0


def _pair(v) -> tuple[int, int]:
    v = str(v or "")
    if "-" not in v:
        return 0, 0
    m, a = v.split("-", 1)
    return _int(m), _int(a)


def linescores(competitor: dict) -> list[int]:
    return [int(float(x.get("value", x.get("displayValue", 0)))) for x in competitor.get("linescores") or []]


def summary_to_patch(js: dict) -> dict:
    """ESPN game summary JSON -> PATCH FORMAT (period scores from the header line score when present)."""
    comp = js["header"]["competitions"][0]
    by_side = {c["homeAway"]: c for c in comp["competitors"]}
    away = code(by_side["away"]["team"]["abbreviation"])
    home = code(by_side["home"]["team"]["abbreviation"])
    la, lh = linescores(by_side["away"]), linescores(by_side["home"])
    periods = [[x, y] for x, y in zip(la, lh)] if la and len(la) == len(lh) else []

    teams: dict[str, dict] = {}
    for t in js["boxscore"]["teams"]:
        s = {x["name"]: x.get("displayValue") for x in t["statistics"]}
        row: dict[str, int] = {}
        for made, att, key in TEAM_KEYS:
            row[made], row[att] = _pair(s.get(key))
        for out, key in TEAM_SINGLE:
            row[out] = _int(s.get(key))
        teams[code(t["team"]["abbreviation"])] = row

    players = []
    for t in js["boxscore"]["players"]:
        team = code(t["team"]["abbreviation"])
        st = t["statistics"][0]
        for a in st["athletes"]:
            dnp = bool(a.get("didNotPlay"))
            vals = dict(zip(st["keys"], a.get("stats") or []))
            pm = vals.get("plusMinus")
            row = dict(id=int(a["athlete"]["id"]), team=team, name=a["athlete"]["displayName"],
                       pos=(a["athlete"].get("position") or {}).get("abbreviation", ""), starter=bool(a.get("starter")),
                       dnp=dnp, reason=(a.get("reason") or "") if dnp else "",
                       min=_int(vals.get("minutes")), pts=_int(vals.get("points")))
            for made, att, key in PLAYER_PAIRS:
                row[made], row[att] = _pair(vals.get(key))
            for out, key in PLAYER_SINGLE:
                row[out] = _int(vals.get(key))
            row["pm"] = _int(str(pm).replace("+", "")) if pm not in (None, "") else 0
            players.append(row)
    return {"game_id": int(js["header"]["id"]), "away": away, "home": home, "periods": periods,
            "teams": {away: teams[away], home: teams[home]}, "players": players}
