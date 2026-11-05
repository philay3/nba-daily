"""Power ratings and the game model (Task 4).

The fit is checked against an independent solver and against ratings planted in synthetic games; the line's sign
against ESPN's own pickcenter; and the "no look-ahead" rule by changing every later result and checking that no
earlier prediction moves.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import math

import numpy as np
import pytest
from helpers import DAY, ESPN, HOOPR

from nba_pipeline import model as M
from nba_pipeline.compute import Build, compute
from nba_pipeline.sources.espn import odds_from_summary
from nba_pipeline.sources.hoopr import read_season, season_paths

PBP = HOOPR / "play_by_play_2027.parquet"


@pytest.fixture(scope="module")
def build():
    return compute(*read_season(season_paths(2027, HOOPR)), DAY, 2027)


@pytest.fixture(scope="module")
def lines():
    return M.read_lines(PBP)


@pytest.fixture(scope="module")
def mb(build, lines):
    return M.build_model(build, lines, [])


def finals(mb):
    return {r["game_id"]: r for r in mb.games if r["actual_margin"] is not None}


# ------------------------------------------------------------------ ESPN's line


def test_every_fixture_game_has_a_line(build, lines):
    assert len(lines) == 92
    assert {g["game_id"] for g in M.game_table(build).to_dict("records")} == set(lines)


def test_line_sign_matches_espn_pickcenter(lines):
    """The play-by-play's home_team_spread is the expected home margin: ESPN's summary for 401909906 lists
    'LAL -3.5' with the Lakers at home, and the play-by-play has +3.5."""
    js = json.loads((ESPN / "summary_401909906_final.json").read_text())
    home = next(c for c in js["header"]["competitions"][0]["competitors"] if c["homeAway"] == "home")
    assert home["team"]["abbreviation"] == "LAL"
    o = odds_from_summary(js)
    assert o["line"] == "LAL -3.5"
    assert M.line_from_odds(o, "LAL") == lines[401909906] == 3.5
    assert M.line_from_odds(o, "TOR") == -3.5  # the same row read for the other side
    assert M.line_from_odds({"line": "EVEN", "spread_abs": 0.0}, "LAL") == 0.0
    assert M.line_from_odds({"line": None, "spread_abs": None}, "LAL") is None


def test_favorites_win_more_often_than_not(build, lines):
    """A second check on the sign: teams the line favors won most fixture games."""
    g = M.game_table(build)
    fav_won = [(lines[r.game_id] > 0) == (r.home_pts > r.away_pts) for r in g.itertuples() if lines[r.game_id] != 0]
    assert sum(fav_won) / len(fav_won) > 0.6


def test_lines_skip_games_without_a_spread():
    import pandas as pd

    df = pd.DataFrame(dict(game_id=[1, 1, 2, 3], season_type=[2, 2, 2, 3], game_spread_available=[True, True, False, True],
                           home_team_spread=[-2.5, -2.5, 0.0, 4.0]))
    assert M.lines_from_plays(df) == {1: -2.5}


# ------------------------------------------------------------------ the fit


def test_ridge_matches_an_independent_solver(build):
    """The normal-equation solve equals least squares on the game rows stacked with the penalty rows."""
    g = M.game_table(build)
    teams = sorted(t["code"] for t in build.teams)
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    X = M.design(g.home.map(idx).to_numpy(), g.away.map(idx).to_numpy(), n)
    y = np.concatenate([100 * g.home_pts / g.poss, 100 * g.away_pts / g.poss])
    pen = np.r_[0.0, M.HCA_PRIOR_GAMES / 2, np.full(2 * n, M.RIDGE_GAMES)]
    h0 = M.HCA_PTS * 100 / g.pace.mean()
    target = np.r_[0.0, math.sqrt(pen[1]) * h0, np.zeros(2 * n)]
    Xa = np.vstack([X, np.diag(np.sqrt(pen))[1:]])
    ya = np.r_[y, target[1:]]
    beta, *_ = np.linalg.lstsq(Xa, ya, rcond=None)
    fit = M.Season(g, teams).fit(DAY.isoformat())
    assert fit.games == 92
    assert fit.mu == pytest.approx(beta[0], abs=1e-8)
    assert fit.hca == pytest.approx(beta[1], abs=1e-8)
    assert np.allclose(fit.off, beta[2:2 + n], atol=1e-8)
    assert np.allclose(fit.dfn, beta[2 + n:], atol=1e-8)


def test_ratings_recover_planted_strengths(monkeypatch):
    """Noise-free games from known ratings: a near-zero penalty gives the ratings back; the default pulls them in."""
    import pandas as pd

    rng = np.random.default_rng(7)
    teams = [f"T{i:02d}" for i in range(10)]
    off = rng.normal(0, 4, 10)
    off -= off.mean()
    dfn = rng.normal(0, 4, 10)
    dfn -= dfn.mean()
    mu, hca = 112.0, 3.0
    rows, day = [], dt.date(2026, 10, 20)
    for k in range(400):
        h, a = rng.choice(10, 2, replace=False)
        poss = 100.0
        rows.append(dict(game_id=k, game_date=(day + dt.timedelta(days=k // 5)).isoformat(), home=teams[h], away=teams[a],
                         home_pts=(mu + off[h] + dfn[a] + hca / 2) * poss / 100,
                         away_pts=(mu + off[a] + dfn[h] - hca / 2) * poss / 100, poss=poss, pace=poss))
    g = pd.DataFrame(rows)
    monkeypatch.setattr(M, "RIDGE_GAMES", 1e-6)
    monkeypatch.setattr(M, "HCA_PRIOR_GAMES", 1e-6)
    fit = M.Season(g, teams).fit("2027-01-01")
    assert fit.mu == pytest.approx(mu, abs=1e-4)
    assert fit.hca == pytest.approx(hca, abs=1e-4)
    assert np.allclose(fit.off, off, atol=1e-4) and np.allclose(fit.dfn, dfn, atol=1e-4)
    monkeypatch.setattr(M, "RIDGE_GAMES", 7.0)
    shrunk = M.Season(g, teams).fit("2027-01-01")
    assert np.sum(shrunk.off ** 2 + shrunk.dfn ** 2) < np.sum(off ** 2 + dfn ** 2)


def test_fit_is_deterministic(build, lines, mb):
    again = M.build_model(build, lines, [])
    assert again.games == mb.games and again.ratings == mb.ratings and again.backtest == mb.backtest
    assert again.calibration == mb.calibration and again.days == mb.days


def test_early_ratings_sit_near_average(mb):
    """Shrinkage: after one night every adjusted net rating is far smaller than the raw one."""
    first = mb.days[0]["as_of"]
    rows = [r for r in mb.ratings if r["as_of"] == first and r["games"] > 0]
    assert rows
    assert max(abs(r["adj_net"]) for r in rows) < 0.5 * max(abs(r["net"]) for r in rows)


def test_ranks(mb):
    last = mb.days[-1]["as_of"]
    rows = [r for r in mb.ratings if r["as_of"] == last]
    assert len(rows) == 30
    best = min(rows, key=lambda r: r["net_rk"])
    assert best["adj_net"] == max(r["adj_net"] for r in rows)
    assert min(rows, key=lambda r: r["drtg_rk"])["adj_drtg"] == min(r["adj_drtg"] for r in rows)
    for r in rows:
        assert r["adj_net"] == pytest.approx(r["adj_ortg"] - r["adj_drtg"], abs=0.11)


# ------------------------------------------------------------------ no look-ahead


def test_each_prediction_uses_only_earlier_games(build, mb):
    g = M.game_table(build)
    for r in finals(mb).values():
        assert r["as_of"] == r["game_date"]
        assert r["fit_games"] == int((g.game_date < r["game_date"]).sum())


def test_later_results_never_move_earlier_predictions(build, lines, mb):
    """Flip every result from Oct 28 on. Predictions before that date stay exactly the same."""
    cut = "2026-10-28"
    changed = copy.copy(build)
    changed.team_games = []
    for r in build.team_games:
        r = dict(r)
        if r["game_date"] >= cut:
            r["pts"] = 150 if r["home_away"] == "away" else 80
        changed.team_games.append(r)
    other = M.build_model(changed, lines, [])
    a, b = finals(mb), finals(other)
    before = [k for k, r in a.items() if r["game_date"] < cut]
    after = [k for k, r in a.items() if r["game_date"] > cut]
    assert before and after
    for k in before:
        assert a[k] == b[k]
    assert any(a[k]["pred_margin"] != b[k]["pred_margin"] for k in after)


def test_the_first_night_uses_only_the_priors(mb):
    first = min(r["game_date"] for r in mb.games)
    for r in mb.games:
        if r["game_date"] == first:
            assert r["fit_games"] == 0 and r["sigma"] == M.SIGMA_PTS
            assert r["home_court"] == pytest.approx(M.HCA_PTS, abs=0.05)


def test_sigma_learns_only_from_earlier_misses(mb):
    """sigma on each date rebuilds from the misses of the games before it."""
    rows = sorted(finals(mb).values(), key=lambda r: r["game_date"])
    for d in mb.days:
        prior = [r for r in rows if r["game_date"] < d["as_of"]]
        # misses from the stored (rounded) margins, so allow for rounding
        sq = sum((r["actual_margin"] - r["pred_margin"]) ** 2 for r in prior)
        want = math.sqrt((M.SIGMA_PRIOR_GAMES * M.SIGMA_PTS ** 2 + sq) / (M.SIGMA_PRIOR_GAMES + len(prior)))
        assert d["sigma_games"] == len(prior)
        assert d["sigma"] == pytest.approx(want, abs=0.06)


# ------------------------------------------------------------------ projections


def test_projection_parts_add_up(mb):
    for r in mb.games:
        assert r["home_wp"] == pytest.approx(100 * M.norm_cdf(r["pred_margin"] / r["sigma"]), abs=0.5)
        if r["home_rest"] == 0 and r["away_rest"] != 0:
            assert r["rest_adj"] == -M.B2B_PTS
        if r["away_rest"] == 0 and r["home_rest"] != 0:
            assert r["rest_adj"] == M.B2B_PTS


def test_upcoming_games_get_projections_with_lines_from_odds(build, lines):
    from nba_pipeline.previews import upcoming_games

    up = upcoming_games(build)
    odds = [dict(game_id=up[0]["id"], line=f"{up[0]['away_code']} -6.5", spread_abs=6.5)]
    m = M.build_model(build, lines, odds)
    rows = {r["game_id"]: r for r in m.games if r["actual_margin"] is None}
    assert set(rows) == {g["id"] for g in up}
    first = rows[up[0]["id"]]
    assert first["line_margin"] == -6.5 and first["line_source"] == "odds" and first["as_of"] == DAY.isoformat()
    assert first["pick"] in ("home", "away") and first["ats"] is None
    assert all(r["fit_games"] == 92 for r in rows.values())


# ------------------------------------------------------------------ the backtest


def row(margin, wp, line, actual):
    pick = None if line is None or margin == line else ("home" if margin > line else "away")
    ats = None
    if pick and actual is not None:
        c = actual - line
        ats = "P" if c == 0 else ("W" if (c > 0) == (pick == "home") else "L")
    return dict(_margin=margin, _wp=wp, line_margin=line, actual_margin=actual, pick=pick, ats=ats)


def test_backtest_math_on_hand_made_games():
    rows = [row(5.0, 66.0, 3.0, 10),  # model likes home vs -3, home won by 10: W
            row(-2.0, 43.0, 1.0, 4),  # likes road, home covered: L
            row(4.0, 63.0, 2.0, 2),  # push
            row(1.0, 53.0, None, -3),  # no line
            row(-8.0, 25.0, -8.0, -1)]  # no pick (same as the line); the road favorite won by 1
    (s,), cal = M.backtest(rows, 2027, "2026-11-02", None)
    assert (s["games"], s["line_games"]) == (5, 4)
    assert (s["ats_w"], s["ats_l"], s["ats_p"]) == (1, 1, 1)
    assert s["model_mae_all"] == pytest.approx((5 + 6 + 2 + 4 + 7) / 5, abs=0.05)
    assert s["model_mae"] == pytest.approx((5 + 6 + 2 + 7) / 4, abs=0.05)
    assert s["line_mae"] == pytest.approx((7 + 3 + 0 + 7) / 4, abs=0.05)
    assert (s["su_games"], s["su_right"]) == (5, 3)  # wrong on -2.0/+4 and 1.0/-3
    assert (s["line_su_games"], s["line_su_right"]) == (4, 4)
    assert s["model_su_on_line_games"] == 3
    bins = {c["lo"]: c for c in cal}
    assert bins[50]["games"] == 2 and bins[50]["wins"] == 0  # 53 (lost), 57 for the road (lost)
    assert bins[60]["games"] == 2 and bins[60]["wins"] == 2
    assert bins[70]["games"] == 1 and bins[70]["mean_wp"] == 75.0 and bins[70]["wins"] == 1
    assert sum(c["games"] for c in cal) == 5


def test_fixture_backtest_adds_up(mb):
    (s,) = mb.backtest
    f = list(finals(mb).values())
    assert s["games"] == len(f) == 92 and s["line_games"] == 92
    assert s["ats_w"] + s["ats_l"] + s["ats_p"] == sum(r["pick"] is not None for r in f)
    assert sum(c["games"] for c in mb.calibration) == 92
    assert s["line_mae"] == pytest.approx(sum(abs(r["actual_margin"] - r["line_margin"]) for r in f) / 92, abs=0.05)


def test_check_model_flags_a_look_ahead(build, mb):
    assert M.check_model(mb, build) == ([], [])
    bad = copy.deepcopy(mb)
    bad.games[0]["as_of"] = "2026-12-01"
    bad.games = bad.games[1:] + bad.games[:1]
    errs, _ = M.check_model(bad, build)
    assert any("predicted with games up to" in e for e in errs)
    missing = copy.deepcopy(mb)
    missing.games = [r for r in missing.games if r["game_id"] != 401909906]
    assert any("no prediction" in e for e in M.check_model(missing, build)[0])


def test_empty_season_gives_priors_only():
    b = Build(today=dt.date(2026, 10, 20), yesterday=dt.date(2026, 10, 19), season=2027, meta={"notes": []},
              teams=[{"code": "BOS"}, {"code": "NYK"}],
              games=[dict(id=1, game_date="2026-10-20", away_code="NYK", home_code="BOS", status="STATUS_SCHEDULED",
                          tip="2026-10-20T23:30Z", code="NYK@BOS")])
    m = M.build_model(b, {}, [])
    assert m.ratings == [] and m.days == []
    (g,) = m.games
    assert g["pred_margin"] == M.HCA_PTS and g["sigma"] == M.SIGMA_PTS and g["fit_games"] == 0
