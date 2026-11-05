"""Power ratings and the game model: opponent-adjusted ratings, projections, and a backtest against ESPN's line.

Ratings. For every date D of the season, a ridge regression on the games played before D. Each game gives two
rows, one per team on offense, with that team's points per 100 possessions:

    100 x pts / poss = mu + O[offense] + D[defense] +/- H / 2      (+ for the home team, - for the road team)

mu is the league average (not penalized), O a team's offense above average, D the points per 100 a defense allows
above average, H home court per 100 possessions. O and D are pulled toward 0 (the league average) with a weight
worth RIDGE_GAMES games of an average team, so a team's rating moves away from average only as its games pile
up: early in the season every team sits near the middle. H is pulled toward the typical NBA home edge
(HCA_PTS points at the league's pace) with a weight worth HCA_PRIOR_GAMES games, so this season's games move it
more as the sample grows.

  adjusted offensive rating = mu + O, adjusted defensive rating = mu + D, adjusted net = O - D

Projections. For a game on date D the model uses the ratings fit on games before D (or before the run date for
games after it), so nothing looks ahead:

  expected possessions = home pace x road pace / league pace   (each team's pace pulled toward the league's)
  home margin          = (home net - road net + H) x possessions / 100 + rest
  rest                 = B2B_PTS against a team on the second night of a back-to-back
  home win chance      = Normal(home margin, SIGMA) above 0

SIGMA starts at SIGMA_PTS and is updated from this season's misses (actual margin minus the model's pregame
margin, for games before D) with a weight worth SIGMA_PRIOR_GAMES games.

Backtest. Every finished game this season is predicted as of its date and compared with ESPN's pregame spread from
the play-by-play (`home_team_spread`, positive when the home team is favored): mean absolute error of the margin,
record against the spread, and calibration of the win chance by bins.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from nba_pipeline.compute import Build, days_since
from nba_pipeline.config import REGULAR_SEASON
from nba_pipeline.previews import schedule_dates, upcoming_games
from nba_pipeline.util import r1

RIDGE_GAMES = 7.0  # weight pulling O and D toward the league average, in games
HCA_PTS = 2.0  # typical NBA home court, points per game
HCA_PRIOR_GAMES = 100.0
SIGMA_PTS = 12.0  # typical spread of NBA results around the expected margin
SIGMA_PRIOR_GAMES = 100.0
PACE_PRIOR_GAMES = 5.0  # weight pulling a team's pace toward the league's
B2B_PTS = 1.5  # cost of the second night of a back-to-back
DEFAULT_PACE = 100.0  # league pace before any game is played
CAL_BINS = [(50, 60), (60, 70), (70, 80), (80, 90), (90, 100)]  # the favorite's win chance, percent

LINE_COLUMNS = ["game_id", "season_type", "game_spread_available", "home_team_spread"]


# ------------------------------------------------------------------ ESPN's line


def read_lines(path) -> dict[int, float]:
    """ESPN's pregame spread per game from the play-by-play file, as the expected home margin (positive = home
    favored). Empty when the file has no line columns."""
    if path is None:
        return {}
    import pyarrow.parquet as pq

    names = set(pq.ParquetFile(path).schema_arrow.names)
    if not set(LINE_COLUMNS) <= names:
        return {}
    df = pd.read_parquet(path, columns=LINE_COLUMNS)
    return lines_from_plays(df)


def lines_from_plays(df: pd.DataFrame) -> dict[int, float]:
    df = df[(df.season_type == REGULAR_SEASON) & df.home_team_spread.notna()]
    df = df[df.game_spread_available.fillna(False).astype(bool)]
    first = df.groupby("game_id").home_team_spread.first()
    return {int(g): float(v) for g, v in first.items()}


def line_from_odds(o: dict, home_code: str) -> float | None:
    """An odds row ("CLE -4.5", spread 4.5) as the expected home margin."""
    line = o.get("line")
    if line is None:
        return None
    if line == "EVEN":
        return 0.0
    if o.get("spread_abs") is None:
        return None
    fav = line.split(" ")[0]
    return float(o["spread_abs"]) if fav == home_code else -float(o["spread_abs"])


# ------------------------------------------------------------------ the fit


@dataclass
class Fit:
    as_of: str
    games: int
    mu: float | None  # league points per 100 possessions (None before any game)
    hca: float  # home court per 100 possessions
    off: np.ndarray  # O per team
    dfn: np.ndarray  # D per team (points allowed above average)
    pace: np.ndarray  # each team's pace pulled toward the league's
    league_pace: float
    team_games: np.ndarray
    raw_ortg: np.ndarray
    raw_drtg: np.ndarray
    sigma: float
    resid_games: int

    @property
    def hca_pts(self) -> float:
        return self.hca * self.league_pace / 100.0


def solve(xtx: np.ndarray, xty: np.ndarray, n_teams: int, hca_prior: float) -> np.ndarray:
    """Ridge solution for [mu, H, O..., D...] from the normal equations of the game rows."""
    pen = np.zeros(2 + 2 * n_teams)
    pen[1] = HCA_PRIOR_GAMES / 2.0  # each game says 2 x (1/2)^2 about H, so n games weigh n/2
    pen[2:] = RIDGE_GAMES
    target = np.zeros_like(pen)
    target[1] = hca_prior * pen[1]
    return np.linalg.solve(xtx + np.diag(pen), xty + target)


def design(home: np.ndarray, away: np.ndarray, n_teams: int) -> np.ndarray:
    """Two rows per game: home offense vs road defense, road offense vs home defense."""
    n = len(home)
    X = np.zeros((2 * n, 2 + 2 * n_teams))
    X[:, 0] = 1.0
    X[:n, 1], X[n:, 1] = 0.5, -0.5
    X[np.arange(n), 2 + home] = 1.0
    X[np.arange(n), 2 + n_teams + away] = 1.0
    X[n + np.arange(n), 2 + away] = 1.0
    X[n + np.arange(n), 2 + n_teams + home] = 1.0
    return X


def game_table(build: Build) -> pd.DataFrame:
    """One row per finished game (both box scores in), oldest first."""
    cols = ["game_id", "game_date", "team_code", "pts", "poss", "pace"]
    tg = pd.DataFrame(build.team_games, columns=cols + ["home_away"])
    if tg.empty:
        return pd.DataFrame(columns=["game_id", "game_date", "home", "away", "home_pts", "away_pts", "poss", "pace"])
    h = tg[tg.home_away == "home"].set_index("game_id")
    a = tg[tg.home_away == "away"].set_index("game_id")
    ids = h.index.intersection(a.index)
    h, a = h.loc[ids], a.loc[ids]
    g = pd.DataFrame({"game_id": ids, "game_date": h.game_date.to_numpy(), "home": h.team_code.to_numpy(),
                      "away": a.team_code.to_numpy(), "home_pts": h.pts.to_numpy(), "away_pts": a.pts.to_numpy(),
                      "poss": h.poss.astype(float).to_numpy(), "pace": h.pace.astype(float).to_numpy()})
    g = g[(g.poss > 0)]
    return g.sort_values(["game_date", "game_id"], kind="stable").reset_index(drop=True)


class Season:
    """Fits as of any date, built up date by date from the season's finished games."""

    def __init__(self, games: pd.DataFrame, teams: list[str]):
        self.teams = teams
        self.idx = {t: i for i, t in enumerate(teams)}
        self.games = games
        n = len(teams)
        self._state = dict(xtx=np.zeros((2 + 2 * n, 2 + 2 * n)), xty=np.zeros(2 + 2 * n), games=0,
                           pace_sum=np.zeros(n), pace_n=np.zeros(n), league_pace_sum=0.0,
                           pts_for=np.zeros(n), pts_against=np.zeros(n), poss=np.zeros(n), sq_resid=0.0, resid_n=0)
        self._next = 0  # games already added

    def add_until(self, day: str) -> None:
        """Add every game played before `day`."""
        g = self.games
        stop = int(np.searchsorted(g.game_date.to_numpy(dtype=str), day, side="left"))
        if stop <= self._next:
            return
        part = g.iloc[self._next:stop]
        s, n = self._state, len(self.teams)
        hi = part.home.map(self.idx).to_numpy()
        ai = part.away.map(self.idx).to_numpy()
        X = design(hi, ai, n)
        y = np.concatenate([100.0 * part.home_pts.to_numpy() / part.poss.to_numpy(),
                            100.0 * part.away_pts.to_numpy() / part.poss.to_numpy()])
        s["xtx"] += X.T @ X
        s["xty"] += X.T @ y
        s["games"] += len(part)
        for side_i, opp_i, pf, pa in ((hi, ai, part.home_pts, part.away_pts), (ai, hi, part.away_pts, part.home_pts)):
            np.add.at(s["pace_sum"], side_i, part.pace.to_numpy())
            np.add.at(s["pace_n"], side_i, 1)
            np.add.at(s["pts_for"], side_i, pf.to_numpy())
            np.add.at(s["pts_against"], side_i, pa.to_numpy())
            np.add.at(s["poss"], side_i, part.poss.to_numpy())
        s["league_pace_sum"] += float(part.pace.sum())
        self._next = stop

    def add_residuals(self, resid: list[float]) -> None:
        self._state["sq_resid"] += float(sum(e * e for e in resid))
        self._state["resid_n"] += len(resid)

    def fit(self, as_of: str) -> Fit:
        self.add_until(as_of)
        s, n = self._state, len(self.teams)
        league_pace = s["league_pace_sum"] / s["games"] if s["games"] else DEFAULT_PACE
        hca_prior = HCA_PTS * 100.0 / league_pace
        sigma = math.sqrt((SIGMA_PRIOR_GAMES * SIGMA_PTS ** 2 + s["sq_resid"]) / (SIGMA_PRIOR_GAMES + s["resid_n"]))
        pace = (s["pace_sum"] + PACE_PRIOR_GAMES * league_pace) / (s["pace_n"] + PACE_PRIOR_GAMES)
        with np.errstate(invalid="ignore", divide="ignore"):
            raw_o = np.where(s["poss"] > 0, 100.0 * s["pts_for"] / s["poss"], np.nan)
            raw_d = np.where(s["poss"] > 0, 100.0 * s["pts_against"] / s["poss"], np.nan)
        if s["games"] == 0:
            return Fit(as_of, 0, None, hca_prior, np.zeros(n), np.zeros(n), pace, league_pace, s["pace_n"].copy(),
                       raw_o, raw_d, sigma, s["resid_n"])
        beta = solve(s["xtx"], s["xty"], n, hca_prior)
        return Fit(as_of, s["games"], float(beta[0]), float(beta[1]), beta[2:2 + n].copy(), beta[2 + n:].copy(), pace,
                   league_pace, s["pace_n"].copy(), raw_o, raw_d, sigma, s["resid_n"])


def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def project(fit: Fit, idx: dict[str, int], home: str, away: str, home_rest: int | None, away_rest: int | None) -> dict:
    i, j = idx[home], idx[away]
    poss = fit.pace[i] * fit.pace[j] / fit.league_pace
    net = (fit.off[i] - fit.dfn[i]) - (fit.off[j] - fit.dfn[j])
    rest = B2B_PTS * ((1 if away_rest == 0 else 0) - (1 if home_rest == 0 else 0))
    home_court = fit.hca * poss / 100.0
    margin = net * poss / 100.0 + home_court + rest
    return dict(margin=margin, net_pts=net * poss / 100.0, home_court=home_court, rest=rest, poss=poss,
                home_wp=100.0 * norm_cdf(margin / fit.sigma), sigma=fit.sigma)


# ------------------------------------------------------------------ the season build


@dataclass
class ModelBuild:
    ratings: list[dict] = field(default_factory=list)  # power_ratings: one row per team per date
    days: list[dict] = field(default_factory=list)  # model_days: league numbers per date
    games: list[dict] = field(default_factory=list)  # model_games: every prediction, finished and upcoming
    backtest: list[dict] = field(default_factory=list)  # model_backtest: one row per season
    calibration: list[dict] = field(default_factory=list)  # model_calibration: one row per bin
    notes: list[str] = field(default_factory=list)


def rank(values: list[float | None], high_is_good: bool) -> list[int | None]:
    s = pd.Series(values, dtype="float64")
    r = s.rank(method="min", ascending=not high_is_good)
    return [None if math.isnan(v) else int(v) for v in r]


def ratings_rows(fit: Fit, teams: list[str], season: int) -> list[dict]:
    adj_o = [r1(fit.mu + o) for o in fit.off]
    adj_d = [r1(fit.mu + d) for d in fit.dfn]
    net = [r1(o - d) for o, d in zip(fit.off, fit.dfn)]
    raw_o = [r1(v) if not math.isnan(v) else None for v in fit.raw_ortg]
    raw_d = [r1(v) if not math.isnan(v) else None for v in fit.raw_drtg]
    o_rk, d_rk, n_rk = rank(adj_o, True), rank(adj_d, False), rank(net, True)
    rows = []
    for k, t in enumerate(teams):
        rows.append(dict(season=season, as_of=fit.as_of, team_code=t, games=int(fit.team_games[k]),
                         adj_ortg=adj_o[k], adj_drtg=adj_d[k], adj_net=net[k], ortg_rk=o_rk[k], drtg_rk=d_rk[k],
                         net_rk=n_rk[k], ortg=raw_o[k], drtg=raw_d[k],
                         net=r1(raw_o[k] - raw_d[k]) if raw_o[k] is not None and raw_d[k] is not None else None,
                         pace=r1(fit.pace[k])))
    return rows


def build_model(build: Build, lines: dict[int, float], odds: list[dict] | None = None) -> ModelBuild:
    """Ratings for every date of the season so far, a prediction for every finished game (as of its date) and
    every game in the look-ahead (as of the run date), and the backtest against ESPN's line."""
    out = ModelBuild()
    season, today = build.season, build.today.isoformat()
    teams = sorted(t["code"] for t in build.teams)
    games = game_table(build)
    games = games[games.game_date < today]
    S = Season(games, teams)
    dates = schedule_dates(build)
    odds_line = {o["game_id"]: o for o in odds or []}

    def rest(team: str, day: str) -> int | None:
        return days_since(dates.get(team, []), day)

    finished = games.to_dict("records")
    by_date: dict[str, list[dict]] = {}
    for g in finished:
        by_date.setdefault(g["game_date"], []).append(g)
    upcoming = [g for g in upcoming_games(build) if g["id"] not in {f["game_id"] for f in finished}]

    def row(g: dict, fit: Fit, day: str, home: str, away: str, line: float | None, line_source: str | None,
            actual: int | None) -> dict:
        hr, ar = rest(home, day), rest(away, day)
        p = project(fit, S.idx, home, away, hr, ar)
        pick = None if line is None or p["margin"] == line else ("home" if p["margin"] > line else "away")
        ats = None
        if pick is not None and actual is not None:
            cover = actual - line
            ats = "P" if cover == 0 else ("W" if (cover > 0) == (pick == "home") else "L")
        return dict(season=season, game_id=int(g["game_id"]), game_date=day, as_of=fit.as_of, fit_games=fit.games,
                    away_code=away, home_code=home, away_rest=ar, home_rest=hr, poss=r1(p["poss"]),
                    home_court=r1(p["home_court"]), rest_adj=r1(p["rest"]), pred_margin=r1(p["margin"]),
                    home_wp=r1(p["home_wp"]), sigma=r1(p["sigma"]), line_margin=line, line_source=line_source,
                    actual_margin=actual, pick=pick, ats=ats,
                    _margin=p["margin"], _wp=p["home_wp"])

    pred_rows: list[dict] = []
    snap_dates = sorted(set(by_date) | {today})
    for day in snap_dates:
        fit = S.fit(day)
        if fit.games:
            out.ratings += ratings_rows(fit, teams, season)
            out.days.append(dict(season=season, as_of=day, games=fit.games, league_ortg=r1(fit.mu),
                                 home_court=r1(fit.hca_pts), sigma=r1(fit.sigma), sigma_games=fit.resid_games,
                                 pace=r1(fit.league_pace)))
        if day == today:
            for g in upcoming:
                o = odds_line.get(g["id"])
                line = line_from_odds(o, g["home_code"]) if o else None
                pred_rows.append(row(dict(game_id=g["id"]), fit, g["game_date"], g["home_code"], g["away_code"],
                                     line, "odds" if line is not None else None, None))
            continue
        resid = []
        for g in by_date[day]:
            actual = int(g["home_pts"] - g["away_pts"])
            line = lines.get(int(g["game_id"]))
            r = row(g, fit, day, g["home"], g["away"], line, "pbp" if line is not None else None, actual)
            pred_rows.append(r)
            resid.append(actual - r["_margin"])
        S.add_residuals(resid)  # the spread of outcomes for later dates learns from these misses

    finals = [r for r in pred_rows if r["actual_margin"] is not None]
    out.backtest, out.calibration = backtest(finals, season, today, out.days[-1] if out.days else None)
    out.games = [{k: v for k, v in r.items() if not k.startswith("_")} for r in pred_rows]
    missing_lines = [r["game_id"] for r in finals if r["line_margin"] is None]
    if finals and len(missing_lines) == len(finals):
        out.notes.append("model: no ESPN pregame lines in the play-by-play, so the backtest has no line to compare")
    elif missing_lines:
        out.notes.append(f"model: {len(missing_lines)} finished games have no ESPN pregame line: {missing_lines[:10]}")
    return out


def backtest(finals: list[dict], season: int, today: str, last_day: dict | None) -> tuple[list[dict], list[dict]]:
    with_line = [r for r in finals if r["line_margin"] is not None]
    picks = [r for r in with_line if r["ats"] is not None]
    su = [r for r in finals if r["_margin"] != 0 and r["actual_margin"] != 0]
    su_line = [r for r in with_line if r["line_margin"] != 0 and r["actual_margin"] != 0]

    def mae(rows, key):
        return r1(sum(abs(r["actual_margin"] - key(r)) for r in rows) / len(rows)) if rows else None

    brier = (sum((r["_wp"] / 100.0 - (1.0 if r["actual_margin"] > 0 else 0.0)) ** 2 for r in finals) / len(finals)
             if finals else None)
    summary = dict(season=season, as_of=today, games=len(finals), line_games=len(with_line),
                   model_mae_all=mae(finals, lambda r: r["_margin"]),
                   model_mae=mae(with_line, lambda r: r["_margin"]), line_mae=mae(with_line, lambda r: r["line_margin"]),
                   ats_w=sum(r["ats"] == "W" for r in picks), ats_l=sum(r["ats"] == "L" for r in picks),
                   ats_p=sum(r["ats"] == "P" for r in picks),
                   su_games=len(su), su_right=int(sum((r["_margin"] > 0) == (r["actual_margin"] > 0) for r in su)),
                   line_su_games=len(su_line),
                   line_su_right=int(sum((r["line_margin"] > 0) == (r["actual_margin"] > 0) for r in su_line)),
                   model_su_on_line_games=int(sum((r["_margin"] > 0) == (r["actual_margin"] > 0) for r in su_line
                                                  if r["_margin"] != 0)),
                   brier=round(brier, 3) if brier is not None else None,
                   home_court=last_day["home_court"] if last_day else None,
                   sigma=last_day["sigma"] if last_day else None)
    cal = []
    for lo, hi in CAL_BINS:
        rows = []
        for r in finals:
            fav = max(r["_wp"], 100.0 - r["_wp"])
            if lo <= fav < hi or (hi == 100 and fav == 100):
                fav_home = r["_wp"] >= 50.0
                rows.append((fav, (r["actual_margin"] > 0) == fav_home))
        cal.append(dict(season=season, lo=lo, hi=hi, games=len(rows),
                        mean_wp=r1(sum(f for f, _ in rows) / len(rows)) if rows else None,
                        win_pct=r1(100.0 * sum(w for _, w in rows) / len(rows)) if rows else None,
                        wins=int(sum(w for _, w in rows))))
    return [summary], cal


def check_model(model: ModelBuild, build: Build) -> tuple[list[str], list[str]]:
    """Errors: a finished game without a prediction, or a prediction fit on games from its own date or later."""
    errs: list[str] = []
    predicted = {r["game_id"] for r in model.games}
    finals = {g["game_id"] for g in game_table(build).to_dict("records") if g["game_date"] < build.today.isoformat()}
    if finals - predicted:
        errs.append(f"model: {len(finals - predicted)} finished games have no prediction")
    for r in model.games:
        if r["as_of"] > r["game_date"]:
            errs.append(f"model: game {r['game_id']} was predicted with games up to {r['as_of']}")
    return errs, []
