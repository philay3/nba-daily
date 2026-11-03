"""Shots: the coordinate system, zones on known spots, the shot file against the box scores, zone profiles."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from helpers import DAY, HOOPR

from nba_pipeline.compute import compute
from nba_pipeline.shots import (ALL, ZONES, build_shots, clock_text, is_free_throw, numbers, profile_rows,
                                three_by_location, zone_numbers, zone_of)
from nba_pipeline.sources.hoopr import read_season, read_shots, season_paths, shots_path
from nba_pipeline.util import r1


@pytest.fixture(scope="module")
def raw():
    return read_shots(shots_path(2027, HOOPR))


@pytest.fixture(scope="module")
def build():
    pb, tb, sc = read_season(season_paths(2027, HOOPR))
    return compute(pb, tb, sc, DAY, 2027)


@pytest.fixture(scope="module")
def sb(raw, build):
    return build_shots(raw, build)


def field_goals(raw):
    return raw[~is_free_throw(raw.type_text)]


# ------------------------------------------------------------------ zones on known spots

# (x, y) in feet from the rim, y toward half court; then three by the line, then the zone
KNOWN = [
    ((0, 0), False, "restricted_area"),   # at the rim
    ((0, 4), False, "restricted_area"),   # 4 ft straight out: the restricted area's edge
    ((4, 0), False, "restricted_area"),
    ((-2, -3), False, "restricted_area"),  # under the basket, behind the rim
    ((3, 3), False, "paint"),             # 4.2 ft: just outside the restricted area, inside the lane
    ((0, 13), False, "paint"),            # just inside the free throw line
    ((8, 10), False, "paint"),            # on the lane line
    ((-8, 14), False, "paint"),           # the elbow
    ((9, 5), False, "midrange"),          # a foot outside the lane
    ((0, 15), False, "midrange"),         # top of the key, inside the arc
    ((21, 0), False, "midrange"),         # baseline long two, a foot inside the corner line
    ((-15, 15), False, "midrange"),       # 21.2 ft on the wing
    ((22, 0), True, "corner_3"),          # on the corner line
    ((-23, 8), True, "corner_3"),         # top of the straight part
    ((22, 9), True, "above_break_3"),     # 23.8 ft, where the corner line meets the arc
    ((0, 24), True, "above_break_3"),     # straight out, past 23.75
    ((-17, 17), True, "above_break_3"),   # 24.0 ft on the wing
    ((0, 23), False, "midrange"),         # 23 ft straight out is still a two
    ((0, 50), True, "backcourt"),         # past half court (41.75 ft from the rim)
]


@pytest.mark.parametrize("spot,three,zone", KNOWN)
def test_zone_on_known_spots(spot, three, zone):
    x, y = spot
    assert three_by_location(x, y) is three
    assert zone_of(x, y, three) == zone


def test_made_shots_use_their_points_not_the_line():
    # a made three logged a foot inside the corner line is still a corner three; a made two past the arc is a midrange two
    assert zone_of(21, 0, True) == "corner_3"
    assert zone_of(0, 25, False) == "midrange"
    assert zone_of(5, 30, True) == "above_break_3"


@pytest.mark.parametrize("raw_clock,shown", [("11:43", "11:43"), ("5:07", "5:07"), ("0:58.3", "58.3"), ("0:0.8", "0.8"),
                                             ("0:05.2", "5.2"), ("0:00.0", "0.0"), ("0:00", "0:00"), (None, "")])
def test_clock_reads_like_a_broadcast(raw_clock, shown):
    assert clock_text(raw_clock) == shown


# ------------------------------------------------------------------ the coordinate system, from the data

def test_rim_is_at_25_0_in_feet(raw):
    fg = field_goals(raw)
    d = np.hypot(fg.coordinate_x_raw - 25, fg.coordinate_y_raw)
    dunks, layups = fg.type_text.str.contains("Dunk"), fg.type_text.str.contains("Layup")
    assert dunks.sum() > 500 and layups.sum() > 2000
    assert d[dunks].median() < 1.5 and (d[dunks] <= 5).mean() > 0.95  # 1.4 ft, 96%
    assert d[layups].median() < 2.5 and (d[layups] <= 6).mean() > 0.92  # 2.2 ft, 93%
    assert d[fg.type_text.str.contains("Jump Shot")].median() > 20
    # free throws are all placed at (25, 13.75): the line is 15 ft from the backboard and the rim 1.25 ft in front of it
    ft = raw[is_free_throw(raw.type_text)]
    assert set(zip(ft.coordinate_x_raw, ft.coordinate_y_raw)) == {(25.0, 13.75)}


def test_whole_feet_one_half_court(raw):
    fg = field_goals(raw)
    assert (fg.coordinate_x_raw % 1 == 0).all() and (fg.coordinate_y_raw % 1 == 0).all()
    assert fg.coordinate_x_raw.between(0, 50).all()
    # every shot is measured toward the basket the team attacks: nothing behind the baseline (5.25 ft behind the rim),
    # and only heaves past half court reach the far baseline (88.75 ft out)
    assert fg.coordinate_y_raw.min() >= -5.25 and fg.coordinate_y_raw.max() <= 88.75
    deep = fg[fg.coordinate_y_raw > 41.75]
    assert deep.type_text.str.startswith("Heave").mean() > 0.9


def test_hoopr_transformed_x_keeps_each_team_on_one_end(raw):
    # why we use the raw columns: coordinate_x puts each team at one end for the whole game, with no switch at the half
    fg = field_goals(raw)
    one_end = fg.groupby(["game_id", "team_id"]).coordinate_x.agg(lambda v: max((v > 0).mean(), (v < 0).mean()))
    assert one_end.min() > 0.95  # only heaves cross half court


def test_three_point_line_matches_made_shots(raw):
    made = field_goals(raw)[lambda f: f.scoring_play]
    calls = np.array([three_by_location(x - 25, y) for x, y in zip(made.coordinate_x_raw, made.coordinate_y_raw)])
    assert (calls == (made.score_value == 3).to_numpy()).mean() > 0.998  # 7443 of 7451 (99.96% over 2025-26)


# ------------------------------------------------------------------ the shot file against the box scores

def test_shot_counts_match_box_score_attempts(sb):
    c = sb.meta["coverage"]
    # the gap, reported: 16,255 shots for 16,257 attempts. 174 of 184 team-games match; in 6 the play-by-play logs
    # a shot fewer than the box score and in 4 a shot more. Makes and made threes match in every team-game.
    assert c == dict(team_games=184, with_shots=184, box_fga=16257, shots=16255, exact=174, short=6, over=4,
                     shots_short=6, shots_over=4, worst=1, fgm_mismatch=0, tpm_mismatch=0, games_without_shots=[])
    assert sb.meta["dropped"] == dict(free_throws=4647, missed_heaves=87, wrong_team=0, unknown_shooter=0,
                                      no_location=0)


def test_missed_heaves_are_not_attempts(raw, build):
    fg = field_goals(raw)
    heaves = fg[fg.type_text.str.startswith("Heave")]
    assert len(heaves) == 87 and not heaves.scoring_play.any()
    # with them the file has 85 more attempts than the box scores; without them, 2 fewer
    assert len(fg) - sum(t["fga"] for t in build.team_games) == 85


def test_shot_points_are_points_less_free_throws(sb, build):
    allz = {(r["game_id"], r["team_code"]): r for r in sb.game_zones if r["zone"] == ALL}
    for t in build.team_games:
        assert allz[(t["game_id"], t["team_code"])]["pts"] == t["pts"] - t["ftm"], (t["game_id"], t["team_code"])


def test_assisted_makes_match_box_score_assists(sb, build):
    allz = {(r["game_id"], r["team_code"]): r for r in sb.game_zones if r["zone"] == ALL}
    diff = [allz[(t["game_id"], t["team_code"])]["ast"] - t["ast"] for t in build.team_games]
    assert sum(d == 0 for d in diff) == 183 and max(map(abs, diff)) == 1


def test_paint_points_match_espn(sb, build):
    # ESPN's points in the paint against our restricted area and paint makes: the lane edges are the real ones
    paint: dict[tuple, int] = {}
    for r in sb.game_zones:
        if r["zone"] in ("restricted_area", "paint"):
            k = (r["game_id"], r["team_code"])
            paint[k] = paint.get(k, 0) + r["pts"]
    diff = [paint[(t["game_id"], t["team_code"])] - t["paint"] for t in build.team_games]
    assert max(map(abs, diff)) <= 2 and sum(d == 0 for d in diff) == 146


def test_every_shooter_and_passer_is_on_the_team(sb, build):
    team_of = {(p["game_id"], p["player_id"]): p["team_code"] for p in build.player_games}
    for s in sb.shots:
        assert team_of[(s["game_id"], s["player_id"])] == s["team_code"]
        if s["assisted"]:
            assert s["made"] and team_of[(s["game_id"], s["assist_id"])] == s["team_code"]


def test_rows_are_in_game_order(sb):
    seen: dict[int, list] = {}
    for s in sb.shots:
        seen.setdefault(s["game_id"], []).append(s["seq"])
    assert all(v == list(range(1, len(v) + 1)) for v in seen.values())


def test_no_shot_file_leaves_the_tables_alone(build):
    out = build_shots(None, build)
    assert not out.available and out.shots == [] and out.notes


@pytest.mark.parametrize("shot_file,warning", [("missing", "shots: no shot file for 2027"),
                                               ("broken", "shots: the shot file could not be read")])
def test_a_run_carries_on_without_shots(tmp_path, shot_file, warning):
    import shutil

    from helpers import INPUTS

    from nba_pipeline.run import run_day
    for f in HOOPR.glob("*_2027.parquet"):
        if not f.name.startswith("shots"):
            shutil.copy(f, tmp_path / f.name)
    if shot_file == "broken":  # say hoopR renamed a column
        pd.read_parquet(HOOPR / "shots_2027.parquet").drop(columns=["coordinate_x_raw"]).to_parquet(
            tmp_path / "shots_2027.parquet")
    res = run_day(DAY, source_dir=tmp_path, inputs_dir=INPUTS, use_espn=False, offline=True, write=False)
    assert res.errors == [] and res.build.meta["season_games"] == 92
    assert not res.shots.available and [w for w in res.warnings if w.startswith("shots:")][0].startswith(warning)


# ------------------------------------------------------------------ zone profiles

def test_numbers_on_a_small_example():
    S = pd.DataFrame(dict(zone=["restricted_area"] * 3 + ["corner_3"] * 2 + ["midrange"],
                          made=[True, True, False, True, False, False], points=[2, 2, 0, 3, 0, 0],
                          assisted=[True, False, False, True, False, False]))
    z = zone_numbers(S)
    assert z["restricted_area"] == dict(fga=3, fgm=2, pts=4, ast=1, fg_pct=66.7, pps=1.33, share=50.0, ast_pct=50.0)
    assert z["corner_3"] == dict(fga=2, fgm=1, pts=3, ast=1, fg_pct=50.0, pps=1.5, share=33.3, ast_pct=100.0)
    assert z["paint"] == numbers(0, 0, 0, 0, 6) == dict(fga=0, fgm=0, pts=0, ast=0, fg_pct=None, pps=None, share=0.0,
                                                        ast_pct=None)
    assert z[ALL] == dict(fga=6, fgm=3, pts=7, ast=2, fg_pct=50.0, pps=1.17, share=100.0, ast_pct=66.7)
    rows = profile_rows(S.assign(team_code="NYK"), ["team_code"], z)
    assert [r["zone"] for r in rows] == ZONES + [ALL]
    assert all(r["fg_pct_diff"] in (0.0, None) for r in rows)


def _sum(rows, zone):
    return tuple(sum(r[k] for r in rows if r["zone"] == zone) for k in ("fga", "fgm", "pts", "ast"))


def test_profiles_add_up(sb):
    league = {r["zone"]: r for r in sb.league}
    off = [r for r in sb.teams if r["side"] == "offense"]
    dfn = [r for r in sb.teams if r["side"] == "defense"]
    assert len(off) == len(dfn) == 30 * 7
    for z in ZONES + [ALL]:
        lg = tuple(league[z][k] for k in ("fga", "fgm", "pts", "ast"))
        # every shot is one team's offense and another team's defense, one player's attempt and one game's
        assert _sum(off, z) == _sum(dfn, z) == _sum(sb.players, z) == _sum(sb.game_zones, z) == lg, z
    assert league[ALL]["fga"] == len(sb.shots)
    assert sum(league[z]["fga"] for z in ZONES) == league[ALL]["fga"]


def test_team_season_zones_are_the_sum_of_its_games(sb):
    by_team: dict[tuple, list] = {}
    for r in sb.game_zones:
        by_team.setdefault((r["team_code"], r["zone"]), []).append(r)
    for r in sb.teams:
        if r["side"] == "offense":
            g = by_team[(r["team_code"], r["zone"])]
            assert (r["fga"], r["fgm"], r["pts"]) == tuple(sum(x[k] for x in g) for k in ("fga", "fgm", "pts"))


def test_rates_follow_from_the_counts(sb):
    for r in sb.league + sb.teams + sb.players + sb.game_zones:
        if r["fga"]:
            assert r["fg_pct"] == r1(100 * r["fgm"] / r["fga"])
            assert r["pps"] == round(r["pts"] / r["fga"], 2)
        else:
            assert r["fg_pct"] is None and r["pps"] is None
        if "lg_fg_pct" in r and r["fg_pct"] is not None:
            assert r["fg_pct_diff"] == r1(r["fg_pct"] - r["lg_fg_pct"])
    # shares of one subject add up to 100, give or take rounding
    for t in {r["team_code"] for r in sb.teams}:
        rows = [r for r in sb.teams if r["team_code"] == t and r["side"] == "offense" and r["zone"] != ALL]
        assert abs(sum(r["share"] for r in rows) - 100) <= 0.3


def test_league_zones_on_the_fixture_day(sb):
    lg = {r["zone"]: (r["fga"], r["fg_pct"], r["pps"], r["share"]) for r in sb.league}
    assert lg == {"restricted_area": (4328, 67.0, 1.34, 26.6), "paint": (3414, 44.4, 0.89, 21.0),
                  "midrange": (1551, 40.0, 0.8, 9.5), "corner_3": (1811, 35.8, 1.07, 11.1),
                  "above_break_3": (5146, 34.3, 1.03, 31.7), "backcourt": (5, 80.0, 2.4, 0.0),
                  ALL: (16255, 45.8, 1.07, 100.0)}


def test_box_score_threes_match_the_three_zones(sb, build):
    threes = sum(r["fga"] for r in sb.league if r["zone"] in ("corner_3", "above_break_3", "backcourt"))
    made = sum(r["fgm"] for r in sb.league if r["zone"] in ("corner_3", "above_break_3", "backcourt"))
    box_tpa, box_tpm = sum(t["tpa"] for t in build.team_games), sum(t["tpm"] for t in build.team_games)
    assert made == box_tpm  # makes by their points: exact
    assert abs(threes - box_tpa) <= 5  # misses by the line
