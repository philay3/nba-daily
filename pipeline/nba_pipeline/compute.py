"""Stats engine: a faithful port of the original engine's `base` phase (docs/reference/nba_build.py).

The formulas, rounding and ordering are unchanged; the parity tests compare against the original
engine's golden JSON. What is new only widens the scope, reusing the same code paths:

- box order, pre-game averages, deltas and flags for every game (averages use games before that
  game's date), not only last night's;
- team-vs-team gaps for every game (z against the season's spread of road-minus-home gaps);
- rest days, records entering the game and upsets for every game up to tonight;
- as-of filtering: only games before `today` count, so a past `--date` rebuilds that morning;
- empty-season safety (opening night has no completed games).

One fix on purpose (golden files regenerated, see docs/DECISIONS.md): the engine read ESPN's turnoverPoints as
points scored, but ESPN means points conceded. `pts_off_to` is now the opponent's figure, so it is the points this
team scored off the opponent's turnovers, and `o_pts_off_to` is the points it allowed off its own.

The result is a `Build` of normalized rows whose keys are the database columns.
"""
from __future__ import annotations

import bisect
import datetime as dt
from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

from nba_pipeline.config import ET, REGULAR_SEASON
from nba_pipeline.teams import CODES, EAST, code, conference, hex_color
from nba_pipeline.util import as_int, num, pct, periods_of, r1, records_of

BETTER_HIGH = ["ortg", "net", "l5_net", "ppg", "diff", "efg", "orb_pct", "ftr", "opp_tov_pct", "drb_pct", "fg_pct",
               "fg3_pct", "ft_pct", "rpg", "apg", "spg", "bpg", "forced_tovpg", "fb_pg", "paint_pg", "pts_off_to_pg",
               "bench_ppg", "fg3m_pg", "pace", "fg3a_rate"]
BETTER_LOW = ["drtg", "opp_ppg", "tov_pct", "opp_efg", "opp_ftr", "opp_fg_pct", "opp_fg3_pct", "opp_rpg", "tovpg",
              "opp_fb_pg", "opp_paint_pg", "opp_pts_off_to_pg", "opp_bench_ppg", "opp_fg3m_pg"]
TEAM_STAT_KEYS = ["ortg", "drtg", "net", "l5_net", "pace", "ppg", "opp_ppg", "diff", "efg", "tov_pct", "orb_pct", "ftr",
                  "opp_efg", "opp_tov_pct", "drb_pct", "opp_ftr", "fg_pct", "fg3_pct", "ft_pct", "fg3a_rate", "fg3m_pg",
                  "opp_fg_pct", "opp_fg3_pct", "opp_fg3m_pg", "rpg", "opp_rpg", "apg", "spg", "bpg", "tovpg",
                  "forced_tovpg", "fb_pg", "opp_fb_pg", "paint_pg", "opp_paint_pg", "pts_off_to_pg",
                  "opp_pts_off_to_pg", "bench_ppg", "opp_bench_ppg"]

# (group, label, key, direction): 1 = higher is better, -1 = lower is better, 0 = volume (no better side)
GAP_STATS = [("Scoring", "Points", "pts", 1), ("Shooting", "Field goal %", "fg_pct", 1), ("Shooting", "Effective FG %", "efg", 1),
             ("Shooting", "3-point %", "fg3_pct", 1), ("Shooting", "Free throw %", "ft_pct", 1),
             ("Shooting", "Field goal attempts", "fga", 0), ("Shooting", "3-pointers made", "tpm", 1),
             ("Shooting", "3-point attempts", "tpa", 0), ("Shooting", "Free throw attempts", "fta", 1),
             ("Possession", "Offensive rebounds", "oreb", 1), ("Possession", "Defensive rebounds", "dreb", 1),
             ("Possession", "Total rebounds", "reb", 1), ("Possession", "Turnovers", "tov", -1),
             ("Possession", "Steals", "stl", 1), ("Possession", "Offensive rebound %", "orb_pct", 1),
             ("Possession", "Turnover %", "tov_pct", -1), ("Playmaking", "Assists", "ast", 1),
             ("Defense", "Blocks", "blk", 1), ("Defense", "Fouls", "pf", -1), ("Scoring", "Fast-break points", "fb", 1),
             ("Scoring", "Points in the paint", "paint", 1), ("Scoring", "Points off turnovers", "pts_off_to", 1),
             ("Scoring", "Bench points", "bench_pts", 1), ("Scoring", "Offensive rating", "ortg", 1),
             ("Flow", "Largest lead", "largest_lead", 1)]
GAP_GROUP_ORDER = {"Scoring": 0, "Shooting": 1, "Possession": 2, "Playmaking": 3, "Defense": 4, "Flow": 5}


@dataclass
class Fill:
    """Box score for a game the season files do not have yet (from a PATCH file or the raw mirror)."""
    prow: list
    trow: list
    periods: list
    n_per: int | None
    source: str  # patch | raw
    note: str


@dataclass
class Build:
    today: dt.date
    yesterday: dt.date
    season: int
    meta: dict
    teams: list[dict] = field(default_factory=list)
    players: list[dict] = field(default_factory=list)
    games: list[dict] = field(default_factory=list)
    team_games: list[dict] = field(default_factory=list)
    player_games: list[dict] = field(default_factory=list)
    team_season: list[dict] = field(default_factory=list)
    player_season: list[dict] = field(default_factory=list)
    game_gaps: list[dict] = field(default_factory=list)
    player_game_deltas: list[dict] = field(default_factory=list)


def _agg(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby("athlete_id")
    a = g.agg(player=("athlete_display_name", "last"), team=("team", "last"),
              pos=("athlete_position_abbreviation", "last"), gp=("game_id", "nunique"), gs=("starter", "sum"),
              mins=("minutes", "sum"), pts=("points", "sum"), reb=("rebounds", "sum"), oreb=("offensive_rebounds", "sum"),
              ast=("assists", "sum"), stl=("steals", "sum"), blk=("blocks", "sum"), tov=("turnovers", "sum"),
              pf=("fouls", "sum"), fgm=("field_goals_made", "sum"), fga=("field_goals_attempted", "sum"),
              tpm=("three_point_field_goals_made", "sum"), tpa=("three_point_field_goals_attempted", "sum"),
              ftm=("free_throws_made", "sum"), fta=("free_throws_attempted", "sum"), pm=("pm", "sum"),
              hi_pts=("points", "max"), hi_reb=("rebounds", "max"), hi_ast=("assists", "max"))
    return a.reset_index()


def _tv(bname, bmkt) -> str:
    bname, bmkt = str(bname or ""), str(bmkt or "")
    if bmkt == "national" and bname:
        return bname
    if "MNMT" in bname or "Monumental" in bname:
        return "Monumental · League Pass"
    return "League Pass"


def _tip(s_date) -> pd.Timestamp:
    t = pd.Timestamp(s_date)
    return t.tz_convert("UTC") if t.tzinfo else pd.Timestamp(s_date, tz="UTC")


def _clean_value(v):
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and v != v:
        return None
    return v


def compute(pb: pd.DataFrame, tb: pd.DataFrame, sc: pd.DataFrame, today: dt.date, season: int,
            fill_missing: Callable[[int, str], Fill | None] | None = None, drop: tuple = ()) -> Build:
    yday = today - dt.timedelta(days=1)
    meta = dict(today=today.isoformat(), yesterday=yday.isoformat(), season=season, notes=[])
    T0 = today.isoformat()

    pb = pb[pb.season_type == REGULAR_SEASON].copy()
    tb = tb[tb.season_type == REGULAR_SEASON].copy()
    sc = sc[sc.season_type == REGULAR_SEASON].copy()
    # only games between two of the 30 teams: drops the All-Star games (World, Stars, Stripes...) that ESPN files
    # as regular season, and NBA Cup knockout placeholders whose teams are still TBD
    nba = lambda col: col.map(code).isin(CODES)  # noqa: E731
    sc_nba = nba(sc.away_abbreviation) & nba(sc.home_abbreviation)
    if (~sc_nba).any():
        meta["non_nba_games"] = sorted(int(g) for g in sc[~sc_nba].game_id)
    sc = sc[sc_nba].copy()
    tb = tb[nba(tb.team_abbreviation) & nba(tb.opponent_team_abbreviation)].copy()
    pb = pb[nba(pb.team_abbreviation) & nba(pb.opponent_team_abbreviation)].copy()
    # the mirror occasionally carries placeholder player rows with no athlete (no id, no name, no stats)
    no_id = pb.athlete_id.isna()
    if no_id.any():
        meta["dropped_player_rows"] = int(no_id.sum())
        pb = pb[~no_id].copy()
    for df in (pb, tb):
        df["game_date"] = df["game_date"].astype(str)
    sc["game_date"] = sc["game_date"].astype(str)
    # as-of: only games played before tonight count (a no-op on a normal morning run)
    tb = tb[tb.game_date < T0].copy()
    pb = pb[pb.game_date < T0].copy()
    if drop:  # testing only: pretend the season files do not have these games yet
        tb = tb[~tb.game_id.astype(int).isin(drop)].copy()
        pb = pb[~pb.game_id.astype(int).isin(drop)].copy()

    # ---- add finished games the season files do not have yet (PATCH files first, then the raw mirror)
    sc["game_id"] = sc.game_id.astype(int)
    finals = sc[(sc.status_type_name == "STATUS_FINAL") & (sc.game_date < T0)]
    y_sched = [int(g) for g in sc[sc.game_date == yday.isoformat()].game_id]
    have = set(tb.game_id.astype(int))
    want = sorted({int(g) for g in finals.game_id} | set(y_sched))
    period_map, period_n, box_source = {}, {}, {}
    extra_p, extra_t = [], []
    for gid in [g for g in want if g not in have]:
        gd = sc[sc.game_id == gid].iloc[0]["game_date"]
        got = fill_missing(gid, gd) if fill_missing else None
        if got is None:
            continue
        extra_p += got.prow
        extra_t += got.trow
        period_map[gid] = got.periods
        if got.n_per is not None:
            period_n[gid] = got.n_per
        box_source[gid] = got.source
        meta["notes"].append(got.note)
    if extra_t:
        tb = pd.concat([tb, pd.DataFrame(extra_t)], ignore_index=True)
        pb = pd.concat([pb, pd.DataFrame(extra_p)], ignore_index=True)
    have = set(tb.game_id.astype(int))
    meta["last_night_scheduled"] = y_sched
    meta["last_night_missing"] = [g for g in y_sched if g not in have]
    meta["missing_games"] = [int(g) for g in finals.game_id if int(g) not in have]

    # ---- normalise
    for col in ["largest_lead", "lead_changes", "fast_break_points", "points_in_paint", "turnover_points"]:
        tb[col] = pd.to_numeric(tb[col], errors="coerce")
    tb["team"] = tb.team_abbreviation.map(code)
    pb["team"] = pb.team_abbreviation.map(code)
    pb["opp"] = pb.opponent_team_abbreviation.map(code)
    pb["pm"] = pd.to_numeric(pb.plus_minus.astype(str).str.replace("+", "", regex=False), errors="coerce")
    sc["away"] = sc.away_abbreviation.map(code)
    sc["home"] = sc.home_abbreviation.map(code)
    names = {}
    for _, r in tb.iterrows():
        if isinstance(r.get("team_name"), str) and r.get("team_name"):
            names[r.team] = (r.get("team_name"), r.get("team_display_name"))
    for _, r in sc.iterrows():
        names.setdefault(r.away, (r.away_name, r.away_display_name))
        names.setdefault(r.home, (r.home_name, r.home_display_name))

    # ---- one row per team-game with opponent columns
    periods = {int(r.game_id): int(r.status_period) if not pd.isna(r.status_period) else 4 for _, r in sc.iterrows()}
    periods.update({g: max(4, len(v)) for g, v in period_map.items()})
    periods.update(period_n)
    bench = pb[(~pb.starter.astype(bool)) & (~pb.did_not_play.astype(bool))].groupby(["game_id", "team"]).points.sum()
    T = tb[["game_id", "game_date", "team", "team_home_away", "team_score", "team_winner", "field_goals_made",
            "field_goals_attempted", "three_point_field_goals_made", "three_point_field_goals_attempted",
            "free_throws_made", "free_throws_attempted", "offensive_rebounds", "defensive_rebounds", "total_rebounds",
            "assists", "steals", "blocks", "total_turnovers", "fouls", "fast_break_points", "points_in_paint",
            "turnover_points", "largest_lead", "lead_changes"]].copy()
    T.columns = ["game_id", "date", "team", "ha", "pts", "win", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb",
                 "reb", "ast", "stl", "blk", "tov", "pf", "fb", "paint", "to_pts_conceded", "largest_lead", "lead_changes"]
    T["game_id"] = T.game_id.astype(int)
    for c in T.columns:
        if c not in ("game_id", "date", "team", "ha", "win"):
            T[c] = pd.to_numeric(T[c], errors="coerce").fillna(0)
    T["bench_pts"] = [float(bench.get((g, t), 0)) for g, t in zip(T.game_id, T.team)]
    O = T.drop(columns=["date", "ha", "win"]).rename(columns=lambda c: c if c == "game_id" else "o_" + c)
    G = T.merge(O, on="game_id")
    G = G[G.team != G.o_team].copy()
    # ESPN's turnoverPoints is "Points Conceded Off Turnovers": what the opponent scored off this team's turnovers.
    # So a team's points off turnovers are the opponent's figure, and the points it allowed off turnovers are its own.
    G["pts_off_to"], G["o_pts_off_to"] = G.o_to_pts_conceded, G.to_pts_conceded
    G["poss_own"] = G.fga - G.oreb + G.tov + 0.44 * G.fta
    G["poss_opp"] = G.o_fga - G.o_oreb + G.o_tov + 0.44 * G.o_fta
    G["poss"] = (G.poss_own + G.poss_opp) / 2
    G["periods"] = G.game_id.map(periods).fillna(4)
    G["minutes"] = 48 + 5 * (G.periods - 4)
    G = G.sort_values(["team", "date"])

    # ---- team season profile (offense, defense, four factors, ranks)
    teams = []
    for t, g in G.groupby("team"):
        s = g.sum(numeric_only=True)
        n = len(g)
        poss = s.poss
        l5 = g.tail(5)
        l5s = l5.sum(numeric_only=True)
        res = "".join("W" if w else "L" for w in g.win)
        streak_ch = res[-1] if res else ""
        streak_n = len(res) - len(res.rstrip(streak_ch)) if res else 0
        home = g[g.ha == "home"]
        road = g[g.ha == "away"]
        teams.append(dict(
            team=t, name=names.get(t, (t, t))[1], nickname=names.get(t, (t, t))[0], conf="East" if t in EAST else "West",
            gp=n, w=int(g.win.sum()), l=int(n - g.win.sum()),
            home_rec=f"{int(home.win.sum())}-{int(len(home) - home.win.sum())}",
            road_rec=f"{int(road.win.sum())}-{int(len(road) - road.win.sum())}",
            streak=f"{streak_ch}{streak_n}" if streak_n else "",
            l5_rec=f"{int(l5.win.sum())}-{int(len(l5) - l5.win.sum())}",
            ortg=r1(100 * s.pts / poss), drtg=r1(100 * s.o_pts / poss), net=r1(100 * (s.pts - s.o_pts) / poss),
            l5_net=r1(100 * (l5s.pts - l5s.o_pts) / l5s.poss),
            pace=r1(48 * poss / s.minutes),
            ppg=r1(s.pts / n), opp_ppg=r1(s.o_pts / n), diff=r1((s.pts - s.o_pts) / n),
            efg=r1(pct(s.fgm + 0.5 * s.tpm, s.fga)), tov_pct=r1(pct(s.tov, s.fga + 0.44 * s.fta + s.tov)),
            orb_pct=r1(pct(s.oreb, s.oreb + s.o_dreb)), ftr=r1(pct(s.ftm, s.fga)),
            opp_efg=r1(pct(s.o_fgm + 0.5 * s.o_tpm, s.o_fga)), opp_tov_pct=r1(pct(s.o_tov, s.o_fga + 0.44 * s.o_fta + s.o_tov)),
            drb_pct=r1(pct(s.dreb, s.dreb + s.o_oreb)), opp_ftr=r1(pct(s.o_ftm, s.o_fga)),
            fg_pct=r1(pct(s.fgm, s.fga)), fg3_pct=r1(pct(s.tpm, s.tpa)), ft_pct=r1(pct(s.ftm, s.fta)),
            fg3a_rate=r1(pct(s.tpa, s.fga)), fg3m_pg=r1(s.tpm / n),
            opp_fg_pct=r1(pct(s.o_fgm, s.o_fga)), opp_fg3_pct=r1(pct(s.o_tpm, s.o_tpa)), opp_fg3m_pg=r1(s.o_tpm / n),
            rpg=r1(s.reb / n), opp_rpg=r1(s.o_reb / n), apg=r1(s.ast / n), spg=r1(s.stl / n), bpg=r1(s.blk / n),
            tovpg=r1(s.tov / n), forced_tovpg=r1(s.o_tov / n), fb_pg=r1(s.fb / n), opp_fb_pg=r1(s.o_fb / n),
            paint_pg=r1(s.paint / n), opp_paint_pg=r1(s.o_paint / n), pts_off_to_pg=r1(s.pts_off_to / n),
            opp_pts_off_to_pg=r1(s.o_pts_off_to / n), bench_ppg=r1(s.bench_pts / n), opp_bench_ppg=r1(s.o_bench_pts / n),
        ))
    TS = pd.DataFrame(teams)
    if len(TS):
        for c in BETTER_HIGH:
            TS[c + "_rk"] = TS[c].rank(ascending=False, method="min").astype(int)
        for c in BETTER_LOW:
            TS[c + "_rk"] = TS[c].rank(ascending=True, method="min").astype(int)
        TS = TS.sort_values("net", ascending=False)

    # ---- player season (through last night)
    P = pb[~pb.did_not_play.astype(bool) & (pb.minutes.fillna(0) > 0)].copy()
    P["game_id"] = P.game_id.astype(int)
    P["athlete_id"] = P.athlete_id.astype(int)
    PS = pd.DataFrame()
    if len(P):
        S = _agg(P)
        rows = []
        for _, r in S.iterrows():
            n = r.gp
            rows.append(dict(player_id=int(r.athlete_id), player=r.player, team=r.team, pos=r.pos or "", gp=int(n), gs=int(r.gs),
                             mpg=r1(r.mins / n), ppg=r1(r.pts / n), rpg=r1(r.reb / n), orpg=r1(r.oreb / n), apg=r1(r.ast / n),
                             spg=r1(r.stl / n), bpg=r1(r.blk / n), tovpg=r1(r.tov / n), pfpg=r1(r.pf / n),
                             fg_pct=r1(pct(r.fgm, r.fga)), fg3m_pg=r1(r.tpm / n), fg3_pct=r1(pct(r.tpm, r.tpa)),
                             ft_pct=r1(pct(r.ftm, r.fta)), ts_pct=r1(pct(r.pts, 2 * (r.fga + 0.44 * r.fta))),
                             pm_total=int(r.pm), pm_pg=r1(r.pm / n), hi_pts=int(r.hi_pts)))
        PS = pd.DataFrame(rows)
        PS["team_mpg_rank"] = PS.groupby("team").mpg.rank(ascending=False, method="first").astype(int)
        PS = PS.sort_values(["team", "team_mpg_rank"])

    sched = {int(r.game_id): r for _, r in sc.iterrows()}
    gcode = {gid: f"{r.away}@{r.home}" for gid, r in sched.items()}
    y_ids = [g for g in y_sched if g in set(T.game_id)]
    meta["last_night_games"] = len(y_ids)

    # ---- box rows for every game: order, deltas against averages before that date, flags
    before_cache: dict[str, dict] = {}

    def bmap_for(d: str) -> dict:
        if d not in before_cache:
            sub = P[P.game_date < d]
            before_cache[d] = {int(r.athlete_id): r for _, r in _agg(sub).iterrows()} if len(sub) else {}
        return before_cache[d]

    player_games, deltas = [], []
    Y = pb.copy()
    Y["game_id"] = Y.game_id.astype(int)
    for (gid, team), g in Y.groupby(["game_id", "team"], sort=False):
        played = g[~g.did_not_play.astype(bool) & (g.minutes.fillna(0) > 0)]
        order = list(played[played.starter.astype(bool)].index) + \
            list(played[~played.starter.astype(bool)].sort_values("minutes", ascending=False).index)
        dnp = g[g.did_not_play.astype(bool) | (g.minutes.fillna(0) == 0)]
        for i, idx in enumerate(order + list(dnp.index)):
            r = g.loc[idx]
            pid = int(r.athlete_id)
            is_dnp = bool(r.did_not_play) or not (num(r.minutes) or 0) > 0
            fgm, fga = num(r.field_goals_made), num(r.field_goals_attempted)
            tpm, tpa = num(r.three_point_field_goals_made), num(r.three_point_field_goals_attempted)
            ftm, fta = num(r.free_throws_made), num(r.free_throws_attempted)
            pm = None if pd.isna(r.pm) else int(r.pm)
            reason = r.get("reason")
            pos = r.athlete_position_abbreviation
            player_games.append(dict(
                game_id=int(gid), player_id=pid, team_code=team, opp_code=r.opp, home_away=r.home_away,
                game_date=r.game_date, name=r.athlete_display_name, position=pos if isinstance(pos, str) else "",
                starter=bool(r.starter), did_not_play=bool(r.did_not_play),
                reason=reason if isinstance(reason, str) else None,
                ejected=bool(r.get("ejected")) if not pd.isna(r.get("ejected")) else None,
                box_order=i, min=num(r.minutes), pts=as_int(r.points), fgm=as_int(fgm), fga=as_int(fga), tpm=as_int(tpm),
                tpa=as_int(tpa), ftm=as_int(ftm), fta=as_int(fta), oreb=as_int(r.offensive_rebounds),
                dreb=as_int(r.defensive_rebounds), reb=as_int(r.rebounds), ast=as_int(r.assists), stl=as_int(r.steals),
                blk=as_int(r.blocks), tov=as_int(r.turnovers), pf=as_int(r.fouls), plus_minus=pm,
                ts_pct=(r1(pct(r.points, 2 * (fga + 0.44 * fta))) if (fga + fta) > 0 else None) if not is_dnp else None,
                _dnp=is_dnp, _short=r.get("athlete_short_name"), _jersey=r.get("athlete_jersey")))
            if is_dnp:
                continue
            row = dict(min=int(r.minutes), pts=int(r.points), reb=int(r.rebounds), ast=int(r.assists), stl=int(r.steals),
                       blk=int(r.blocks), pm=pm)
            d = dict(game_id=int(gid), player_id=pid, team_code=team, game_date=r.game_date, gp_before=0,
                     avg_min=None, avg_pts=None, avg_reb=None, avg_ast=None, avg_pm=None,
                     d_pts=None, d_reb=None, d_ast=None, d_min=None)
            b = bmap_for(r.game_date).get(pid)
            flags = []
            if b is not None and b.gp > 0:
                n = b.gp
                avg = dict(min=b.mins / n, pts=b.pts / n, reb=b.reb / n, ast=b.ast / n, pm=b.pm / n, tpm=b.tpm / n)
                d.update(gp_before=int(n), avg_min=r1(avg["min"]), avg_pts=r1(avg["pts"]), avg_reb=r1(avg["reb"]),
                         avg_ast=r1(avg["ast"]), avg_pm=r1(avg["pm"]),
                         d_pts=r1(row["pts"] - avg["pts"]), d_reb=r1(row["reb"] - avg["reb"]),
                         d_ast=r1(row["ast"] - avg["ast"]), d_min=r1(row["min"] - avg["min"]))
                if abs(d["d_pts"]) >= 8 and max(avg["min"], row["min"]) >= 12:
                    flags.append(f"PTS {d['d_pts']:+.0f} vs avg")
                if abs(d["d_reb"]) >= 5:
                    flags.append(f"REB {d['d_reb']:+.0f}")
                if abs(d["d_ast"]) >= 4:
                    flags.append(f"AST {d['d_ast']:+.0f}")
                if tpm - avg["tpm"] >= 3:
                    flags.append(f"3PM {tpm - avg['tpm']:+.0f}")
                if abs(d["d_min"]) >= 10:
                    flags.append(f"MIN {d['d_min']:+.0f}")
                if row["pts"] > b.hi_pts and row["pts"] >= 15:
                    flags.append("Season high PTS")
            else:
                flags.append("First game this season")
            if row["pm"] is not None and abs(row["pm"]) >= 15:
                flags.append(f"+/- {row['pm']:+d}")
            if row["pts"] >= 10 and row["reb"] >= 10 and row["ast"] >= 10:
                flags.append("Triple-double")
            elif sum(1 for v in (row["pts"], row["reb"], row["ast"], row["stl"], row["blk"]) if v >= 10) >= 2:
                flags.append("Double-double")
            d["flags"] = " · ".join(flags)
            deltas.append(d)

    # ---- team box rows for every game (the engine's box_teams shape plus the database extras)
    team_games, bt = [], []
    for _, r in G.iterrows():
        gid = int(r.game_id)
        row = dict(game_id=gcode.get(gid), espn_id=gid, team=r.team, opp=r.o_team, ha=r.ha,
                   pts=int(r.pts), fgm=int(r.fgm), fga=int(r.fga), fg_pct=r1(pct(r.fgm, r.fga)), tpm=int(r.tpm),
                   tpa=int(r.tpa), fg3_pct=r1(pct(r.tpm, r.tpa)), ftm=int(r.ftm), fta=int(r.fta),
                   ft_pct=r1(pct(r.ftm, r.fta)), oreb=int(r.oreb), dreb=int(r.dreb), reb=int(r.reb), ast=int(r.ast),
                   stl=int(r.stl), blk=int(r.blk), tov=int(r.tov), pf=int(r.pf), fb=int(r.fb), paint=int(r.paint),
                   pts_off_to=int(r.pts_off_to), bench_pts=int(r.bench_pts), largest_lead=int(r.largest_lead),
                   lead_changes=int(r.lead_changes), poss=r1(r.poss), ortg=r1(100 * r.pts / r.poss),
                   efg=r1(pct(r.fgm + 0.5 * r.tpm, r.fga)), tov_pct=r1(pct(r.tov, r.fga + 0.44 * r.fta + r.tov)),
                   orb_pct=r1(pct(r.oreb, r.oreb + r.o_dreb)), ftr=r1(pct(r.ftm, r.fga)),
                   ast_pct=r1(pct(r.ast, r.fgm)))
        bt.append(row)
        team_games.append(dict(
            game_id=gid, team_code=r.team, opp_code=r.o_team, home_away=r.ha, game_date=r.date, win=bool(r.win),
            pts=row["pts"], opp_pts=int(r.o_pts), fgm=row["fgm"], fga=row["fga"], tpm=row["tpm"], tpa=row["tpa"],
            ftm=row["ftm"], fta=row["fta"], oreb=row["oreb"], dreb=row["dreb"], reb=row["reb"], ast=row["ast"],
            stl=row["stl"], blk=row["blk"], tov=row["tov"], team_tov=None, pf=row["pf"], tech_fouls=None,
            flagrant_fouls=None, fb=row["fb"], paint=row["paint"], pts_off_to=row["pts_off_to"],
            bench_pts=row["bench_pts"], largest_lead=row["largest_lead"], lead_changes=row["lead_changes"],
            num_periods=int(r.periods), minutes=int(r.minutes), poss=row["poss"], ortg=row["ortg"],
            drtg=r1(100 * r.o_pts / r.poss), net=r1(100 * (r.pts - r.o_pts) / r.poss), pace=r1(48 * r.poss / r.minutes),
            fg_pct=row["fg_pct"], fg3_pct=row["fg3_pct"], ft_pct=row["ft_pct"], efg=row["efg"], tov_pct=row["tov_pct"],
            orb_pct=row["orb_pct"], ftr=row["ftr"], ast_pct=row["ast_pct"],
            opp_efg=r1(pct(r.o_fgm + 0.5 * r.o_tpm, r.o_fga)),
            opp_tov_pct=r1(pct(r.o_tov, r.o_fga + 0.44 * r.o_fta + r.o_tov)),
            drb_pct=r1(pct(r.dreb, r.dreb + r.o_oreb)), opp_ftr=r1(pct(r.o_ftm, r.o_fga))))
    _team_box_extras(team_games, tb)

    # ---- gaps: compare against how big that gap usually is in a game this season (std of away-home differences)
    game_gaps = []
    if len(G):
        A = G[G.ha == "away"].copy()
        A["fg_pct"] = 100 * A.fgm / A.fga
        A["o_fg_pct"] = 100 * A.o_fgm / A.o_fga
        A["efg"] = 100 * (A.fgm + 0.5 * A.tpm) / A.fga
        A["o_efg"] = 100 * (A.o_fgm + 0.5 * A.o_tpm) / A.o_fga
        A["fg3_pct"] = 100 * A.tpm / A.tpa.where(A.tpa > 0)
        A["o_fg3_pct"] = 100 * A.o_tpm / A.o_tpa.where(A.o_tpa > 0)
        A["ft_pct"] = 100 * A.ftm / A.fta.where(A.fta > 0)
        A["o_ft_pct"] = 100 * A.o_ftm / A.o_fta.where(A.o_fta > 0)
        A["orb_pct"] = 100 * A.oreb / (A.oreb + A.o_dreb)
        A["o_orb_pct"] = 100 * A.o_oreb / (A.o_oreb + A.dreb)
        A["tov_pct"] = 100 * A.tov / (A.fga + 0.44 * A.fta + A.tov)
        A["o_tov_pct"] = 100 * A.o_tov / (A.o_fga + 0.44 * A.o_fta + A.o_tov)
        A["ortg"] = 100 * A.pts / A.poss
        A["o_ortg"] = 100 * A.o_pts / A.poss
        sd = {k: float((A[k] - A["o_" + k]).std()) for _, _, k, _ in GAP_STATS}
        by = {(b["espn_id"], b["ha"]): b for b in bt}
        for gid in sorted({b["espn_id"] for b in bt}):
            aw, hm = by.get((gid, "away")), by.get((gid, "home"))
            if not aw or not hm:
                continue
            for i, (grp, label, k, direction) in enumerate(GAP_STATS):
                av, hv = aw.get(k), hm.get(k)
                if av is None or hv is None:
                    continue
                d = av - hv
                z = abs(d) / sd[k] if sd[k] and sd[k] == sd[k] else 0
                if direction == 0:
                    edge = aw["team"] if d > 0 else hm["team"] if d < 0 else ""
                else:
                    edge = aw["team"] if d * direction > 0 else hm["team"] if d * direction < 0 else ""
                is_pct = k.endswith("pct") or k in ("efg", "ortg")
                fmt = (lambda v: f"{v:.1f}") if is_pct else (lambda v: f"{v:.0f}")
                level = "Major" if z >= 1.5 else "Notable" if z >= 1.0 else ""
                game_gaps.append(dict(
                    game_id=gid, key=k, sort_order=GAP_GROUP_ORDER[grp] * 100 + i, grp=grp, stat=label,
                    away_code=aw["team"], home_code=hm["team"], away_val=float(av), home_val=float(hv),
                    away_txt=fmt(av), home_txt=fmt(hv), gap=float(abs(d)),
                    gap_txt=f"{abs(d):.1f}" if is_pct else f"{abs(d):.0f}",
                    edge=edge, edge_txt=(f"{edge} more" if direction == 0 and edge else edge or "Even"),
                    z=round(z, 2), sd=sd[k] if sd[k] == sd[k] else None, level=level, volume=direction == 0))

    # ---- results for every finished game: periods, overtime, leads, records entering, upsets
    rec_before = {}
    for t, g in G.groupby("team"):
        w = l = 0
        for _, r in g.iterrows():
            rec_before[(int(r.game_id), t)] = (w, l)
            w, l = (w + 1, l) if r.win else (w, l + 1)
    grow = {(int(r.game_id), r.team): r for _, r in G.iterrows()}
    results = {}
    for gid in sorted(set(T.game_id)):
        s = sched.get(gid)
        if s is None:
            continue
        if gid in period_map:
            aw_p, hm_p = [q[0] for q in period_map[gid]], [q[1] for q in period_map[gid]]
        else:
            aw_p, hm_p = periods_of(s.away_linescores), periods_of(s.home_linescores)
        a, h = s.away, s.home
        ar, hr = grow.get((gid, a)), grow.get((gid, h))
        if ar is None or hr is None:
            continue
        winner = a if ar.pts > hr.pts else h
        loser = h if winner == a else a
        wb, lb = rec_before[(gid, winner)], rec_before[(gid, loser)]
        wpct = wb[0] / sum(wb) if sum(wb) else 0.5
        lpct = lb[0] / sum(lb) if sum(lb) else 0.5
        results[gid] = dict(away_score=int(ar.pts), home_score=int(hr.pts), winner=winner, away_periods=aw_p,
                            home_periods=hm_p, ot=max(period_n.get(gid, len(aw_p)) - 4, 0),
                            lead_changes=int(ar.lead_changes), upset=bool(wpct < lpct and sum(wb) >= 2),
                            away_record_before="%d-%d" % rec_before[(gid, a)], home_record_before="%d-%d" % rec_before[(gid, h)])

    # ---- rest days for every game up to tonight (days since the team's previous game before that date)
    played_dates = {t: sorted(g.date.unique()) for t, g in G.groupby("team")}

    def rest_days(team: str, day: str):
        ds = played_dates.get(team) or []
        i = bisect.bisect_left(ds, day)
        if i == 0:
            return None
        return (dt.date.fromisoformat(day) - dt.date.fromisoformat(ds[i - 1])).days - 1

    # ---- games: the whole season schedule
    games = []
    for gid, s in sched.items():
        a, h = s.away, s.home
        if a not in CODES or h not in CODES:  # NBA Cup knockout placeholders (TBD) until the matchup is set
            continue
        res = results.get(gid)
        tip = _tip(s.date)
        status = str(s.status_type_name)
        row = dict(id=gid, season=int(s.season), season_type=int(s.season_type), game_date=s.game_date,
                   tip=tip.strftime("%Y-%m-%dT%H:%M:%SZ"), code=gcode[gid], away_code=a, home_code=h,
                   status=status, status_detail=_clean_value(s.get("status_type_detail")),
                   away_score=None, home_score=None, winner_code=None, away_periods=[], home_periods=[],
                   num_periods=int(periods.get(gid, 4)) if gid in have else None, ot=None, lead_changes=None,
                   tv=_tv(s.broadcast_name, s.broadcast_market),
                   broadcast_name=_clean_value(s.get("broadcast_name")), broadcast_market=_clean_value(s.get("broadcast_market")),
                   espn_away_record=records_of(s.away_records).get("total", ""),
                   espn_home_record=records_of(s.home_records).get("total", ""),
                   venue=_clean_value(s.get("venue_full_name")), city=_clean_value(s.get("venue_address_city")),
                   away_rest=None, home_rest=None, away_record_before=None, home_record_before=None, upset=None,
                   box_source=box_source.get(gid, "mirror") if gid in have else None)
        if res:
            row.update(away_score=res["away_score"], home_score=res["home_score"], winner_code=res["winner"],
                       away_periods=res["away_periods"], home_periods=res["home_periods"], ot=res["ot"],
                       lead_changes=res["lead_changes"], upset=res["upset"],
                       away_record_before=res["away_record_before"], home_record_before=res["home_record_before"])
        elif status == "STATUS_FINAL":
            row.update(away_score=as_int(s.away_score), home_score=as_int(s.home_score),
                       away_periods=periods_of(s.away_linescores), home_periods=periods_of(s.home_linescores))
        if s.game_date <= T0:
            row.update(away_rest=rest_days(a, s.game_date), home_rest=rest_days(h, s.game_date))
        games.append(row)
    games.sort(key=lambda g: (g["tip"], g["id"]))

    # ---- teams and players (reference rows)
    team_rows = {}
    for _, s in sc.iterrows():
        for side in ("away", "home"):
            t = s[side]
            if t in team_rows or t not in CODES:
                continue
            team_rows[t] = dict(code=t, espn_id=as_int(s[f"{side}_id"]), espn_code=str(s[f"{side}_abbreviation"]),
                                location=str(s[f"{side}_location"]), nickname=names.get(t, (t, t))[0],
                                display_name=names.get(t, (t, t))[1], conference=conference(t),
                                primary_color=hex_color(s[f"{side}_color"]),
                                secondary_color=hex_color(s[f"{side}_alternate_color"]))
    latest = {}
    for pg in sorted(player_games, key=lambda x: x["game_date"]):
        latest[pg["player_id"]] = pg
    players = [dict(id=pid, name=pg["name"], short_name=_clean_value(pg["_short"]), position=pg["position"],
                    jersey=_clean_value(pg["_jersey"]), team_code=pg["team_code"]) for pid, pg in latest.items()]
    for pg in player_games:
        pg.pop("_short"), pg.pop("_jersey"), pg.pop("_dnp")

    # ---- standings by record (official seeds can replace `seed` later)
    team_season = []
    if len(TS):
        st = TS[["team", "name", "conf", "w", "l"]].copy()
        st["pct"] = (st.w / (st.w + st.l)).round(3)
        st = st.sort_values(["conf", "pct", "w", "team"], ascending=[True, False, False, True])
        st["seed"] = st.groupby("conf").cumcount() + 1
        seeds = dict(zip(st.team, st.seed))
        for rec in TS.to_dict("records"):
            row = dict(season=season, team_code=rec["team"], as_of=T0)
            for k in ("gp", "w", "l", "home_rec", "road_rec", "streak", "l5_rec"):
                row[k] = _clean_value(rec[k])
            for k in TEAM_STAT_KEYS:
                row[k] = _clean_value(rec[k])
            for k in BETTER_HIGH + BETTER_LOW:
                row[k + "_rk"] = int(rec[k + "_rk"])
            row.update(record_seed=int(seeds[rec["team"]]), seed=int(seeds[rec["team"]]), seed_source="record")
            team_season.append(row)

    player_season = []
    for rec in (PS.to_dict("records") if len(PS) else []):
        player_season.append(dict(season=season, player_id=int(rec["player_id"]), team_code=rec["team"], as_of=T0,
                                  name=rec["player"], position=rec["pos"] if isinstance(rec["pos"], str) else "",
                                  **{k: _clean_value(rec[k]) for k in ("gp", "gs", "mpg", "ppg", "rpg", "orpg", "apg", "spg",
                                                                       "bpg", "tovpg", "pfpg", "fg_pct", "fg3m_pg", "fg3_pct",
                                                                       "ft_pct", "ts_pct", "pm_total", "pm_pg", "hi_pts",
                                                                       "team_mpg_rank")}))

    tonight = [g for g in games if g["game_date"] == T0]
    y_set = set(y_ids)
    meta.update(teams=len(TS), players=len(PS), box_rows=sum(1 for p in player_games if p["game_id"] in y_set),
                tonight=len(tonight), season_games=int(T.game_id.nunique()))
    return Build(today=today, yesterday=yday, season=season, meta=meta, teams=list(team_rows.values()), players=players,
                 games=games, team_games=team_games, player_games=player_games, team_season=team_season,
                 player_season=player_season, game_gaps=game_gaps, player_game_deltas=deltas)


def _team_box_extras(team_games: list[dict], tb: pd.DataFrame) -> None:
    """Team turnovers and technical/flagrant fouls, when the source has them (database only)."""
    cols = {"team_turnovers": "team_tov", "technical_fouls": "tech_fouls", "flagrant_fouls": "flagrant_fouls"}
    if not len(tb):
        return
    have = [c for c in cols if c in tb.columns]
    if not have:
        return
    lookup = {}
    for _, r in tb.iterrows():
        lookup[(int(r.game_id), code(r.team_abbreviation))] = {cols[c]: as_int(r.get(c)) for c in have}
    for row in team_games:
        row.update(lookup.get((row["game_id"], row["team_code"]), {}))


def now_et() -> dt.datetime:
    return dt.datetime.now(ET)
