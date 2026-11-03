"""The look-ahead: the next 3 days of games (tonight, tomorrow, the day after) with what a matchup needs.

Every run builds one `game_previews` row per game in that window, from the same build and snapshots it loads:
records through the run's date, rest days and back-to-backs from the schedule, and both teams' players listed
Out or Doubtful in the run's injury report with the season scoring they take with them. Lines and totals live
in `odds` (the daily job fetches them for every game in the window).
"""
from __future__ import annotations

import datetime as dt

from nba_pipeline.compute import OFF_STATUSES, Build, days_since

LOOKAHEAD_DAYS = 3  # tonight, tomorrow, the day after
WEEK_DAYS = 7
MISSING_STATUSES = ("Out", "Doubtful")


def window(day: dt.date, days: int = LOOKAHEAD_DAYS) -> list[str]:
    return [(day + dt.timedelta(days=i)).isoformat() for i in range(days)]


def upcoming_games(build: Build, days: int = LOOKAHEAD_DAYS) -> list[dict]:
    """Games in the next `days` days that are still on the schedule (postponed and canceled games left out)."""
    dates = set(window(build.today, days))
    games = [g for g in build.games if g["game_date"] in dates and g["status"] not in OFF_STATUSES]
    return sorted(games, key=lambda g: (g["tip"], g["id"]))


def schedule_dates(build: Build) -> dict[str, list[str]]:
    """Every date each team is scheduled to play this season, played or not, postponed games left out."""
    out: dict[str, set[str]] = {}
    for g in build.games:
        if g["status"] in OFF_STATUSES:
            continue
        for t in (g["away_code"], g["home_code"]):
            out.setdefault(t, set()).add(g["game_date"])
    return {t: sorted(ds) for t, ds in out.items()}


def missing_by_team(injuries: list[dict], player_season: list[dict]) -> dict[str, tuple[int, float]]:
    """(players listed Out or Doubtful, their season points per game) by team; names match on team + exact name.

    The same rule as the digest and the web app: a name the box scores spell differently counts as a player
    with no games this season (0 points).
    """
    ppg = {(r["team_code"], r["name"]): r["ppg"] or 0.0 for r in player_season}
    out: dict[str, list] = {}
    for i in injuries:
        if i["status"] not in MISSING_STATUSES:
            continue
        row = out.setdefault(i["team_code"], [0, 0.0])
        row[0] += 1
        row[1] += ppg.get((i["team_code"], i["player_name"]), 0.0)
    return {t: (n, round(p, 1)) for t, (n, p) in out.items()}


def preview_rows(build: Build, injuries: list[dict], covered: set[int]) -> list[dict]:
    """One row per game in the look-ahead window.

    covered: ids of the games the run's injury report speaks for. ESPN's report lists every team, so it covers
    the whole window; an injuries.json input file covers only tonight's games.
    """
    day = build.today
    records = {r["team_code"]: (r["w"], r["l"]) for r in build.team_season}
    dates = schedule_dates(build)
    missing = missing_by_team(injuries, build.player_season)
    rows = []
    for g in upcoming_games(build):
        row = dict(snapshot_date=day.isoformat(), game_id=g["id"], game_code=g["code"], game_date=g["game_date"],
                   days_ahead=(dt.date.fromisoformat(g["game_date"]) - day).days,
                   away_code=g["away_code"], home_code=g["home_code"])
        next_day = (dt.date.fromisoformat(g["game_date"]) + dt.timedelta(days=1)).isoformat()
        for side in ("away", "home"):
            t = g[side + "_code"]
            w, l = records.get(t, (0, 0))
            rest = days_since(dates.get(t, []), g["game_date"])
            row.update({f"{side}_w": w, f"{side}_l": l, f"{side}_rest": rest, f"{side}_b2b": rest == 0,
                        f"{side}_b2b_next": next_day in set(dates.get(t, []))})
            if g["id"] in covered:
                n, ppg = missing.get(t, (0, 0.0))
                row.update({f"{side}_out": n, f"{side}_missing_ppg": ppg})
            else:
                row.update({f"{side}_out": None, f"{side}_missing_ppg": None})
        row["injury_report"] = day.isoformat() if g["id"] in covered else None
        rows.append(row)
    return rows


def check_previews(build: Build, previews: list[dict], odds: list[dict]) -> tuple[list[str], list[str]]:
    """Errors and warnings for the look-ahead, checked against the schedule rows themselves."""
    errs: list[str] = []
    warns: list[str] = []
    sched = {g["id"]: g for g in build.games}
    for d in window(build.today):
        want = sorted(g["id"] for g in build.games if g["game_date"] == d and g["status"] not in OFF_STATUSES)
        got = sorted(p["game_id"] for p in previews if p["game_date"] == d)
        if want != got:
            errs.append(f"look-ahead for {d} has {len(got)} games, the schedule has {len(want)}")
    team_days: dict[str, set[str]] = {}
    for g in build.games:
        if g["status"] not in OFF_STATUSES:
            for t in (g["away_code"], g["home_code"]):
                team_days.setdefault(t, set()).add(g["game_date"])
    for p in previews:
        prev = (dt.date.fromisoformat(p["game_date"]) - dt.timedelta(days=1)).isoformat()
        for side in ("away", "home"):
            t = p[side + "_code"]
            if p[side + "_b2b"] != (prev in team_days.get(t, set())):
                errs.append(f"back-to-back flag for {t} on {p['game_date']} does not match the schedule")
        g = sched.get(p["game_id"])
        if g and p["days_ahead"] == 0 and (g["away_rest"], g["home_rest"]) != (p["away_rest"], p["home_rest"]):
            warns.append(f"rest for {p['game_code']} from the box scores ({g['away_rest']}, {g['home_rest']}) differs "
                         f"from the schedule ({p['away_rest']}, {p['home_rest']}): a game before tonight may be missing")
    tomorrow = [p for p in previews if p["days_ahead"] == 1]
    no_report = [p["game_code"] for p in tomorrow if p["injury_report"] is None]
    if no_report:
        warns.append(f"no injury report covers tomorrow's games: {', '.join(no_report)}")
    priced = {o["game_id"] for o in odds}
    no_odds = [p["game_code"] for p in tomorrow if p["game_id"] not in priced]
    if no_odds:
        warns.append(f"no odds fetched for tomorrow's games: {', '.join(no_odds)}")
    return errs, warns
