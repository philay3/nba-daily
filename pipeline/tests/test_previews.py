"""The look-ahead (Task 3): every game day this season and the next 3 days of matchups.

Checks against the schedule file itself, not against our own code paths: game counts per day, rest days and
back-to-backs, postponed games, injuries mapped to each team's next game, odds for every game in the window,
and the missing-scoring numbers against the original engine's digest.
"""
from __future__ import annotations

import datetime as dt
import json
import re

import pandas as pd
import pytest
from helpers import DAY, ESPN, GOLDEN, HOOPR, INPUTS

import nba_pipeline.run as run_mod
from nba_pipeline.compute import compute
from nba_pipeline.export import injuries_rows
from nba_pipeline.previews import check_previews, missing_by_team, preview_rows, upcoming_games
from nba_pipeline.run import injury_rows_from_file, run_day
from nba_pipeline.sources.espn import game_day_status, parse_injuries
from nba_pipeline.sources.hoopr import read_season, season_paths
from nba_pipeline.sources.inputs import read_inputs
from nba_pipeline.teams import CODES, code

WED = dt.date(2026, 11, 4)  # 14 games; tomorrow (Thu) has MIA@GSW and ORL@PHX, both with a team on a back-to-back


@pytest.fixture(scope="module")
def season():
    return read_season(season_paths(2027, HOOPR))


@pytest.fixture(scope="module")
def raw_schedule(season):
    """The schedule file as plain rows: regular season, two NBA teams, our team codes."""
    sc = season[2]
    sc = sc[sc.season_type == 2].copy()
    sc["away"], sc["home"] = sc.away_abbreviation.map(code), sc.home_abbreviation.map(code)
    sc = sc[sc.away.isin(CODES) & sc.home.isin(CODES)]
    sc["game_date"] = sc.game_date.astype(str)
    return sc


@pytest.fixture(scope="module")
def build_mon(season):
    return compute(*season, DAY, 2027)


@pytest.fixture(scope="module")
def build_wed(season):
    return compute(*season, WED, 2027)


def team_dates(sc: pd.DataFrame) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for _, r in sc.iterrows():
        for t in (r.away, r.home):
            out.setdefault(t, set()).add(r.game_date)
    return out


def rest_from(dates: set[str], day: str):
    before = [d for d in dates if d < day]
    return None if not before else (dt.date.fromisoformat(day) - dt.date.fromisoformat(max(before))).days - 1


# ------------------------------------------------------------------ the schedule

def test_whole_schedule_is_kept(build_mon, raw_schedule):
    assert {g["id"] for g in build_mon.games} == {int(g) for g in raw_schedule.game_id}
    assert min(g["game_date"] for g in build_mon.games) == "2026-10-20"
    assert max(g["game_date"] for g in build_mon.games) == "2027-04-11"


def test_each_upcoming_day_has_the_schedules_game_count(build_mon, build_wed, raw_schedule):
    for build in (build_mon, build_wed):
        rows = preview_rows(build, [], set())
        for i in range(3):
            d = (build.today + dt.timedelta(days=i)).isoformat()
            assert sum(p["game_date"] == d for p in rows) == int((raw_schedule.game_date == d).sum()), d
    # Monday: 15 tonight, none on Election Day, 14 on Wednesday
    assert [sum(p["days_ahead"] == i for p in preview_rows(build_mon, [], set())) for i in range(3)] == [15, 0, 14]


def test_future_rest_days_match_the_schedule(build_mon, raw_schedule):
    dates = team_dates(raw_schedule)
    future = [g for g in build_mon.games if g["game_date"] > DAY.isoformat()]
    assert len(future) == 1200 - 92 - 15
    for g in future:
        assert g["away_rest"] == rest_from(dates[g["away_code"]], g["game_date"]), g["code"]
        assert g["home_rest"] == rest_from(dates[g["home_code"]], g["game_date"]), g["code"]


def test_back_to_backs_before_either_game_is_played(build_wed, raw_schedule):
    rows = {p["game_code"]: p for p in preview_rows(build_wed, [], set())}
    # Wed Nov 4 MIA at LAC, Thu Nov 5 MIA at GSW; Wed POR at PHX, Thu ORL at PHX
    assert rows["MIA@GSW"]["away_b2b"] and rows["MIA@GSW"]["away_rest"] == 0 and not rows["MIA@GSW"]["home_b2b"]
    assert rows["ORL@PHX"]["home_b2b"] and not rows["ORL@PHX"]["away_b2b"]
    assert rows["MIA@LAC"]["away_b2b_next"] and rows["POR@PHX"]["home_b2b_next"]
    assert not rows["MIA@LAC"]["away_b2b"]
    dates = team_dates(raw_schedule)
    for p in rows.values():
        prev = (dt.date.fromisoformat(p["game_date"]) - dt.timedelta(days=1)).isoformat()
        nxt = (dt.date.fromisoformat(p["game_date"]) + dt.timedelta(days=1)).isoformat()
        for side in ("away", "home"):
            assert p[side + "_b2b"] == (prev in dates[p[side + "_code"]])
            assert p[side + "_b2b_next"] == (nxt in dates[p[side + "_code"]])


def test_tonights_rest_from_the_schedule_matches_the_engine(build_mon):
    rows = preview_rows(build_mon, [], set())
    errs, warns = check_previews(build_mon, rows, [])
    assert errs == [] and not [w for w in warns if "rest" in w]
    games = {g["id"]: g for g in build_mon.games}
    for p in rows:
        if p["days_ahead"] == 0:
            assert (p["away_rest"], p["home_rest"]) == (games[p["game_id"]]["away_rest"], games[p["game_id"]]["home_rest"])


def test_records_are_through_the_run_date(build_wed, raw_schedule):
    """Wins and losses entering Wednesday, counted straight from the final scores in the schedule file."""
    fin = raw_schedule[(raw_schedule.status_type_name == "STATUS_FINAL") & (raw_schedule.game_date < WED.isoformat())]
    rec: dict[str, list[int]] = {}
    for _, r in fin.iterrows():
        a, h = int(r.away_score), int(r.home_score)
        rec.setdefault(r.away, [0, 0])[0 if a > h else 1] += 1
        rec.setdefault(r.home, [0, 0])[0 if h > a else 1] += 1
    for p in preview_rows(build_wed, [], set()):
        assert [p["away_w"], p["away_l"]] == rec.get(p["away_code"], [0, 0])
        assert [p["home_w"], p["home_l"]] == rec.get(p["home_code"], [0, 0])


def test_postponed_game_leaves_the_look_ahead_and_the_rest_math(season):
    pb, tb, sc = season
    sc = sc.copy()
    # postpone MIA at LAC on Wednesday: Thursday's MIA at GSW is then no longer a back-to-back
    sc.loc[sc.game_id.astype(int) == 401909935, "status_type_name"] = "STATUS_POSTPONED"
    build = compute(pb, tb, sc, WED, 2027)
    rows = preview_rows(build, [], set())
    assert 401909935 not in {p["game_id"] for p in rows}
    assert sum(p["days_ahead"] == 0 for p in rows) == 13
    gsw = next(p for p in rows if p["game_code"] == "MIA@GSW")
    assert not gsw["away_b2b"] and gsw["away_rest"] == 2
    assert next(g for g in build.games if g["id"] == 401909935)["status"] == "STATUS_POSTPONED"
    assert check_previews(build, rows, [])[0] == []


def test_check_catches_a_wrong_count_and_a_wrong_flag(build_wed):
    rows = preview_rows(build_wed, [], set())
    bad = [dict(r) for r in rows[1:]]
    bad[0]["away_b2b"] = not bad[0]["away_b2b"]
    errs, _ = check_previews(build_wed, bad, [])
    assert any("look-ahead for 2026-11-04" in e for e in errs)
    assert any("back-to-back flag" in e for e in errs)


# ------------------------------------------------------------------ injuries and missing scoring

def test_missing_scoring_matches_the_engines_digest(build_mon):
    inputs = read_inputs(INPUTS)
    tonight = [g for g in build_mon.games if g["game_date"] == DAY.isoformat()]
    inj = injury_rows_from_file(DAY, inputs.injuries, tonight, build_mon.player_season)
    rows = preview_rows(build_mon, inj, {g["id"] for g in tonight})
    digest = {m.group(1): float(m.group(2)) for m in
              re.finditer(r"^  ([A-Z]{3}) injuries, ([0-9.]+) season PPG", (GOLDEN / "digest.txt").read_text(), re.M)}
    assert len(digest) == 30
    for p in rows:
        if p["days_ahead"] == 0:
            assert p["injury_report"] == DAY.isoformat()
            assert p["away_missing_ppg"] == digest[p["away_code"]], p["game_code"]
            assert p["home_missing_ppg"] == digest[p["home_code"]], p["game_code"]
        else:  # the input file speaks only for tonight
            assert p["injury_report"] is None and p["away_missing_ppg"] is None


def test_missing_counts_out_and_doubtful_only():
    inj = [dict(team_code="BOS", player_name="A", status="Out"), dict(team_code="BOS", player_name="B", status="Doubtful"),
           dict(team_code="BOS", player_name="C", status="Questionable"), dict(team_code="BOS", player_name="Nobody", status="Out")]
    ps = [dict(team_code="BOS", name="A", ppg=10.25), dict(team_code="BOS", name="B", ppg=5.0), dict(team_code="BOS", name="C", ppg=20.0)]
    assert missing_by_team(inj, ps) == {"BOS": (3, 15.2)}


JS = {"injuries": [
    {"displayName": "Miami Heat", "injuries": [
        {"status": "Day-To-Day", "shortComment": "Smith is questionable for Thursday's game against the Warriors.",
         "athlete": {"displayName": "Jo Smith", "team": {"abbreviation": "MIA"}}, "details": {"type": "Ankle"}},
        {"status": "Day-To-Day", "shortComment": "Lee is doubtful for tonight's game.",
         "athlete": {"displayName": "Al Lee", "team": {"abbreviation": "MIA"}}, "details": {"type": "Knee"}}]},
    {"displayName": "Golden State Warriors", "injuries": [
        {"status": "Day-To-Day", "shortComment": "Park is doubtful for Thursday's game.",
         "athlete": {"displayName": "Sam Park", "team": {"abbreviation": "GS"}}, "details": {"type": "Hip"}},
        {"status": "Out", "shortComment": "Out.", "athlete": {"displayName": "Gone Guy", "team": {"abbreviation": "GS"}}}]},
    {"displayName": "Boston Celtics", "injuries": [
        {"status": "Out", "athlete": {"displayName": "Not Playing Soon", "team": {"abbreviation": "BOS"}}}]},
]}
GAMES = [dict(code="MIA@LAC", away="MIA", home="LAC", tip="2026-11-05T03:30:00Z", id=401909935, game_date="2026-11-04"),
         dict(code="MIA@GSW", away="MIA", home="GSW", tip="2026-11-06T03:00:00Z", id=401909937, game_date="2026-11-05")]


def test_injuries_point_at_each_teams_next_game():
    rows = {r["player"]: r for r in parse_injuries(JS, WED, GAMES)}
    assert set(rows) == {"Jo Smith", "Al Lee", "Sam Park", "Gone Guy"}  # BOS plays in neither game
    assert rows["Jo Smith"]["game_id"] == "MIA@LAC"  # Miami's next game is tonight's
    assert rows["Sam Park"]["game_id"] == "MIA@GSW" and rows["Sam Park"]["game_espn_id"] == 401909937
    # Thursday's designation is about Thursday, not about Miami's game tonight
    assert rows["Jo Smith"]["status"] == "Day-to-day"
    assert rows["Al Lee"]["status"] == "Doubtful"
    assert rows["Sam Park"]["status"] == "Doubtful"  # the Warriors' next game is Thursday
    assert [r["player"] for r in parse_injuries(JS, WED, GAMES)][:2] == ["Al Lee", "Jo Smith"]  # tonight first


def test_tonight_only_counts_for_tonights_game():
    assert game_day_status("Lee is doubtful for tonight's game.", dt.date(2026, 11, 5), tonight=False) is None
    assert game_day_status("Lee is doubtful for Thursday's game.", dt.date(2026, 11, 5), tonight=False) == "Doubtful"


def test_dashboard_injuries_file_keeps_tonights_teams_only():
    tables = dict(tonight=[dict(away_code="MIA", home_code="LAC")], injuries=[
        dict(game_code="MIA@LAC", team_code="MIA", player_name="A", position="", status="Out", injury="", note="", sort_order=0),
        dict(game_code="MIA@GSW", team_code="GSW", player_name="B", position="", status="Out", injury="", note="", sort_order=1)])
    assert [r["player"] for r in injuries_rows(tables)] == ["A"]


# ------------------------------------------------------------------ the daily run with ESPN (from fixtures)

def test_espn_run_fills_tomorrow_completely(monkeypatch):
    summary = json.loads((ESPN / "summary_401909906_final.json").read_text())
    asked: list[int] = []

    class NoNetwork:
        def close(self):
            pass

    def fake_summary(client, gid):
        asked.append(gid)
        return summary

    injuries = json.loads((ESPN / "injuries_synthetic.json").read_text())
    monkeypatch.setattr(run_mod, "http_client", lambda: NoNetwork())
    monkeypatch.setattr(run_mod, "fetch_summary", fake_summary)
    monkeypatch.setattr(run_mod, "fetch_injuries", lambda client: injuries)
    res = run_day(WED, source_dir=HOOPR, use_espn=True, write=False)
    ids = [g["id"] for g in upcoming_games(res.build)]
    assert len(ids) == 14 + 2 + 9
    assert sorted(asked) == sorted(ids)  # one summary per game in the window, tonight's included
    assert {o["game_id"] for o in res.odds} == set(ids) and all(o["line"] for o in res.odds)
    tomorrow = [p for p in res.previews if p["days_ahead"] == 1]
    assert len(tomorrow) == 2
    for p in tomorrow:
        assert p["injury_report"] == WED.isoformat()
        assert p["away_missing_ppg"] is not None and p["home_missing_ppg"] is not None
    assert res.errors == []
    assert not [w for w in res.warnings if "tomorrow" in w]
    assert {i["game_code"] for i in res.injuries} <= {p["game_code"] for p in res.previews}
