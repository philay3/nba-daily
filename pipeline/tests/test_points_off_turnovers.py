"""Points off turnovers. ESPN's team stat turnoverPoints is the points a team conceded off its own turnovers, so
each team takes the opponent's figure (docs/DECISIONS.md). Checked against ESPN's label, the raw mirror rows and,
without trusting any label, the turnovers each team committed."""
from __future__ import annotations

import json

import pandas as pd
import pytest
from helpers import DAY, ESPN, HOOPR

from nba_pipeline.compute import compute
from nba_pipeline.sources.hoopr import read_season, season_paths
from nba_pipeline.teams import code

GID = 401909906  # TOR @ LAL, Nov 1


@pytest.fixture(scope="module")
def season():
    return read_season(season_paths(2027, HOOPR))


@pytest.fixture(scope="module")
def build(season):
    pb, tb, sc = season
    return compute(pb, tb, sc, DAY, 2027)


@pytest.fixture(scope="module")
def conceded(season):
    """ESPN's figure per (game, team), straight from the mirror's team box file."""
    _, tb, _ = season
    return {(int(r.game_id), code(r.team_abbreviation)): int(r.turnover_points) for r in tb.itertuples()}


def test_espn_labels_turnover_points_as_points_conceded():
    summary = json.loads((ESPN / f"summary_{GID}_final.json").read_text())
    for team in summary["boxscore"]["teams"]:
        stat = next(s for s in team["statistics"] if s["name"] == "turnoverPoints")
        assert stat["label"] == "Points Conceded Off Turnovers"


def test_each_team_gets_the_opponents_espn_figure(build, conceded):
    assert len(build.team_games) == len(conceded) == 184
    for r in build.team_games:
        assert r["pts_off_to"] == conceded[(r["game_id"], r["opp_code"])], (r["game_id"], r["team_code"])


def test_tor_at_lal(build):
    """LAL turned it over 24 times (TOR had 14 steals) and TOR 15 times: TOR scored 30 off them, LAL 23."""
    tg = {r["team_code"]: r for r in build.team_games if r["game_id"] == GID}
    assert (tg["TOR"]["tov"], tg["LAL"]["tov"], tg["TOR"]["stl"]) == (15, 24, 14)
    assert (tg["TOR"]["pts_off_to"], tg["LAL"]["pts_off_to"]) == (30, 23)
    gap = next(g for g in build.game_gaps if g["game_id"] == GID and g["key"] == "pts_off_to")
    assert (gap["away_code"], gap["away_val"], gap["home_val"], gap["edge"]) == ("TOR", 30, 23, "TOR")


def test_season_points_off_turnovers_scored_and_allowed(build, conceded):
    for ts in build.team_season:
        games = [r for r in build.team_games if r["team_code"] == ts["team_code"]]
        scored = sum(conceded[(r["game_id"], r["opp_code"])] for r in games) / len(games)
        allowed = sum(conceded[(r["game_id"], r["team_code"])] for r in games) / len(games)
        assert (ts["pts_off_to_pg"], ts["opp_pts_off_to_pg"]) == (round(scored, 1), round(allowed, 1)), ts["team_code"]
    # rank 1 scores the most off turnovers, and allows the fewest
    assert max(build.team_season, key=lambda r: r["pts_off_to_pg"])["pts_off_to_pg_rk"] == 1
    assert min(build.team_season, key=lambda r: r["opp_pts_off_to_pg"])["opp_pts_off_to_pg_rk"] == 1


def test_points_off_turnovers_follow_the_opponents_turnovers(build):
    """No label needed: what a team scores off turnovers rises with the other team's turnovers, not its own."""
    df = pd.DataFrame(build.team_games)
    tov = df.set_index(["game_id", "team_code"]).tov
    df["opp_tov"] = [tov[(g, o)] for g, o in zip(df.game_id, df.opp_code)]
    r_opp, r_own = df.pts_off_to.corr(df.opp_tov), df.pts_off_to.corr(df.tov)
    assert r_opp > 0.6 and r_own < 0.3, (r_opp, r_own)  # 0.74 and 0.19 on the fixture season
