"""Shots: one row per field goal attempt with its spot, distance, zone and assist, plus zone profiles.

Source: hoopR's season shot file (built from ESPN's play-by-play, one row per shot, free throws included).
The coordinate system was worked out from the data itself (docs/DATA.md has the checks):

- `coordinate_x_raw` runs across the court in whole feet, 0 to 50, with the rim at 25.
- `coordinate_y_raw` is feet from the rim toward half court: the baseline is about 5 feet behind the rim
  (-5), half court is 41.75 feet out.
- Every shot is measured toward the basket the shooting team attacks, so all shots share one half court.
  hoopR's `coordinate_x` / `coordinate_y` are a full-court view that keeps each team on one end for the whole
  game; we do not use them.

We store x = raw x - 25 (feet left or right of the rim) and y = raw y (feet out from the rim).

What counts as an attempt: every row that is not a free throw, except missed end-of-quarter heaves. Since
2025-26 a missed heave is not charged as a field goal attempt; ESPN types those "Heave Jump Shot" and the box
score leaves them out (2024-25 has no such type, so the rule changes nothing there). Made heaves count.

Three or two: a made shot's points say it for sure. A miss is placed by the line: 22 feet in the corners, where
the line runs straight up to 14 feet from the baseline (8.75 feet past the rim), and 23.75 feet around the arc.

Zones, as NBA.com draws them: restricted area (within 4 feet of the rim), paint outside the restricted area
(the 16-foot lane up to the free throw line), midrange (any other two), corner 3, above-the-break 3, backcourt
(beyond half court).
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field

import pandas as pd

from nba_pipeline.compute import Build
from nba_pipeline.teams import code
from nba_pipeline.util import pct, r1

RIM_X = 25.0  # raw x of the rim
CORNER_X = 22.0  # the corner three line, feet from the rim
CORNER_Y = 8.75  # the corner line is straight up to 14 ft from the baseline; the rim is 5.25 ft from it
ARC_R = 23.75  # the arc, feet from the rim
RA_R = 4.0  # restricted area
LANE_HALF = 8.0  # the lane is 16 ft wide
LANE_Y = 14.0  # the free throw line is 13.75 ft past the rim; whole feet put it at 14 (best fit to ESPN's paint points)
HALF_COURT_Y = 41.75  # 47 ft from the baseline

ZONES = ["restricted_area", "paint", "midrange", "corner_3", "above_break_3", "backcourt"]
ALL = "all"

SHOT_COLUMNS = ["game_id", "seq", "season", "game_date", "period", "clock", "team_code", "opp_code", "player_id",
                "assist_id", "shot_type", "made", "points", "three", "x", "y", "distance", "zone", "assisted"]


# ------------------------------------------------------------------ geometry

def distance(x: float, y: float) -> float:
    return math.hypot(x, y)


def three_by_location(x: float, y: float) -> bool:
    """Is a shot from (x, y) behind the three-point line? Feet from the rim; y grows toward half court."""
    if y <= CORNER_Y:
        return abs(x) >= CORNER_X
    return distance(x, y) >= ARC_R


def zone_of(x: float, y: float, three: bool) -> str:
    if three:
        if y > HALF_COURT_Y:
            return "backcourt"
        return "corner_3" if y <= CORNER_Y else "above_break_3"
    if distance(x, y) <= RA_R:
        return "restricted_area"
    if abs(x) <= LANE_HALF and y <= LANE_Y:
        return "paint"
    return "midrange"


def clock_text(raw) -> str:
    """ESPN writes the last minute as 0:58.3 or 0:0.8; show it the way a broadcast does (58.3, 0.8)."""
    s = str(raw).strip() if isinstance(raw, str) else ""
    if s.startswith("0:") and "." in s:
        sec = s[2:].lstrip("0")
        return "0" + sec if sec.startswith(".") else sec
    return s


def is_free_throw(type_text: pd.Series) -> pd.Series:
    return type_text.fillna("").str.startswith("Free Throw")


def is_missed_heave(type_text: pd.Series, made: pd.Series) -> pd.Series:
    return type_text.fillna("").str.startswith("Heave") & ~made


# ------------------------------------------------------------------ build

@dataclass
class ShotBuild:
    available: bool  # False when there was no shot file: the loader then leaves every shot table as it is
    shots: list[dict] = field(default_factory=list)
    shot_games: list[dict] = field(default_factory=list)
    league: list[dict] = field(default_factory=list)
    teams: list[dict] = field(default_factory=list)
    players: list[dict] = field(default_factory=list)
    game_zones: list[dict] = field(default_factory=list)
    meta: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def build_shots(raw: pd.DataFrame | None, build: Build) -> ShotBuild:
    """Shot rows for every game with a box score, per-game fingerprints, zone profiles, and the coverage check."""
    if raw is None:
        return ShotBuild(available=False, notes=[f"no shot file for {build.season}, so the shot tables were left as they were"])
    tg = {(r["game_id"], r["team_code"]): r for r in build.team_games}
    sides: dict[int, set] = {}
    for gid, team in tg:
        sides.setdefault(gid, set()).add(team)
    player_ids = {p["id"] for p in build.players}

    df = raw[raw.game_id.astype(int).isin(sides)].copy()  # games before the run date with a box score
    df["game_id"] = df.game_id.astype(int)
    df["made"] = df.scoring_play.fillna(False).astype(bool)
    ft = is_free_throw(df.type_text)
    heave = is_missed_heave(df.type_text, df.made) & ~ft
    dropped = {"free_throws": int(ft.sum()), "missed_heaves": int(heave.sum())}
    df = df[~ft & ~heave].copy()
    df["team_code"] = df.team_abbrev.map(code)
    df["player_id"] = pd.to_numeric(df.athlete_id_1, errors="coerce").astype("Int64")
    bad_team = pd.Series([t not in sides[g] for g, t in zip(df.game_id, df.team_code)], index=df.index, dtype=bool)
    no_player = ~df.player_id.isin(player_ids).fillna(False).astype(bool) & ~bad_team
    no_spot = (df.coordinate_x_raw.isna() | df.coordinate_y_raw.isna()) & ~bad_team & ~no_player
    dropped.update(wrong_team=int(bad_team.sum()), unknown_shooter=int(no_player.sum()), no_location=int(no_spot.sum()))
    df = df[~bad_team & ~no_player & ~no_spot]

    rows: list[dict] = []
    seq: dict[int, int] = {}
    odd_points = 0
    for r in df.itertuples(index=False):
        gid = int(r.game_id)
        g = tg[(gid, r.team_code)]
        x, y = float(r.coordinate_x_raw) - RIM_X, float(r.coordinate_y_raw)
        made = bool(r.made)
        value = 0 if pd.isna(r.score_value) else int(r.score_value)
        if made and value not in (2, 3):  # not seen in the data; fall back to the line
            odd_points += 1
            value = 3 if three_by_location(x, y) else 2
        three = value == 3 if made else three_by_location(x, y)
        assisted = made and not pd.isna(r.athlete_id_2)
        seq[gid] = seq.get(gid, 0) + 1
        rows.append(dict(
            game_id=gid, seq=seq[gid], season=build.season, game_date=g["game_date"], period=int(r.period_number),
            clock=clock_text(r.clock_display_value), team_code=r.team_code, opp_code=g["opp_code"],
            player_id=int(r.player_id), assist_id=int(r.athlete_id_2) if assisted else None,
            shot_type=r.type_text if isinstance(r.type_text, str) else "", made=made, points=value if made else 0,
            three=bool(three), x=int(round(x)), y=int(round(y)), distance=r1(distance(x, y)),
            zone=zone_of(x, y, three), assisted=bool(assisted)))
    if odd_points:
        dropped["made_without_2_or_3"] = odd_points

    out = ShotBuild(available=True, shots=rows, shot_games=_fingerprints(rows, build.season))
    if rows:
        S = pd.DataFrame(rows, columns=SHOT_COLUMNS)
        league = zone_numbers(S)
        season = dict(season=build.season, as_of=build.today.isoformat())
        latest_team = {p["id"]: p["team_code"] for p in build.players}
        out.league = [dict(**season, zone=z, **league[z]) for z in ZONES + [ALL]]
        out.teams = (profile_rows(S, ["team_code"], league, lambda k: dict(**season, side="offense"))
                     + profile_rows(S.drop(columns=["team_code"]).rename(columns={"opp_code": "team_code"}),
                                    ["team_code"], league, lambda k: dict(**season, side="defense")))
        out.players = profile_rows(S, ["player_id"], league,
                                   lambda k: dict(**season, team_code=latest_team.get(k["player_id"])))
        out.game_zones = profile_rows(S, ["game_id", "team_code"], league)
    out.meta = dict(rows=len(rows), games=len(out.shot_games), dropped=dropped, coverage=coverage(rows, build.team_games))
    missing = out.meta["coverage"]["games_without_shots"]
    if missing:
        out.notes.append(f"no shots yet for {len(missing)} game(s) with a box score: {', '.join(map(str, missing))}")
    return out


def _fingerprints(rows: list[dict], season: int) -> list[dict]:
    """A hash of each game's shot rows, so the loader rewrites only the games whose shots changed."""
    by: dict[int, list] = {}
    for r in rows:
        by.setdefault(r["game_id"], []).append([r[c] for c in SHOT_COLUMNS])
    return [dict(game_id=gid, season=season, shots=len(v),
                 fingerprint=hashlib.sha1(json.dumps(v, default=str).encode()).hexdigest())
            for gid, v in sorted(by.items())]


# ------------------------------------------------------------------ profiles

def numbers(fga: int, fgm: int, pts: int, ast: int, total: int) -> dict:
    """FG% and share at one decimal; points per shot at two (1.05), since one would hide most differences."""
    return dict(fga=fga, fgm=fgm, pts=pts, ast=ast, fg_pct=r1(pct(fgm, fga)),
                pps=round(pts / fga, 2) if fga else None, share=r1(pct(fga, total)), ast_pct=r1(pct(ast, fgm)))


def _counts(S: pd.DataFrame, keys: list[str]) -> dict[tuple, dict[str, tuple[int, int, int, int]]]:
    """(attempts, makes, points, assisted makes) by subject and zone, in one pass."""
    g = S.groupby(keys + ["zone"], sort=True).agg(fga=("made", "size"), fgm=("made", "sum"), pts=("points", "sum"),
                                                  ast=("assisted", "sum"))
    out: dict[tuple, dict] = {}
    for idx, r in zip(g.index, g.itertuples(index=False)):
        idx = idx if isinstance(idx, tuple) else (idx,)
        key = tuple(v.item() if hasattr(v, "item") else v for v in idx[:-1])
        out.setdefault(key, {})[idx[-1]] = (int(r.fga), int(r.fgm), int(r.pts), int(r.ast))
    return out


def _by_zone(counts: dict[str, tuple[int, int, int, int]]) -> dict[str, dict]:
    total = sum(c[0] for c in counts.values())
    out = {z: numbers(*counts.get(z, (0, 0, 0, 0)), total) for z in ZONES}
    out[ALL] = numbers(*(sum(c[i] for c in counts.values()) for i in range(4)), total)
    return out


def zone_numbers(S: pd.DataFrame) -> dict[str, dict]:
    """Attempts, makes, points and assisted makes by zone, and for all shots, for one set of shots."""
    return _by_zone(_counts(S.assign(_all=0), ["_all"]).get((0,), {}))


def against_league(own: dict, lg: dict) -> dict:
    """The league's numbers for the same zone, and the FG% gap between the two printed values."""
    diff = r1(own["fg_pct"] - lg["fg_pct"]) if own["fg_pct"] is not None and lg["fg_pct"] is not None else None
    return dict(lg_fg_pct=lg["fg_pct"], lg_pps=lg["pps"], lg_share=lg["share"], fg_pct_diff=diff)


def profile_rows(S: pd.DataFrame, keys: list[str], league: dict, extra=None) -> list[dict]:
    """One row per subject (team, player, team-game) and zone. Every zone is present, zeros included."""
    rows = []
    for key, counts in _counts(S, keys).items():
        base = dict(zip(keys, key))
        head = {**(extra(base) if extra else {}), **base}
        nums = _by_zone(counts)
        for z in ZONES + [ALL]:
            rows.append(dict(**head, zone=z, **nums[z], **against_league(nums[z], league[z])))
    return rows


# ------------------------------------------------------------------ checks

def coverage(rows: list[dict], team_games: list[dict]) -> dict:
    """Shots per team-game against the box score's field goal attempts, makes and threes made.

    ESPN leaves a few shots without a location, so a team-game can come up a shot or two short; a shot logged
    to the wrong team, or a tip the box score does not count, can make it a shot over."""
    n: dict[tuple, list[int]] = {}
    for r in rows:
        c = n.setdefault((r["game_id"], r["team_code"]), [0, 0, 0])
        c[0] += 1
        c[1] += int(r["made"])
        c[2] += int(r["made"] and r["three"])
    have, without = [], set()
    for t in team_games:
        shots, made, threes = n.get((t["game_id"], t["team_code"]), [0, 0, 0])
        if shots == 0:
            without.add(t["game_id"])
            continue
        have.append(dict(gap=t["fga"] - shots, fga=t["fga"], fgm_gap=t["fgm"] - made, tpm_gap=t["tpm"] - threes))
    return dict(
        team_games=len(team_games), with_shots=len(have), box_fga=sum(h["fga"] for h in have),
        shots=sum(h["fga"] - h["gap"] for h in have),
        exact=sum(1 for h in have if h["gap"] == 0), short=sum(1 for h in have if h["gap"] > 0),
        over=sum(1 for h in have if h["gap"] < 0), shots_short=sum(h["gap"] for h in have if h["gap"] > 0),
        shots_over=-sum(h["gap"] for h in have if h["gap"] < 0), worst=max((abs(h["gap"]) for h in have), default=0),
        fgm_mismatch=sum(1 for h in have if h["fgm_gap"]), tpm_mismatch=sum(1 for h in have if h["tpm_gap"]),
        games_without_shots=sorted(without))
