"""Stat audit (docs/STATS.md): what every stored stat means, that it adds up across the season, and that no ESPN
team stat is read for the wrong team. The daily checks live in nba_pipeline/audit.py; these tests run them on the
fixture season, break copies of it to prove each check fires, and check the definitions against independent data."""
from __future__ import annotations

import copy
import json
import re

import pandas as pd
import pytest
from helpers import DAY, ESPN, HOOPR

from nba_pipeline.audit import PREFIX, stat_checks, team_game_frame
from nba_pipeline.compute import BETTER_HIGH, BETTER_LOW, GAP_STATS, compute
from nba_pipeline.config import REPO_ROOT as ROOT
from nba_pipeline.shots import build_shots
from nba_pipeline.sources.hoopr import read_season, read_shots, season_paths, shots_path

STATS_MD = ROOT / "docs" / "STATS.md"
SCHEMA = ROOT / "web" / "src" / "db" / "schema.ts"
TABLES = ["team_games", "player_games", "team_season", "player_season", "game_gaps"]
SUMMARY = ESPN / "summary_401909906_final.json"


@pytest.fixture(scope="module")
def build():
    return compute(*read_season(season_paths(2027, HOOPR)), DAY, 2027)


@pytest.fixture(scope="module")
def tg(build):
    return team_game_frame(build)


def doc_sections() -> dict[str, list[list[str]]]:
    """Table rows of docs/STATS.md by section heading: {'team_games': [[column, definition, source, better], ...]}."""
    out: dict[str, list[list[str]]] = {}
    head = None
    for line in STATS_MD.read_text().splitlines():
        if line.startswith("## "):
            head = line[3:].strip()
        elif head and line.startswith("| `"):
            cells = [c.strip() for c in re.split(r"(?<!\\)\|", line.strip())[1:-1]]
            out.setdefault(head, []).append(cells)
    return out


def doc_rows(table: str) -> dict[str, list[str]]:
    rows = [r for r in doc_sections()[table] if len(r) == 4]
    return {r[0].strip("`"): r for r in rows}


def schema_columns(table: str) -> list[str]:
    text = SCHEMA.read_text()
    start = re.search(rf'pgTable\(\s*"{table}"', text).start()
    body = text[start:text.index("\n  },", start)]
    return re.findall(r'^\s+(\w+): \w+\(', body, re.M)


# ---- the season adds up


def test_fixture_season_passes_every_check(build):
    assert stat_checks(build) == ([], [])


def test_team_totals_are_the_sum_of_players(tg):
    """The task's list: points, rebounds, assists, field goals, threes, free throws and turnovers."""
    for c in ["pts", "reb", "ast", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]:
        assert (tg[c] == tg["p_" + c]).all(), c
    # turnovers: ESPN's total adds the team's own (shot clock and the like) to the players'
    assert (tg.tov == tg.p_tov + tg.team_tov).all()
    assert int((tg.team_tov > 0).sum()) == 97


def test_possessions_in_a_normal_range(tg):
    assert tg.poss.between(91, 116).all() and tg.pace.between(91, 115).all()
    assert (tg.poss == tg.o_poss).all()  # both teams in a game get the same count


def test_ratings_rebuild_from_their_parts(tg):
    poss = ((tg.fga - tg.oreb + tg.tov + 0.44 * tg.fta) + (tg.o_fga - tg.o_oreb + tg.o_tov + 0.44 * tg.o_fta)) / 2
    assert ((tg.ortg - (100 * tg.pts / poss).round(1)).abs() < 1e-9).all()
    assert ((tg.drtg - tg.o_ortg).abs() < 1e-9).all()
    assert ((tg.net - (tg.ortg - tg.drtg)).abs() <= 0.15).all()


def test_zero_minute_players(build, tg):
    """ESPN shows 0 minutes for under 30 seconds on the floor. did_not_play alone decides who played, so these games
    count in games played, season totals and pre-game averages, and the box score lists them with the bench
    (docs/DECISIONS.md, docs/STATS.md findings)."""
    pg = pd.DataFrame(build.player_games)
    zero = pg[~pg.did_not_play & (pg["min"].fillna(0) == 0)]
    assert len(zero) == 8
    assert (tg.p_plus_minus == 5 * (tg.pts - tg.opp_pts)).all()
    ps = {r["player_id"]: r for r in build.player_season}
    played = pg[~pg.did_not_play & (pg.game_date < str(DAY))]
    for pid, games in played.groupby("player_id"):
        assert ps[pid]["gp"] == games.game_id.nunique()
    deltas = {(d["game_id"], d["player_id"]) for d in build.player_game_deltas}
    assert all((int(r.game_id), int(r.player_id)) in deltas for r in zero.itertuples())
    cryer = zero[(zero.name == "LJ Cryer") & (zero.game_id == 401909285)].iloc[0]
    assert (cryer.team_code, cryer.ast, cryer.plus_minus) == ("GSW", 1, 2)
    # listed last on the bench, after the players with minutes
    team = pg[(pg.game_id == cryer.game_id) & (pg.team_code == "GSW")].sort_values("box_order")
    on = team[~team.did_not_play]
    assert on.iloc[-1].player_id == cryer.player_id


# ---- each check fires


def broken(build, table: str, i: int, **changes):
    b = copy.deepcopy(build)
    getattr(b, table)[i].update(changes)
    return b


def first(build, table: str, **match) -> int:
    rows = getattr(build, table)
    return next(i for i, r in enumerate(rows) if all(r.get(k) == v for k, v in match.items()))


@pytest.mark.parametrize("table, match, change, message, kind", [
    ("player_games", {"did_not_play": False}, {"pts": 99}, "team pts is not the sum of its players", "warn"),
    ("player_games", {"did_not_play": False}, {"reb": 40}, "team reb is not the sum of its players", "warn"),
    ("player_games", {"did_not_play": False}, {"plus_minus": 40}, "player plus-minus does not sum", "warn"),
    ("team_games", {}, {"team_tov": 9}, "turnovers are not player plus team turnovers", "warn"),
    ("team_games", {}, {"paint": 31}, "points in the paint are odd", "warn"),
    ("team_games", {}, {"lead_changes": 99}, "different lead changes", "warn"),
    ("team_games", {}, {"pace": 140.0}, "pace is outside 85 to 125", "warn"),
    ("team_games", {}, {"ortg": 150.0}, "team_games.ortg does not rebuild", "err"),
    ("team_games", {}, {"orb_pct": 1.0}, "team_games.orb_pct does not rebuild", "err"),
    ("team_season", {}, {"ppg": 1.0}, "team_season.ppg does not rebuild", "err"),
    ("team_season", {}, {"tov_pct_rk": 30}, "team_season.tov_pct_rk does not rank lowest first", "err"),
    ("team_season", {}, {"w": 0}, "wins and losses do not add to games played", "err"),
    ("player_season", {}, {"ts_pct": 1.0}, "player_season.ts_pct does not rebuild", "err"),
    ("game_gaps", {"key": "tov"}, {"edge": "XXX"}, "edge does not follow the stat's direction", "err"),
    ("game_gaps", {"key": "pts"}, {"away_val": 1.0}, "game_gaps values differ from team_games", "err"),
    ("game_gaps", {"key": "pts"}, {"volume": True}, "volume flag is wrong", "err"),
])
def test_each_check_fires(build, table, match, change, message, kind):
    errs, warns = stat_checks(broken(build, table, first(build, table, **match), **change))
    hits = [m for m in (errs if kind == "err" else warns) if message in m]
    assert hits and all(m.startswith(PREFIX) for m in errs + warns), (errs, warns)


def test_a_flipped_stat_is_caught(build):
    """A rate stored for the wrong side breaks its rebuild: swap one team-game's offensive and defensive rebound %."""
    i = first(build, "team_games")
    r = build.team_games[i]
    errs, _ = stat_checks(broken(build, "team_games", i, orb_pct=r["drb_pct"], drb_pct=r["orb_pct"]))
    assert any("team_games.orb_pct does not rebuild" in e for e in errs)


# ---- no ESPN team stat is read for the wrong team (independent of ESPN's labels)


def test_offensive_rebounds_belong_to_the_shooting_team(tg):
    misses = tg.fga - tg.fgm
    assert misses.corr(tg.oreb + tg.o_dreb) > 0.8  # 0.89
    assert misses.corr(tg.dreb + tg.o_oreb) < 0.1  # -0.09


def test_paint_points_belong_to_the_scoring_team(build, tg):
    shots = pd.DataFrame(build_shots(read_shots(shots_path(2027, HOOPR)), build).shots)
    near = shots[shots.zone.isin(["restricted_area", "paint"])].groupby(["game_id", "team_code"]).points.sum()
    own = pd.Series([near.get((g, t), 0) for g, t in zip(tg.game_id, tg.team_code)], index=tg.index)
    other = pd.Series([near.get((g, t), 0) for g, t in zip(tg.game_id, tg.opp_code)], index=tg.index)
    assert tg.paint.corr(own) > 0.99 and tg.paint.corr(other) < 0.5  # 0.997 and 0.30
    assert ((tg.paint - own).abs() <= 2).all()  # ESPN leaves a few shots without a spot


def test_fast_break_points_belong_to_the_scoring_team(tg):
    assert tg.fb.corr(tg.stl) > tg.fb.corr(tg.o_stl)  # 0.35 against 0.13
    assert tg.fb.corr(tg.o_tov) > tg.fb.corr(tg.tov)  # 0.25 against 0.05


# ---- docs/STATS.md matches ESPN's labels, the schema and the directions in code


@pytest.mark.parametrize("table", TABLES)
def test_every_column_is_documented(table):
    documented = set(doc_rows(table))
    columns = [c for c in schema_columns(table) if not c.endswith("_rk")]
    assert columns, table
    assert [c for c in columns if c not in documented] == []
    assert [c for c in documented if c not in columns] == []


def test_every_rank_has_a_documented_stat():
    documented = set(doc_rows("team_season"))
    ranks = [c[:-3] for c in schema_columns("team_season") if c.endswith("_rk")]
    assert sorted(ranks) == sorted(BETTER_HIGH + BETTER_LOW)
    assert [r for r in ranks if r not in documented] == []


def test_rank_directions_match_the_doc():
    rows = doc_rows("team_season")
    for k in BETTER_HIGH:
        better = rows[k][3]
        assert better == "higher" or better.startswith("none, rank 1 = "), (k, better)
    for k in BETTER_LOW:
        assert rows[k][3] == "lower", k


def test_gap_directions_match_the_doc():
    gaps = {r[0].strip("`"): r for r in doc_sections()["game_gaps"] if len(r) == 3}
    want = {1: "higher", -1: "lower", 0: "none"}
    assert list(gaps) == [k for _, _, k, _ in GAP_STATS]
    for _, label, k, d in GAP_STATS:
        assert gaps[k][1:] == [label, want[d]], k


def test_gap_directions_agree_with_team_games():
    rows = doc_rows("team_games")
    for _, _, k, d in GAP_STATS:
        if d:
            assert rows[k][3] == {1: "higher", -1: "lower"}[d], k


def _espn_labels():
    summary = json.loads(SUMMARY.read_text())
    team = {}
    for s in summary["boxscore"]["teams"][0]["statistics"]:
        for name in s["name"].split("-"):
            team[name] = s["label"]
    st = summary["boxscore"]["players"][0]["statistics"][0]
    player = {}
    for key, label in zip(st["keys"], st["labels"]):
        for name in key.split("-"):
            player[name] = label
    return team, player


@pytest.mark.parametrize("table, side", [("team_games", 0), ("player_games", 1)])
def test_espn_labels_match_the_doc(table, side):
    labels = _espn_labels()[side]
    checked = 0
    for col, row in doc_rows(table).items():
        m = re.match(r'ESPN `(\w+)`(?: of the opponent)? "([^"]+)"', row[2])
        if not m:
            continue
        name, label = m.groups()
        assert labels.get(name) == label, (col, name, label, labels.get(name))
        checked += 1
    assert checked >= 14


def test_the_daily_run_reports_with_the_prefix():
    from nba_pipeline import run
    assert "stat_checks(build)" in (ROOT / "pipeline" / "nba_pipeline" / "run.py").read_text()
    assert run.stat_checks is stat_checks
