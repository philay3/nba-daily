"""Games the season files do not have yet: the raw per-game mirror and PATCH files must rebuild them
exactly, and days without games must run cleanly."""
from __future__ import annotations

import datetime as dt
import json

import pandas as pd
import pytest
from helpers import DAY, ESPN, GOLDEN, HOOPR, INPUTS, TEN, golden, same

from nba_pipeline.compute import Fill, compute
from nba_pipeline.digest import render_digest
from nba_pipeline.editorial import editorial_rows
from nba_pipeline.export import dashboard_files, tables_from_build
from nba_pipeline.run import injury_rows_from_file, odds_rows_from_file, run_day
from nba_pipeline.sources.hoopr import read_season, season_paths
from nba_pipeline.sources.inputs import read_inputs
from nba_pipeline.sources.patch import from_patch
from nba_pipeline.sources.raw import parse_raw

GID = 401909906  # TOR @ LAL, Nov 1


@pytest.fixture(scope="module")
def season():
    return read_season(season_paths(2027, HOOPR))


def _files_with(season, fill, note):
    pb, tb, sc = season
    build = compute(pb, tb, sc, DAY, 2027, fill_missing=fill, drop=(GID,))
    assert build.meta["notes"] == [note]
    inputs = read_inputs(INPUTS)
    tonight = [g for g in build.games if g["game_date"] == DAY.isoformat()]
    tables = tables_from_build(build, odds_rows_from_file(DAY, inputs.odds, tonight),
                               injury_rows_from_file(DAY, inputs.injuries, tonight, build.player_season),
                               editorial_rows(DAY, inputs.editorial, "file"))
    for r in build.team_season:  # official seeds, as the run applies them
        r["seed"] = {s["team"]: s["seed"] for s in inputs.sr_standings}[r["team_code"]]
    files = dashboard_files(tables)
    return build, tables, files


def test_raw_mirror_rebuilds_a_missing_game(season):
    summary = json.loads((ESPN / f"summary_{GID}_final.json").read_text())

    def fill(gid, game_date):
        assert gid == GID
        pr, tr, per = parse_raw(gid, summary, game_date)
        return Fill(pr, tr, per, None, "raw", f"game {gid} added from the raw per-game mirror")
    build, tables, files = _files_with(season, fill, f"game {GID} added from the raw per-game mirror")
    for name in TEN:
        ok, where = same(files[name], golden(name))
        assert ok, f"{name}: {where}"
    text = render_digest(tables, files)
    gold = (GOLDEN / "digest.txt").read_text().splitlines()
    assert text.splitlines() == gold[:2] + [f"Note: game {GID} added from the raw per-game mirror"] + gold[2:]
    assert next(g for g in build.games if g["id"] == GID)["box_source"] == "raw"


def test_patch_file_rebuilds_a_missing_game(season):
    patch = json.loads((ESPN / f"patch_{GID}.json").read_text())

    def fill(gid, game_date):
        pr, tr, per, n = from_patch(patch, game_date)
        return Fill(pr, tr, per, n, "patch", f"game {gid} added from an ESPN page patch")
    build, _, files = _files_with(season, fill, f"game {GID} added from an ESPN page patch")
    for name in TEN:
        ok, where = same(files[name], golden(name))
        assert ok, f"{name}: {where}"
    assert next(g for g in build.games if g["id"] == GID)["box_source"] == "patch"


def test_missing_game_without_fill_is_reported(season):
    pb, tb, sc = season
    build = compute(pb, tb, sc, DAY, 2027, fill_missing=None, drop=(GID,))
    assert build.meta["last_night_missing"] == [GID]
    assert build.meta["last_night_games"] == 3


def test_day_without_games_runs_cleanly():
    """2026-11-03 (Election Day): no games tonight; last night's games are not in the fixture files."""
    res = run_day(dt.date(2026, 11, 3), source_dir=HOOPR, use_espn=False, offline=True, write=False)
    assert res.files["games"] == [] and res.files["injuries"] == [] and res.files["results"] == []
    assert len(res.build.meta["last_night_missing"]) == 15
    assert [b["kind"] for b in res.files["brief"]] == ["date", "date"]
    assert res.files["brief"][0]["text"] == "Tuesday, Nov 3"
    assert res.errors == []
    assert "TONIGHT: 0 games" in res.digest and "LAST NIGHT: 0 games" in res.digest


def test_opening_night_has_no_completed_games(season):
    pb, tb, sc = season
    build = compute(pb.iloc[0:0], tb.iloc[0:0], sc, dt.date(2026, 10, 20), 2027)
    assert build.team_season == [] and build.player_season == [] and build.game_gaps == []
    tonight = [g for g in build.games if g["game_date"] == "2026-10-20"]
    assert tonight and all(g["away_rest"] is None for g in tonight)


def test_as_of_date_ignores_later_games(season):
    pb, tb, sc = season
    build = compute(pb, tb, sc, dt.date(2026, 10, 30), 2027)
    assert max(r["game_date"] for r in build.team_games) < "2026-10-30"
    assert all(r["as_of"] == "2026-10-30" for r in build.team_season)


def test_every_game_gets_gaps_and_deltas(season):
    pb, tb, sc = season
    build = compute(pb, tb, sc, DAY, 2027)
    finals = {r["game_id"] for r in build.team_games}
    assert {r["game_id"] for r in build.game_gaps} == finals
    played = pd.DataFrame(build.player_games)
    played = played[~played.did_not_play & (played["min"].fillna(0) > 0)]
    assert len(build.player_game_deltas) == len(played)
