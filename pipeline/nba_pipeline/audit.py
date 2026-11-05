"""Stat audit: season-wide checks that the box-score tables add up (docs/STATS.md).

Runs every day on the engine's tables, after its own checks. Two kinds of failure:

- warnings: ESPN's numbers disagree with each other (a team total that is not the sum of its players, a possession
  count out of the normal range). The data still loads; the message names the games.
- errors: our own math does not rebuild (a rating from its parts, a season figure from its games, a rank from its
  values, a gap's edge from its direction). That is a bug here, not in the source.

Every message starts with "stats: ".
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from nba_pipeline.compute import BETTER_HIGH, BETTER_LOW, GAP_STATS, Build

PREFIX = "stats: "

# team totals that must equal the sum of the players' lines (turnovers add the team's own, checked on their own)
SUMMED = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "pf"]
POSS_RANGE = (85.0, 125.0)  # possessions per 48 minutes; NBA games since 2000 fall well inside this
POSS_SIDES_MAX = 12.0  # the two teams' own possession estimates differ by 2 on average, 8.4 at most on the fixture
ROUND = 0.1 + 1e-9  # stored values are rounded to one decimal; a rebuild may land one step away
GAP_DIRECTION = {k: d for _, _, k, d in GAP_STATS}


def _poss(fga, oreb, tov, fta):
    return fga - oreb + tov + 0.44 * fta


def _pct(a, b):
    return (100.0 * a / b).where(b != 0)


def _list(df: pd.DataFrame, mask: pd.Series, cols: list[str], n: int = 5) -> str:
    rows = df[mask][cols].head(n)
    return "; ".join(" ".join(str(v) for v in r) for r in rows.itertuples(index=False))


def _off(a: pd.Series, b: pd.Series, tol: float = ROUND) -> pd.Series:
    """True where a and b differ by more than tol (both missing counts as equal)."""
    both_na = a.isna() & b.isna()
    return ~both_na & ((a - b).abs() > tol).fillna(True)


def team_game_frame(build: Build) -> pd.DataFrame:
    """team_games with each row's opponent columns (o_*) and the sums of its player lines (p_*)."""
    tg = pd.DataFrame(build.team_games)
    if not len(tg):
        return tg
    opp = tg.drop(columns=["opp_code", "home_away", "game_date", "win"]).rename(
        columns=lambda c: c if c == "game_id" else "o_" + c)
    tg = tg.merge(opp, left_on=["game_id", "opp_code"], right_on=["game_id", "o_team_code"], how="left")
    pg = pd.DataFrame(build.player_games)
    if len(pg):
        # everyone who checked in counts, including a player ESPN shows at 0 minutes (under 30 seconds on the floor)
        played = pg[~pg.did_not_play.astype(bool)].copy()
        for c in SUMMED + ["tov", "plus_minus", "min"]:
            played[c] = pd.to_numeric(played[c], errors="coerce").fillna(0)
        played["n"] = 1
        sums = played.groupby(["game_id", "team_code"])[SUMMED + ["tov", "plus_minus", "min", "n"]].sum()
        sums.columns = ["p_" + c for c in sums.columns]
        tg = tg.merge(sums.reset_index(), on=["game_id", "team_code"], how="left")
    return tg


def stat_checks(build: Build) -> tuple[list[str], list[str]]:
    errs: list[str] = []
    warns: list[str] = []
    tg = team_game_frame(build)
    if len(tg):
        _source_checks(tg, warns)
        _team_game_math(tg, errs)
        _team_season_math(build, tg, errs)
        _gap_checks(build, tg, errs)
    _player_season_math(build, errs)
    return [PREFIX + e for e in errs], [PREFIX + w for w in warns]


def _source_checks(tg: pd.DataFrame, warns: list[str]) -> None:
    """ESPN's numbers against each other."""
    key = ["game_id", "team_code"]
    n = len(tg)

    def warn(mask: pd.Series, what: str, cols: list[str] | None = None) -> None:
        if mask.any():
            warns.append(f"{what} in {int(mask.sum())} of {n} team-games: {_list(tg, mask, key + (cols or []))}")

    warn(tg.pts != 2 * tg.fgm + tg.tpm + tg.ftm, "points are not 2 x FGM + 3PM + FTM", ["pts"])
    warn(tg.reb != tg.oreb + tg.dreb, "rebounds are not offensive + defensive", ["reb", "oreb", "dreb"])
    warn((tg.fgm > tg.fga) | (tg.tpm > tg.tpa) | (tg.ftm > tg.fta) | (tg.tpm > tg.fgm) | (tg.tpa > tg.fga),
         "makes exceed attempts (or threes exceed field goals)")
    warn(tg.opp_pts != tg.o_pts, "opponent points differ from the opponent's row", ["opp_pts", "o_pts"])
    warn(tg.win != (tg.pts > tg.opp_pts), "the win flag does not follow the score", ["pts", "opp_pts"])
    if "p_pts" in tg:
        has = tg.p_n.notna()
        for c in SUMMED:
            warn(has & (tg[c] != tg["p_" + c]), f"team {c} is not the sum of its players", [c, "p_" + c])
        team_tov = tg.team_tov.where(tg.team_tov.notna(), tg.tov - tg.p_tov)
        warn(has & (tg.tov != tg.p_tov + team_tov), "turnovers are not player plus team turnovers",
             ["tov", "p_tov", "team_tov"])
        warn(has & (tg.p_plus_minus != 5 * (tg.pts - tg.opp_pts)), "player plus-minus does not sum to 5 x the margin",
             ["p_plus_minus", "pts", "opp_pts"])
        # ESPN rounds each player's minutes to a whole number, so the sum can drift by half a minute a player
        warn(has & ((tg.p_min - 5 * tg.minutes).abs() > 0.5 * tg.p_n + 1e-9),
             "player minutes do not add up to 5 x the game's minutes", ["p_min", "minutes"])
    warn((tg.paint > 2 * (tg.fgm - tg.tpm)) | (tg.paint % 2 == 1),
         "points in the paint are odd or exceed 2 x two-point makes", ["paint", "fgm", "tpm"])
    warn((tg.fb > tg.pts) | (tg.pts_off_to > tg.pts) | (tg.bench_pts > tg.pts),
         "fast-break, off-turnover or bench points exceed the score", ["pts", "fb", "pts_off_to", "bench_pts"])
    warn(tg.ast > tg.fgm, "assists exceed made field goals", ["ast", "fgm"])
    warn(tg.stl > tg.o_tov, "steals exceed the opponent's turnovers", ["stl", "o_tov"])
    warn(tg.blk > tg.o_fga - tg.o_fgm, "blocks exceed the opponent's missed field goals", ["blk"])
    warn(tg.lead_changes != tg.o_lead_changes, "the two teams list different lead changes", ["lead_changes"])
    warn(tg.win & (tg.largest_lead <= 0), "a winner never led", ["largest_lead"])
    warn((tg.pace < POSS_RANGE[0]) | (tg.pace > POSS_RANGE[1]),
         f"pace is outside {POSS_RANGE[0]:.0f} to {POSS_RANGE[1]:.0f} possessions per 48", ["pace", "poss"])
    own = _poss(tg.fga, tg.oreb, tg.tov, tg.fta)
    other = _poss(tg.o_fga, tg.o_oreb, tg.o_tov, tg.o_fta)
    warn((own - other).abs() > POSS_SIDES_MAX,
         f"the two teams' possession estimates differ by more than {POSS_SIDES_MAX:.0f}", ["poss"])


def _team_game_math(tg: pd.DataFrame, errs: list[str]) -> None:
    """Every rate in team_games rebuilds from its counts, and each side mirrors the other."""
    poss = (_poss(tg.fga, tg.oreb, tg.tov, tg.fta) + _poss(tg.o_fga, tg.o_oreb, tg.o_tov, tg.o_fta)) / 2
    rebuilt = {
        "poss": poss, "ortg": 100 * tg.pts / poss, "drtg": 100 * tg.opp_pts / poss,
        "net": 100 * (tg.pts - tg.opp_pts) / poss, "pace": 48 * poss / tg.minutes,
        "fg_pct": _pct(tg.fgm, tg.fga), "fg3_pct": _pct(tg.tpm, tg.tpa), "ft_pct": _pct(tg.ftm, tg.fta),
        "efg": _pct(tg.fgm + 0.5 * tg.tpm, tg.fga), "tov_pct": _pct(tg.tov, tg.fga + 0.44 * tg.fta + tg.tov),
        "orb_pct": _pct(tg.oreb, tg.oreb + tg.o_dreb), "ftr": _pct(tg.ftm, tg.fga), "ast_pct": _pct(tg.ast, tg.fgm),
        "opp_efg": _pct(tg.o_fgm + 0.5 * tg.o_tpm, tg.o_fga),
        "opp_tov_pct": _pct(tg.o_tov, tg.o_fga + 0.44 * tg.o_fta + tg.o_tov),
        "drb_pct": _pct(tg.dreb, tg.dreb + tg.o_oreb), "opp_ftr": _pct(tg.o_ftm, tg.o_fga),
    }
    for k, v in rebuilt.items():
        bad = _off(tg[k], v.round(1))
        if bad.any():
            errs.append(f"team_games.{k} does not rebuild from its parts in {int(bad.sum())} rows: "
                        f"{_list(tg, bad, ['game_id', 'team_code', k])}")
    mirrors = [("drtg", "o_ortg"), ("pace", "o_pace"), ("poss", "o_poss"), ("opp_efg", "o_efg"),
               ("opp_tov_pct", "o_tov_pct"), ("opp_ftr", "o_ftr")]
    for a, b in mirrors:
        bad = _off(tg[a], tg[b], 1e-9)
        if bad.any():
            errs.append(f"team_games.{a} is not the opponent's {b[2:]} in {int(bad.sum())} rows")
    bad = _off(tg.orb_pct + tg.o_drb_pct, pd.Series(100.0, index=tg.index), 0.1 + 1e-9)
    if bad.any():
        errs.append(f"offensive and opposing defensive rebound % do not add to 100 in {int(bad.sum())} rows")
    bad = _off(tg.net, tg.ortg - tg.drtg, 0.15)
    if bad.any():
        errs.append(f"team_games.net is not ortg - drtg in {int(bad.sum())} rows")


def _team_season_math(build: Build, tg: pd.DataFrame, errs: list[str]) -> None:
    """team_season rebuilds from the season's team_games, and every rank follows its direction."""
    ts = pd.DataFrame(build.team_season)
    if not len(ts):
        return
    own, other = _poss(tg.fga, tg.oreb, tg.tov, tg.fta), _poss(tg.o_fga, tg.o_oreb, tg.o_tov, tg.o_fta)
    tg = tg.assign(poss_raw=(own + other) / 2)
    s = tg.sort_values("game_date").groupby("team_code")
    agg = s.sum(numeric_only=True)
    n = s.size()
    l5 = tg.sort_values("game_date").groupby("team_code").tail(5).groupby("team_code").sum(numeric_only=True)
    ts = ts.set_index("team_code")
    rebuilt = {
        "gp": n, "w": s.win.sum(), "ortg": 100 * agg.pts / agg.poss_raw, "drtg": 100 * agg.opp_pts / agg.poss_raw,
        "net": 100 * (agg.pts - agg.opp_pts) / agg.poss_raw, "l5_net": 100 * (l5.pts - l5.opp_pts) / l5.poss_raw,
        "pace": 48 * agg.poss_raw / agg.minutes, "ppg": agg.pts / n, "opp_ppg": agg.opp_pts / n,
        "diff": (agg.pts - agg.opp_pts) / n, "efg": _pct(agg.fgm + 0.5 * agg.tpm, agg.fga),
        "tov_pct": _pct(agg.tov, agg.fga + 0.44 * agg.fta + agg.tov), "orb_pct": _pct(agg.oreb, agg.oreb + agg.o_dreb),
        "ftr": _pct(agg.ftm, agg.fga), "opp_efg": _pct(agg.o_fgm + 0.5 * agg.o_tpm, agg.o_fga),
        "opp_tov_pct": _pct(agg.o_tov, agg.o_fga + 0.44 * agg.o_fta + agg.o_tov),
        "drb_pct": _pct(agg.dreb, agg.dreb + agg.o_oreb), "opp_ftr": _pct(agg.o_ftm, agg.o_fga),
        "fg_pct": _pct(agg.fgm, agg.fga), "fg3_pct": _pct(agg.tpm, agg.tpa), "ft_pct": _pct(agg.ftm, agg.fta),
        "fg3a_rate": _pct(agg.tpa, agg.fga), "fg3m_pg": agg.tpm / n, "opp_fg_pct": _pct(agg.o_fgm, agg.o_fga),
        "opp_fg3_pct": _pct(agg.o_tpm, agg.o_tpa), "opp_fg3m_pg": agg.o_tpm / n, "rpg": agg.reb / n,
        "opp_rpg": agg.o_reb / n, "apg": agg.ast / n, "spg": agg.stl / n, "bpg": agg.blk / n, "tovpg": agg.tov / n,
        "forced_tovpg": agg.o_tov / n, "fb_pg": agg.fb / n, "opp_fb_pg": agg.o_fb / n, "paint_pg": agg.paint / n,
        "opp_paint_pg": agg.o_paint / n, "pts_off_to_pg": agg.pts_off_to / n, "opp_pts_off_to_pg": agg.o_pts_off_to / n,
        "bench_ppg": agg.bench_pts / n, "opp_bench_ppg": agg.o_bench_pts / n,
    }
    for k, v in rebuilt.items():
        v = v.reindex(ts.index)
        bad = _off(ts[k].astype(float), v.astype(float).round(1))
        if bad.any():
            errs.append(f"team_season.{k} does not rebuild from team_games for {sorted(ts.index[bad])[:5]}")
    bad = ts.w + ts.l != ts.gp
    if bad.any():
        errs.append(f"team_season wins and losses do not add to games played for {sorted(ts.index[bad])[:5]}")
    if ts.w.sum() != ts.l.sum():
        errs.append(f"the league's wins ({int(ts.w.sum())}) and losses ({int(ts.l.sum())}) differ")
    for k in BETTER_HIGH + BETTER_LOW:
        want = ts[k].rank(ascending=k in BETTER_LOW, method="min")
        bad = ts[k + "_rk"] != want
        if bad.any():
            errs.append(f"team_season.{k}_rk does not rank {'lowest' if k in BETTER_LOW else 'highest'} first "
                        f"for {sorted(ts.index[bad])[:5]}")


def _gap_checks(build: Build, tg: pd.DataFrame, errs: list[str]) -> None:
    """Each gap shows the two teams' team_games values, and its edge goes to the better (or bigger) side."""
    gg = pd.DataFrame(build.game_gaps)
    if not len(gg):
        return
    vals = tg.set_index(["game_id", "team_code"])
    away = pd.Series([vals[k].get((g, t)) for g, t, k in zip(gg.game_id, gg.away_code, gg.key)], index=gg.index)
    home = pd.Series([vals[k].get((g, t)) for g, t, k in zip(gg.game_id, gg.home_code, gg.key)], index=gg.index)
    bad = _off(gg.away_val, away.astype(float), 1e-9) | _off(gg.home_val, home.astype(float), 1e-9)
    if bad.any():
        errs.append(f"game_gaps values differ from team_games in {int(bad.sum())} rows: "
                    f"{_list(gg, bad, ['game_id', 'key'])}")
    d = gg.away_val - gg.home_val
    sign = gg.key.map(GAP_DIRECTION).replace(0, 1)  # volume stats: the edge names the side with more
    want = pd.Series(np.where(d * sign > 0, gg.away_code, np.where(d * sign < 0, gg.home_code, "")), index=gg.index)
    bad = gg.edge != want
    if bad.any():
        errs.append(f"game_gaps edge does not follow the stat's direction in {int(bad.sum())} rows: "
                    f"{_list(gg, bad, ['game_id', 'key', 'edge'])}")
    bad = gg.volume != (gg.key.map(GAP_DIRECTION) == 0)
    if bad.any():
        errs.append(f"game_gaps volume flag is wrong in {int(bad.sum())} rows")
    has_sd = gg.sd.notna() & (gg.sd > 0)
    bad = has_sd & ((gg.z - (gg.gap / gg.sd).round(2)).abs() > 0.01 + 1e-9)
    if bad.any():
        errs.append(f"game_gaps z is not gap / sd in {int(bad.sum())} rows")


def _player_season_math(build: Build, errs: list[str]) -> None:
    """player_season rebuilds from player_games (the engine counts games with more than 0 minutes)."""
    ps = pd.DataFrame(build.player_season)
    pg = pd.DataFrame(build.player_games)
    if not len(ps) or not len(pg):
        return
    p = pg[~pg.did_not_play.astype(bool) & (pd.to_numeric(pg["min"], errors="coerce").fillna(0) > 0)].copy()
    cols = ["min", "pts", "reb", "oreb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "tpm", "tpa", "ftm", "fta",
            "plus_minus"]
    for c in cols:
        p[c] = pd.to_numeric(p[c], errors="coerce").fillna(0)
    g = p.groupby("player_id")
    a = g[cols].sum()
    n = g.game_id.nunique()
    ps = ps.set_index("player_id")
    rebuilt = {
        "gp": n, "gs": g.starter.sum(), "mpg": a["min"] / n, "ppg": a.pts / n, "rpg": a.reb / n, "orpg": a.oreb / n,
        "apg": a.ast / n, "spg": a.stl / n, "bpg": a.blk / n, "tovpg": a.tov / n, "pfpg": a.pf / n,
        "fg_pct": _pct(a.fgm, a.fga), "fg3m_pg": a.tpm / n, "fg3_pct": _pct(a.tpm, a.tpa), "ft_pct": _pct(a.ftm, a.fta),
        "ts_pct": _pct(a.pts, 2 * (a.fga + 0.44 * a.fta)), "pm_total": a.plus_minus, "pm_pg": a.plus_minus / n,
        "hi_pts": g.pts.max(),
    }
    for k, v in rebuilt.items():
        v = v.reindex(ps.index).astype(float).round(1)
        bad = _off(ps[k].astype(float), v)
        if bad.any():
            errs.append(f"player_season.{k} does not rebuild from player_games for {int(bad.sum())} players: "
                        f"{list(ps.index[bad][:5])}")
