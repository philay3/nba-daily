"""Story finder: the z-score math on synthetic numbers, each rule on small synthetic seasons, and the fixture day
checked for look-ahead and for "first this season" claims against an independent read of the raw box scores."""
from __future__ import annotations

import datetime as dt
import math
from statistics import NormalDist

import numpy as np
import pandas as pd
import pytest
from helpers import DAY, HOOPR

from nba_pipeline import stories as st
from nba_pipeline.compute import Build, compute
from nba_pipeline.sources.hoopr import read_season, season_paths

# ------------------------------------------------------------------ math


def test_baseline_matches_numpy():
    rng = np.random.default_rng(7)
    for n in (2, 3, 10, 41):
        x = rng.normal(20, 6, n).round().tolist()
        k, mean, sd = st.baseline(x)
        assert k == n
        assert mean == pytest.approx(np.mean(x))
        assert sd == pytest.approx(np.std(x, ddof=1))


def test_baseline_small_samples():
    assert st.baseline([]) == (0, None, None)
    assert st.baseline([12.0]) == (1, 12.0, None)


def test_zscore_and_floor():
    assert st.zscore(30, 20, 5) == pytest.approx(2.0)
    assert st.zscore(10, 20, 5) == pytest.approx(-2.0)
    # a tiny spread is raised to the floor; no spread and no floor gives no z
    assert st.zscore(26, 20, 1.0, floor=4.0) == pytest.approx(1.5)
    assert st.zscore(26, 20, None, floor=4.0) == pytest.approx(1.5)
    assert st.zscore(26, 20, 0.0) is None
    assert st.zscore(26, None, 3.0) is None


def test_z_of_synthetic_normal_data():
    """On a large normal sample, about 2.3% of values sit 2 standard deviations above the mean."""
    rng = np.random.default_rng(11)
    x = rng.normal(15, 5, 200_000)
    _, mean, sd = st.baseline(x.tolist())
    share = np.mean([(v - mean) / sd >= 2 for v in x[:50_000]])
    assert share == pytest.approx(1 - NormalDist().cdf(2), abs=0.003)


def test_rarity_of_p():
    assert st.rarity_of_p(0.5) == 0.0
    assert st.rarity_of_p(0.9) == 0.0
    assert st.rarity_of_p(1 - NormalDist().cdf(2)) == pytest.approx(2.0)
    assert st.rarity_of_p(1e-12) == st.RARITY_CAP


def test_true_shooting():
    assert st.ts_pct(30, 20, 10) == pytest.approx(100 * 30 / (2 * (20 + 4.4)))
    assert st.ts_pct(0, 0, 0) is None


# ------------------------------------------------------------------ synthetic seasons

TEAMS = ("BOS", "NYK")


def season(lines: dict[int, list[dict]], start=dt.date(2026, 10, 21)) -> Build:
    """lines: player id -> one dict per night (pts, reb, ast, tpm, ...; dnp=True for a night he sat).
    Every player is on BOS; BOS plays NYK every night."""
    nights = max(len(v) for v in lines.values())
    pgs, tgs = [], []
    for i in range(nights):
        day = (start + dt.timedelta(days=i)).isoformat()
        gid = 1000 + i
        for pid, lst in lines.items():
            if i >= len(lst):
                continue
            r = lst[i]
            pts = r.get("pts", 10)
            pgs.append(dict(game_id=gid, player_id=pid, team_code="BOS", opp_code="NYK", home_away="home",
                            game_date=day, name=f"Player {pid}", did_not_play=bool(r.get("dnp")),
                            min=0.0 if r.get("dnp") else r.get("min", 30.0), pts=pts, reb=r.get("reb", 4),
                            ast=r.get("ast", 3), stl=r.get("stl", 1), blk=r.get("blk", 0), tov=r.get("tov", 2),
                            fgm=r.get("fgm", pts // 2), fga=r.get("fga", 15), tpm=r.get("tpm", 1),
                            tpa=r.get("tpa", 4), ftm=r.get("ftm", 2), fta=r.get("fta", 3),
                            plus_minus=r.get("pm", 0)))
        for code, opp, net in (("BOS", "NYK", 2.0), ("NYK", "BOS", -2.0)):
            tgs.append(dict(game_id=gid, team_code=code, opp_code=opp, game_date=day, win=net > 0, pts=110,
                            opp_pts=108, fga=88, fta=22, tov=14, minutes=48, poss=100.0, net=net))
    today = start + dt.timedelta(days=nights)
    return Build(today=today, yesterday=today - dt.timedelta(days=1), season=2027, meta={}, player_games=pgs,
                 team_games=tgs)


def found(build: Build, kind: str | None = None, pid: int | None = None) -> list[dict]:
    """Every candidate story (before the top 20 cut), straight from the rules."""
    cands, _ = st.find_candidates(build)
    return [s for rows in cands.values() for s in rows
            if (kind is None or s["kind"] == kind) and (pid is None or s["player_id"] == pid)]


def test_outlier_z_is_against_games_before_only():
    pts = [10, 14, 12, 16, 30]
    b = season({1: [dict(pts=p) for p in pts]})
    s = [x for x in found(b, "outlier") if x["subtype"] == "pts_high"]
    assert len(s) == 1
    _, mean, sd = st.baseline([10, 14, 12, 16])
    assert s[0]["baseline"] == round(mean, 1) and s[0]["sd"] == round(sd, 1)
    assert s[0]["z"] == pytest.approx((30 - mean) / max(sd, 4.0), abs=0.005)
    assert s[0]["evidence"]["season"]["n"] == 4


def test_outlier_needs_four_games_before():
    b = season({1: [dict(pts=p) for p in (10, 12, 11, 40)]})
    assert not [x for x in found(b, "outlier") if x["subtype"] == "pts_high"]


def test_low_scoring_night_only_for_a_scorer():
    scorer = [dict(pts=p) for p in (25, 27, 24, 26, 6)]
    bench = [dict(pts=p, min=12.0) for p in (12, 14, 13, 12, 0)]
    b = season({1: scorer, 2: bench})
    subtypes = {(x["player_id"], x["subtype"]) for x in found(b)}
    assert (1, "pts_low") in subtypes
    assert (2, "pts_low") not in subtypes


def test_streak_counts_games_played_and_dnp_does_not_break_it():
    lines = [dict(pts=8), dict(pts=22), dict(pts=21), dict(dnp=True), dict(pts=25)]
    b = season({1: lines})
    s = [x for x in found(b, "streak") if x["subtype"] == "pts20"]
    # the streak reaches 3 on the last night
    assert [x["value"] for x in s] == [3]
    assert [g["pts"] for g in s[0]["evidence"]["games"]] == [22, 21, 25]


def test_streak_probability():
    """p = rate ** length, with the rate shrunk toward the league's."""
    lines = [dict(pts=p) for p in (8, 22, 21, 25)]
    b = season({1: lines, 2: [dict(pts=5)] * 4})
    s = [x for x in found(b, "streak") if x["subtype"] == "pts20"][0]
    ev = s["evidence"]
    # league through the night: player 1 has 3 of 4, player 2 none of 4
    lg = (3 + 1) / (8 + 2)
    rate = (3 + st.PRIOR_GAMES * lg) / (4 + st.PRIOR_GAMES)
    assert ev["league_rate"] == pytest.approx(lg, abs=1e-3)
    assert ev["rate"] == pytest.approx(rate, abs=1e-3)
    assert s["rarity"] == pytest.approx(st.rarity_of_p(rate ** 3), abs=0.01)


def test_first_this_season_is_true():
    # player 1 already scored 20 in his first game: a later 25 is not a first
    # player 2 never had 20 before: it is
    b = season({1: [dict(pts=p) for p in (22, 10, 12, 8, 25)], 2: [dict(pts=p) for p in (10, 12, 8, 9, 25)]})
    firsts = {(x["player_id"], x["subtype"]) for x in found(b, "first")}
    assert (2, "pts20") in firsts
    assert (1, "pts20") not in firsts


def test_first_claims_the_highest_tier_only():
    b = season({1: [dict(pts=p) for p in (10, 12, 8, 9, 33)]})
    s = [x for x in found(b, "first") if x["subtype"].startswith("pts")]
    assert [x["subtype"] for x in s] == ["pts30"]


def test_first_needs_three_games_before():
    b = season({1: [dict(pts=p) for p in (10, 12, 25)]})
    assert not found(b, "first")


def test_rare_line_rate_counts_only_earlier_nights():
    td = dict(pts=30, reb=12, ast=11)
    b = season({1: [dict(pts=10)] * 3 + [td], 2: [dict(pts=10)] * 3 + [td]})
    # nobody had a triple-double before the last night (6 player games), and same-night lines do not count against
    # each other
    s = [x for x in found(b, "rare") if x["subtype"] == "td"]
    assert {x["player_id"] for x in s} == {1, 2}
    for x in s:
        assert x["evidence"]["league_count"] == 0 and x["evidence"]["league_games"] == 6
        assert x["rarity"] == pytest.approx(st.rarity_of_p(1 / 8), abs=0.01)


def test_one_story_per_player_per_night():
    big = dict(pts=48, reb=15, ast=12, tpm=9, tpa=14, fga=25, fgm=17, pm=25)
    b = season({1: [dict(pts=p) for p in (10, 12, 11, 9)] + [big]})
    night = [x for x in st.build_stories(b).stories if x["story_date"] == "2026-10-25"]
    assert len(night) == 1
    assert night[0]["evidence"]["also"]  # the rest ride along


def test_usage_shares_add_up():
    """Usage weighted by minutes adds up to the players' share of the team's plays."""
    pb, tb, sc = read_season(season_paths(2027, HOOPR))
    b = compute(pb, tb, sc, DAY, 2027)
    lines = st._lines(b)
    by_tg = {}
    for lst in lines.values():
        for g in lst:
            by_tg.setdefault((g["game_id"], g["team"]), []).append(g)
    tgs = {(t["game_id"], t["team_code"]): t for t in b.team_games}
    for key, gs in list(by_tg.items())[:40]:
        t = tgs[key]
        gs = [g for g in gs if g["min"] > 0]  # usage is per minute on the floor: none for a 0-minute game
        total = sum(st.usage([g]) * g["min"] for g in gs) / t["minutes"]
        players_used = sum(g["fga"] + 0.44 * g["fta"] + g["tov"] for g in gs)
        assert total == pytest.approx(100 * players_used / (t["fga"] + 0.44 * t["fta"] + t["tov"]), rel=1e-6)
        assert 90 <= total <= 100.5


# ------------------------------------------------------------------ fixture day


@pytest.fixture(scope="module")
def fixture_build():
    pb, tb, sc = read_season(season_paths(2027, HOOPR))
    return pb, tb, sc, compute(pb, tb, sc, DAY, 2027)


def test_fixture_nights_and_checks(fixture_build):
    *_, b = fixture_build
    sb = st.build_stories(b)
    assert sb.nights == 13 and len(sb.stories) == 154
    assert st.story_checks(sb, b) == ([], [])
    kinds = {s["kind"] for s in sb.stories}
    assert {"outlier", "streak", "first", "rare"} <= kinds


def test_no_look_ahead(fixture_build):
    """Stories for a night are the same whether the run is the next morning or days later."""
    pb, tb, sc, full_b = fixture_build
    full = st.build_stories(full_b).stories
    early = st.build_stories(compute(pb, tb, sc, dt.date(2026, 10, 28), 2027)).stories
    assert early
    cut = [s for s in full if s["story_date"] < "2026-10-28"]
    key = lambda s: (s["story_date"], s["rank"], s["story_id"], s["score"], s["headline"])  # noqa: E731
    assert [key(s) for s in early] == [key(s) for s in cut]


def test_firsts_against_raw_box_scores(fixture_build):
    """Every "first this season" claim, checked against hoopR's player box file directly (not the engine's rows)."""
    pb, *_, b = fixture_build
    raw = pb[(pb["season_type"] == 2) & (pb["did_not_play"] != True)].copy()  # noqa: E712
    raw["minutes"] = pd.to_numeric(raw["minutes"], errors="coerce").fillna(0)
    raw = raw[raw["minutes"] > 0]
    raw["date"] = pd.to_datetime(raw["game_date"]).dt.strftime("%Y-%m-%d")
    cols = dict(pts="points", reb="rebounds", ast="assists", stl="steals", blk="blocks", tpm="three_point_field_goals_made")
    checked = 0
    for s in st.build_stories(b).stories:
        for kind, subtype, pid in [(s["kind"], s["subtype"], s["player_id"])] + \
                [(a["kind"], a["subtype"], s["player_id"]) for a in s["evidence"].get("also", [])]:
            if kind != "first":
                continue
            _, _, test, *_ = st.FIRSTS[subtype]
            mine = raw[raw["athlete_id"] == pid]
            lines = [{k: int(r[c] or 0) for k, c in cols.items()} | dict(date=r["date"]) for _, r in mine.iterrows()]
            earlier = [x for x in lines if x["date"] < s["story_date"]]
            night = [x for x in lines if x["date"] == s["story_date"]]
            assert len(earlier) >= st.FIRST_MIN_GAMES, s["story_id"]
            assert night and test(night[0]), s["story_id"]
            assert not any(test(x) for x in earlier), s["story_id"]
            checked += 1
    assert checked >= 20


def test_baselines_match_player_season(fixture_build):
    """The season points baseline is the engine's points per game."""
    *_, b = fixture_build
    sb = st.build_stories(b)
    ppg = {r["player_id"]: r["ppg"] for r in b.player_season}
    rows = [r for r in sb.baselines if r["stat"] == "pts"]
    assert len(rows) == len(ppg)
    for r in rows:
        assert r["mean"] == pytest.approx(ppg[r["player_id"]], abs=0.051), r["player_id"]
        assert r["l10_gp"] == min(10, r["gp"])
        if r["gp"] >= 2:
            assert r["sd"] is not None and not math.isnan(r["sd"])


def test_team_swing_compares_last_games_with_the_ones_before():
    """BOS lose their first 5 by 20, then win 5 by 20: last 5 against the 5 before, with the league's game spread."""
    b = season({1: [dict(pts=10)] * 10})
    for t in b.team_games:
        n = t["game_id"] - 1000
        sign = (1 if n >= 5 else -1) * (1 if t["team_code"] == "BOS" else -1)
        t.update(net=20.0 * sign, pts=110 + 10 * sign, opp_pts=110 - 10 * sign, poss=100.0, win=sign > 0)
    s = [x for x in found(b, "team") if x["team_code"] == "BOS" and x["game_id"] == 1009]
    assert len(s) == 1 and s[0]["subtype"] == "hot"
    ev = s[0]["evidence"]
    assert ev["window"] == 5 and ev["last"] == dict(games=5, w=5, l=0, net=20.0) and ev["rest"]["net"] == -20.0
    _, _, sd = st.baseline([t["net"] for t in b.team_games])
    assert s[0]["z"] == pytest.approx(40 / (sd * math.sqrt(1 / 5 + 1 / 5)), abs=0.01)
    assert "5-0 in the last 5" in s[0]["headline"]
    # NYK, the mirror image, cooled off
    assert [x["subtype"] for x in found(b, "team") if x["team_code"] == "NYK" and x["game_id"] == 1009] == ["cold"]


def test_rare_headline_prints_the_real_numbers():
    b = season({1: [dict(pts=10)] * 3 + [dict(pts=45, tpm=9, tpa=14)]})
    heads = {x["subtype"]: x["headline"] for x in found(b, "rare")}
    assert heads["pts40"] == "Player 1 scored 45"
    assert heads["tpm8"] == "Player 1 made 9 threes"
