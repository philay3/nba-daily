"""ESPN parsers against saved responses (ESPN itself is never called from tests)."""
from __future__ import annotations

import copy
import datetime as dt
import json

import pytest
from helpers import ESPN

from nba_pipeline.sources.espn import (game_day_status, map_line, normalize_name, odds_from_summary, parse_injuries,
                                       short_position)
from nba_pipeline.sources.patch import from_patch, summary_to_patch
from nba_pipeline.sources.raw import is_completed, parse_raw

GID = 401909906


@pytest.fixture(scope="module")
def summary():
    return json.loads((ESPN / f"summary_{GID}_final.json").read_text())


@pytest.fixture(scope="module")
def patch():
    return json.loads((ESPN / f"patch_{GID}.json").read_text())


# ------------------------------------------------------------------ pickcenter odds

def test_pickcenter_odds(summary):
    o = odds_from_summary(summary)
    assert o["provider"] == "DraftKings"
    assert o["line"] == "LAL -3.5"
    assert o["spread_abs"] == 3.5
    assert o["total"] == 224.5
    assert (o["away_ml"], o["home_ml"]) == (142, -170)
    # no predictor on a final game: win odds come from the no-vig moneyline split
    assert o["wp_source"] == "moneyline"
    assert (o["away_wp"], o["home_wp"]) == (39.6, 60.4)


def test_pickcenter_maps_espn_codes_and_even(summary):
    js = copy.deepcopy(summary)
    js["pickcenter"][0]["details"] = "GS -4.5"
    assert odds_from_summary(js)["line"] == "GSW -4.5"
    js["pickcenter"][0]["details"] = "EVEN"
    js["pickcenter"][0]["spread"] = 0
    o = odds_from_summary(js)
    assert (o["line"], o["spread_abs"]) == ("EVEN", 0.0)
    assert map_line("UTAH -2") == "UTA -2" and map_line("WSH -1.5") == "WAS -1.5" and map_line(None) is None


def test_no_odds_posted(summary):
    js = copy.deepcopy(summary)
    js["pickcenter"] = []
    o = odds_from_summary(js)
    assert o["line"] is None and o["spread_abs"] is None and o["total"] is None and o["away_wp"] is None


def test_predictor_wins_over_moneyline(summary):
    js = copy.deepcopy(summary)
    js["predictor"] = {"awayTeam": {"gameProjection": "38.5"}, "homeTeam": {"gameProjection": "61.5"}}
    o = odds_from_summary(js)
    assert (o["away_wp"], o["home_wp"], o["wp_source"]) == (38.5, 61.5, "espn_predictor")


# ------------------------------------------------------------------ summary -> PATCH FORMAT

def test_summary_to_patch_matches_fixture(summary, patch):
    assert summary_to_patch(summary) == patch


def test_team_turnovers_use_total_turnovers(summary):
    p = summary_to_patch(summary)
    assert p["teams"]["LAL"]["tov"] == 24  # totalTurnovers (22 player + 2 team), not turnovers
    assert p["teams"]["TOR"]["tov"] == 15


def test_patch_and_raw_rows_agree(summary, patch):
    assert is_completed(summary)
    prow_r, trow_r, periods_r = parse_raw(GID, summary, "2026-11-01")
    prow_p, trow_p, periods_p, n_per = from_patch(patch, "2026-11-01")
    assert [tuple(p) for p in periods_r] == periods_p and n_per == 4
    keys = ["minutes", "points", "field_goals_made", "field_goals_attempted", "three_point_field_goals_made",
            "three_point_field_goals_attempted", "free_throws_made", "free_throws_attempted", "offensive_rebounds",
            "defensive_rebounds", "rebounds", "assists", "steals", "blocks", "turnovers", "fouls"]
    raw = {r["athlete_id"]: r for r in prow_r}
    for p in prow_p:
        r = raw[p["athlete_id"]]
        assert r["did_not_play"] == p["did_not_play"]
        if not p["did_not_play"]:
            assert [r[k] for k in keys] == [p[k] for k in keys], p["athlete_display_name"]
            assert float(r["plus_minus"]) == float(p["plus_minus"])
    tk = ["field_goals_made", "field_goals_attempted", "total_turnovers", "offensive_rebounds", "largest_lead"]
    for a, b in zip(sorted(trow_r, key=lambda t: t["team_abbreviation"]), sorted(trow_p, key=lambda t: t["team_abbreviation"])):
        assert [a[k] for k in tk] == [b[k] for k in tk]
        assert a["team_score"] == b["team_score"]


def test_patch_rejects_period_scores_that_do_not_add_up(patch):
    bad = copy.deepcopy(patch)
    bad["periods"][0][0] += 1
    with pytest.raises(ValueError):
        from_patch(bad, "2026-11-01")


def test_patch_without_line_score_counts_overtime_from_minutes(patch):
    p = copy.deepcopy(patch)
    p["periods"] = []
    *_, n_per = from_patch(p, "2026-11-01")
    assert n_per == 4


# ------------------------------------------------------------------ injuries

TONIGHT = dt.date(2026, 11, 2)  # a Monday
GAMES = [dict(code="OKC@CLE", away="OKC", home="CLE", tip="2026-11-03T00:00:00Z", id=401909907),
         dict(code="MIA@LAL", away="MIA", home="LAL", tip="2026-11-03T03:00:00Z", id=401909921),
         dict(code="PHX@GSW", away="PHX", home="GSW", tip="2026-11-03T03:00:00Z", id=401909919)]
BY_NAME = {"Oklahoma City Thunder": "OKC", "Cleveland Cavaliers": "CLE", "Golden State Warriors": "GSW",
           "Los Angeles Lakers": "LAL", "Boston Celtics": "BOS"}
ROSTER = {"LAL": ["Luka Doncic", "Austin Reaves"], "OKC": ["Chet Holmgren"]}


@pytest.fixture(scope="module")
def injuries():
    js = json.loads((ESPN / "injuries_synthetic.json").read_text())
    return parse_injuries(js, TONIGHT, GAMES, by_name=BY_NAME, roster=ROSTER)


def test_injuries_keep_tonights_teams_sorted(injuries):
    assert [(r["team"], r["player"], r["status"]) for r in injuries] == [
        ("OKC", "Chet Holmgren", "Out"),
        ("CLE", "Peyton Watson", "Questionable"),
        ("CLE", "Sam Merrill", "Day-to-day"),
        ("LAL", "Luka Doncic", "Probable"),
        ("GSW", "Draymond Green", "Out"),
        ("GSW", "Stephen Curry", "Out"),
    ]


def test_injury_fields(injuries):
    by = {r["player"]: r for r in injuries}
    assert by["Chet Holmgren"] | {} == by["Chet Holmgren"]
    assert (by["Chet Holmgren"]["injury"], by["Chet Holmgren"]["note"], by["Chet Holmgren"]["pos"]) == ("Knee", "Patellar Tendon; ~January", "C")
    assert (by["Peyton Watson"]["note"], by["Peyton Watson"]["pos"], by["Peyton Watson"]["game_id"]) == ("Sprain; ~Nov 3", "F", "OKC@CLE")
    assert by["Sam Merrill"]["note"] == ""
    assert (by["Draymond Green"]["injury"], by["Draymond Green"]["status"]) == ("Suspension", "Out")
    assert by["Stephen Curry"]["injury"] == "Rest"
    assert by["Peyton Watson"]["return_date"] == "2026-11-03"


def test_game_day_designation_rules():
    assert game_day_status("Smith is doubtful for Monday's game.", TONIGHT) == "Doubtful"
    assert game_day_status("Smith has been ruled out for tonight's game.", TONIGHT) == "Out"
    assert game_day_status("Smith is questionable for Tuesday's game.", TONIGHT) is None
    assert game_day_status("", TONIGHT) is None


def test_name_and_position_helpers():
    assert normalize_name("Luka Dončić") == normalize_name("Luka Doncic")
    assert normalize_name("Larry Nance Jr.") == normalize_name("Larry Nance")
    assert [short_position(p) for p in ("PG", "SF", "C", "F-C", "", None)] == ["G", "F", "C", "F", "", ""]
