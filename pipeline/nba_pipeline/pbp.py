"""Play-by-play: game flow, scoring runs, clutch time, five-man lineups and on/off.

Source: hoopR's `play_by_play_<season>.parquet` (ESPN's play-by-play, about 500 plays a game). The run reads the
file, computes the tables below, and stores only those. No raw play is ever written to Postgres.

- game_flow: the score after every scoring play (the "worm" chart), lead changes, ties, largest leads, how long
  each side led, and how long the game spent in clutch time.
- game_runs: unanswered scoring runs (12-0 and the like) with start and end times.
- lineup_games and lineup_season: five-man units with minutes, possessions and ratings.
- player_on_off: each player's team ratings with him on and off the floor, in the games he played.
- team_clutch and player_clutch: the last 5 minutes of the 4th quarter or overtime with the margin within 5.

Order: plays are sorted by `game_play_number`, which follows the game clock. `sequence_number` is ESPN's edit
order (a play corrected later gets a high number), so it is not used for ordering.

Who is on the floor comes from substitutions ("X enters the game for Y": athlete 1 enters, athlete 2 leaves).
The feed does not list the five players who start each period, so each team's period is read on its own: a player
named in a play, or leaving, before he enters was on the floor when the period began; period 1 takes the box
score's starters; a player who plays a whole period without a logged event is still on from the previous period.
ESPN sometimes keeps both the original and the corrected version of a substitution, or names the wrong player
leaving, so when the plain reading does not fit, other starting fives and fixes to the contradicting rows are tried
and the most consistent reading wins (a row that cannot apply costs 3, a dropped row 2, a corrected outgoing player 1,
a play naming a benched player 1). When readings tie, the one whose minutes come closest to the box score is kept.
Every stint has exactly five players a side.

Free throws count for the ten players on the floor when the foul happened, as in the box score's plus-minus.

Possessions use the same estimate as the rest of the app, per stint and per side: FGA - OREB + TOV + 0.44 x FTA,
averaged for the two teams. Missed end-of-quarter heaves are not field goal attempts, as in ESPN's box score.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations

import numpy as np
import pandas as pd

from nba_pipeline.config import REGULAR_SEASON
from nba_pipeline.util import r1

COLUMNS = ["game_id", "season_type", "game_date", "game_play_number", "type_id", "type_text", "period_number",
           "clock_minutes", "clock_seconds", "scoring_play", "score_value", "shooting_play", "points_attempted",
           "team_id", "athlete_id_1", "athlete_id_2", "athlete_id_3", "away_score", "home_score", "away_team_id",
           "home_team_id", "away_team_abbrev", "home_team_abbrev"]

SUBSTITUTION = 584
HEAVE = 282
OFFENSIVE_REBOUND = 156
DEFENSIVE_REBOUND = 155

# counting stats kept per stint and side, in this order
STATS = ["pts", "fga", "fgm", "tpa", "tpm", "fta", "ftm", "oreb", "dreb", "tov"]
PTS, FGA, FGM, TPA, TPM, FTA, FTM, OREB, DREB, TOV = range(len(STATS))

CLUTCH_SECONDS = 300  # the last 5 minutes of the 4th quarter or any overtime
CLUTCH_MARGIN = 5
RUN_MIN = 8  # runs of 8 or more unanswered points are kept (and each team's biggest run in every game)
SIDES = ("away", "home")


def period_length(p: int) -> int:
    return 720 if p <= 4 else 300


def period_start(p: int) -> int:
    """Elapsed game seconds when period p begins."""
    return 720 * (p - 1) if p <= 4 else 2880 + 300 * (p - 5)


def game_seconds(periods: int) -> int:
    return period_start(periods) + period_length(periods)


def clock_text(rem: float) -> str:
    """Seconds left in the period -> '7:45', or '24.6' under a minute (like the broadcast clock)."""
    if rem >= 60:
        s = int(round(rem))
        return f"{s // 60}:{s % 60:02d}"
    return f"{rem:.1f}"


# ------------------------------------------------------------------ reading and normalising


def read_plays(path) -> pd.DataFrame:
    return pd.read_parquet(path, columns=COLUMNS)


def _off_floor(type_text: pd.Series) -> pd.Series:
    """Technical fouls and ejections can name a player on the bench, so they never place anyone on the floor."""
    t = type_text.fillna("")
    return (t.str.contains("Technical") & ~t.str.startswith("Free Throw")) | (t == "Ejection")


def normalize(raw: pd.DataFrame) -> pd.DataFrame:
    """One row per play in game-clock order, with elapsed time, the acting side and counting-stat flags."""
    df = raw[raw.season_type == REGULAR_SEASON].copy()
    df["game_id"] = df.game_id.astype(int)
    df = df.sort_values(["game_id", "game_play_number"], kind="stable").reset_index(drop=True)
    p = df.period_number.astype(int).to_numpy()
    rem = (df.clock_minutes.fillna(0).astype(float) * 60 + df.clock_seconds.fillna(0).astype(float)).to_numpy()
    plen = np.where(p <= 4, 720, 300)
    rem = np.clip(rem, 0, plen)
    start = np.where(p <= 4, 720 * (p - 1), 2880 + 300 * (p - 5))
    text = df.type_text.fillna("")
    scoring = df.scoring_play.fillna(False).astype(bool)
    shooting = df.shooting_play.fillna(False).astype(bool)
    attempted = df.points_attempted.fillna(0).astype(int)
    type_id = df.type_id.fillna(-1).astype(int)
    heave_miss = (type_id == HEAVE) & ~scoring
    fga = shooting & attempted.isin([2, 3]) & ~heave_miss
    fta = text.str.startswith("Free Throw")
    has_a1 = df.athlete_id_1.notna()
    side = np.where(df.team_id == df.away_team_id, "away", np.where(df.team_id == df.home_team_id, "home", ""))
    out = pd.DataFrame({
        "game_id": df.game_id.to_numpy(),
        "n": df.game_play_number.astype(int).to_numpy(),
        "period": p,
        "rem": rem,
        "t": start + plen - rem,
        "type_id": type_id.to_numpy(),
        "side": side,
        "a1": df.athlete_id_1.fillna(0).astype("int64").to_numpy(),
        "a2": df.athlete_id_2.fillna(0).astype("int64").to_numpy(),
        "a3": df.athlete_id_3.fillna(0).astype("int64").to_numpy(),
        "sub": (type_id == SUBSTITUTION).to_numpy(),
        "foul": (text.str.contains("Foul") | (text.str.contains("Technical") & ~text.str.startswith("Free Throw"))).to_numpy(),
        "present": (~_off_floor(text) & (type_id != SUBSTITUTION)).to_numpy(),
        "pts": np.where(scoring, df.score_value.fillna(0).astype(int), 0),
        "fga": fga.to_numpy(),
        "fgm": (fga & scoring).to_numpy(),
        "tpa": (fga & (attempted == 3)).to_numpy(),
        "tpm": (fga & (attempted == 3) & scoring).to_numpy(),
        "fta": fta.to_numpy(),
        "ftm": (fta & scoring).to_numpy(),
        "oreb": ((type_id == OFFENSIVE_REBOUND) & has_a1).to_numpy(),
        "dreb": ((type_id == DEFENSIVE_REBOUND) & has_a1).to_numpy(),
        "tov": (((text.str.contains("Turnover") & ~text.str.startswith("No ")) | (text == "Traveling"))).to_numpy(),
        "away_score": df.away_score.fillna(0).astype(int).to_numpy(),
        "home_score": df.home_score.fillna(0).astype(int).to_numpy(),
    })
    # the score before each play decides whether the play is in clutch time
    out["away_before"] = out.groupby("game_id").away_score.shift(1, fill_value=0)
    out["home_before"] = out.groupby("game_id").home_score.shift(1, fill_value=0)
    out["clutch"] = (out.period >= 4) & (out.rem <= CLUTCH_SECONDS) & \
        ((out.away_before - out.home_before).abs() <= CLUTCH_MARGIN)
    return out


# ------------------------------------------------------------------ game flow and runs


def flow_of(plays: pd.DataFrame, periods: int) -> dict:
    """Score after every scoring play, plus lead changes, ties, largest leads and time leading."""
    sp = plays[plays.pts > 0]
    t = [float(round(x, 1)) for x in sp.t]
    away = [int(x) for x in sp.away_score]
    home = [int(x) for x in sp.home_score]
    end = float(game_seconds(periods))
    lead_changes = times_tied = 0
    last_leader = 0
    best = {"away": 0, "home": 0}
    secs = {"away": 0.0, "home": 0.0, "tied": 0.0}
    prev_t, prev_m = 0.0, 0
    for ti, a, h in zip(t, away, home):
        m = a - h
        secs["away" if prev_m > 0 else "home" if prev_m < 0 else "tied"] += ti - prev_t
        leader = (m > 0) - (m < 0)
        if leader == 0:
            times_tied += 1
        elif last_leader and leader != last_leader:
            lead_changes += 1
        if leader:
            last_leader = leader
        best["away"] = max(best["away"], m)
        best["home"] = max(best["home"], -m)
        prev_t, prev_m = ti, m
    secs["away" if prev_m > 0 else "home" if prev_m < 0 else "tied"] += end - prev_t
    return dict(t=t, away=away, home=home, lead_changes=lead_changes, times_tied=times_tied,
                away_largest_lead=best["away"], home_largest_lead=best["home"], away_lead_secs=r1(secs["away"]),
                home_lead_secs=r1(secs["home"]), tied_secs=r1(secs["tied"]))


def runs_of(plays: pd.DataFrame, min_pts: int = RUN_MIN) -> list[dict]:
    """Unanswered runs: consecutive points by one side until the other side scores. Keeps runs of `min_pts` or
    more, and each side's biggest run (the first one when tied) even when it is smaller."""
    sp = plays[plays.pts > 0]
    runs: list[dict] = []
    cur = None
    for r in sp.itertuples(index=False):
        if cur is None or r.side != cur["side"]:
            if cur is not None:
                runs.append(cur)
            cur = dict(side=r.side, pts=0, plays=0, start_t=float(r.t), start_period=int(r.period), start_rem=float(r.rem),
                       away_before=int(r.away_before), home_before=int(r.home_before))
        cur["pts"] += int(r.pts)
        cur["plays"] += 1
        cur.update(end_t=float(r.t), end_period=int(r.period), end_rem=float(r.rem), away_after=int(r.away_score),
                   home_after=int(r.home_score))
    if cur is not None:
        runs.append(cur)
    keep = []
    for s in SIDES:
        mine = [x for x in runs if x["side"] == s]
        top = max(mine, key=lambda x: x["pts"], default=None)
        for x in mine:
            x["biggest"] = x is top
        keep += [x for x in mine if x["pts"] >= min_pts or x is top]
    keep.sort(key=lambda x: x["start_t"])
    return keep


def clutch_segments(plays: pd.DataFrame, periods: int) -> list[tuple[float, float]]:
    """Time intervals in clutch: inside the last 5 minutes of the 4th or any overtime, margin within 5."""
    windows = [(period_start(p) + period_length(p) - CLUTCH_SECONDS, period_start(p) + period_length(p))
               for p in range(4, periods + 1)]
    sp = plays[plays.pts > 0]
    changes = [(0.0, 0)] + [(float(t), int(a) - int(h)) for t, a, h in zip(sp.t, sp.away_score, sp.home_score)]
    out = []
    for w0, w1 in windows:
        for i, (t0, m) in enumerate(changes):
            t1 = changes[i + 1][0] if i + 1 < len(changes) else float("inf")
            a, b = max(t0, w0), min(t1, w1)
            if b > a and abs(m) <= CLUTCH_MARGIN:
                if out and abs(out[-1][1] - a) < 1e-9:
                    out[-1] = (out[-1][0], b)
                else:
                    out.append((a, b))
    return out


def overlap(a0: float, a1: float, segs: list[tuple[float, float]]) -> float:
    return sum(max(0.0, min(a1, b1) - max(a0, b0)) for b0, b1 in segs)


# ------------------------------------------------------------------ who is on the floor


@dataclass
class Stint:
    """A stretch of play with the same ten players, and each side's counting stats during it."""
    period: int
    start: float
    end: float
    lineup: dict[str, tuple[int, ...]]
    box: dict[str, np.ndarray] = field(default_factory=lambda: {s: np.zeros(len(STATS), dtype=int) for s in SIDES})
    clutch_box: dict[str, np.ndarray] = field(default_factory=lambda: {s: np.zeros(len(STATS), dtype=int) for s in SIDES})
    clutch_secs: float = 0.0
    events: int = 0

    @property
    def secs(self) -> float:
        return self.end - self.start


@dataclass
class SidePlan:
    """One reading of a period for one team: the five who started it and the substitution rows applied."""
    start: frozenset
    subs: dict  # row index -> (player in, player out)
    score: int  # 3 per row that cannot apply, 2 per row dropped, 1 per row whose outgoing player is replaced,
    # 1 per play naming a benched player
    secs: dict  # player -> seconds on the floor in the period
    end: frozenset
    dropped: frozenset
    blind: frozenset = frozenset()  # rows whose outgoing player was wrong and is worked out instead

    def key(self) -> tuple:
        return (tuple(sorted(self.start)), tuple(sorted(self.subs.items())))


@dataclass
class Rebuild:
    stints: list[Stint]
    issues: list[str]
    repaired: int = 0  # team-periods where the plain reading did not fit and another one was chosen
    tie_breaks: int = 0  # team-periods where box minutes chose between equally consistent readings
    off_floor: int = 0  # plays naming a player the chosen lineup has on the bench


def _named(r) -> tuple[int, ...]:
    return tuple(a for a in (r.a1, r.a2, r.a3) if a)


def _sub_side(r, roster: dict[int, str]) -> str:
    return roster.get(r.a1) or roster.get(r.a2) or r.side


def first_seen(rows: list, side: str, roster: dict[int, str], drop: frozenset = frozenset()) -> tuple[list[int], set[int]]:
    """Players of one side on the floor when a period began, in order: anyone named in a play, or leaving the game,
    before entering it. Also returns every player of that side mentioned in the period."""
    seen: set[int] = set()
    starters: list[int] = []
    for i, r in enumerate(rows):
        if r.sub:
            if i in drop or _sub_side(r, roster) != side:
                continue
            if r.a2 and r.a2 not in seen:
                starters.append(r.a2)
            seen.update(a for a in (r.a1, r.a2) if a)
        elif r.present:
            for a in _named(r):
                if roster.get(a) == side and a not in seen:
                    starters.append(a)
                    seen.add(a)
    return starters, seen


def _who_leaves(rows: list, i: int, on: set[int], side: str, roster: dict[int, str]) -> int:
    """For a substitution row that names no outgoing player: the player on the floor whose next mention is coming
    back in, else one never mentioned again, else the one mentioned last."""
    best, best_key = 0, None
    for a in sorted(on):
        key = (1, 0)  # never mentioned again
        for j in range(i + 1, len(rows)):
            r = rows[j]
            if r.sub and _sub_side(r, roster) == side and a in (r.a1, r.a2):
                key = (2, 0) if r.a1 == a else (0, j)
                break
            if not r.sub and r.present and a in _named(r):
                key = (0, j)
                break
        if best_key is None or key > best_key:
            best, best_key = a, key
    return best


def plan_side(rows: list, side: str, roster: dict[int, str], start, drop: frozenset, p0: float, p1: float,
              blind: frozenset = frozenset()) -> SidePlan:
    """Play a period forward for one team from a starting five, skipping rows that cannot apply. Rows in `drop` are
    left out; rows in `blind` keep the player coming in but work out who left (ESPN sometimes names the wrong one)."""
    on = set(start)
    score = 2 * len(drop) + len(blind)
    subs: dict[int, tuple[int, int]] = {}
    secs: dict[int, float] = defaultdict(float)
    last = p0
    for i, r in enumerate(rows):
        if r.sub:
            if i in drop or _sub_side(r, roster) != side:
                continue
            a_in, a_out = r.a1, (0 if i in blind else r.a2) or _who_leaves(rows, i, on, side, roster)
            if not a_in or a_out not in on or a_in in on:
                score += 3
                continue
            for a in on:
                secs[a] += r.t - last
            last = r.t
            on.discard(a_out)
            on.add(a_in)
            subs[i] = (a_in, a_out)
        elif r.present:
            score += sum(1 for a in _named(r) if roster.get(a) == side and a not in on)
    for a in on:
        secs[a] += p1 - last
    return SidePlan(frozenset(start), subs, score, dict(secs), frozenset(on), drop, blind)


def conflict_rows(rows: list, side: str, roster: dict[int, str]) -> list[int]:
    """Substitution rows that contradict another row for the same player: entering twice, or leaving twice, in a row
    (ESPN sometimes keeps both the original and the corrected version of a substitution)."""
    last: dict[int, tuple[str, int]] = {}
    bad: set[int] = set()
    for i, r in enumerate(rows):
        if not r.sub or _sub_side(r, roster) != side:
            continue
        for a, kind in ((r.a1, "in"), (r.a2, "out")):
            if not a:
                continue
            if a in last and last[a][0] == kind:
                bad.update((last[a][1], i))
            last[a] = (kind, i)
    return sorted(bad)


def side_candidates(rows: list, side: str, roster: dict[int, str], p: int, box_start: list[int], carry: frozenset,
                    box_minutes: dict[int, float], p0: float, p1: float) -> tuple[list[SidePlan], bool]:
    """The most consistent readings of a period for one team (several when they tie), and whether the plain reading
    (first appearances, every row applied) had to be replaced."""
    named, seen = first_seen(rows, side, roster)
    fixed = list(box_start) if p == 1 and len(box_start) == 5 else None
    base = list(fixed or named)
    if len(base) < 5:  # a player can play a whole period without a logged event: still on from the last period
        silent = [a for a in carry if a not in seen]
        if len(silent) == 5 - len(base):
            base += silent
    if len(base) == 5:
        plain = plan_side(rows, side, roster, base, frozenset(), p0, p1)
        if plain.score == 0:
            return [plain], False
    pool = list(dict.fromkeys(named + sorted(a for a in carry if a not in named)))
    if len(pool) < 5:
        bench = sorted((a for a, sd in roster.items() if sd == side and a not in pool and a not in seen
                        and box_minutes.get(a, 0) > 0), key=lambda a: -box_minutes.get(a, 0))
        pool += bench[:5 - len(pool) + 2]
    pool = pool[:9]
    # fixes to try on contradicting rows: drop one or two, or replace one's outgoing player
    conflicts = conflict_rows(rows, side, roster)
    fixes = [(frozenset(), frozenset())]
    fixes += [(frozenset([c]), frozenset()) for c in conflicts] + [(frozenset(), frozenset([c])) for c in conflicts]
    if len(conflicts) <= 6:
        for a, b in combinations(conflicts, 2):
            fixes += [(frozenset([a, b]), frozenset()), (frozenset([a]), frozenset([b])), (frozenset([b]), frozenset([a])),
                      (frozenset(), frozenset([a, b]))]
    starts = [tuple(fixed)] if fixed else list(combinations(pool, 5))
    best: list[SidePlan] = []
    for d, bl in fixes:
        for st in starts:
            plan = plan_side(rows, side, roster, st, d, p0, p1, bl)
            if not best or plan.score < best[0].score:
                best = [plan]
            elif plan.score == best[0].score and plan.key() not in {b.key() for b in best}:
                best.append(plan)
    if not best:  # fewer than five players known at all: the plain reading is all there is
        return [plan_side(rows, side, roster, base, frozenset(), p0, p1)], True
    return best, True


def _minutes_error(plan: SidePlan, other: dict[int, float], box_minutes: dict[int, float], side_players: list[int]) -> float:
    return sum(abs((other.get(a, 0.0) + plan.secs.get(a, 0.0)) / 60 - box_minutes.get(a, 0.0)) for a in side_players)


def rebuild_game(plays: pd.DataFrame, periods: int, roster: dict[int, str], box_starters: dict[str, list[int]],
                 box_minutes: dict[int, float], clutch: list[tuple[float, float]]) -> Rebuild:
    """Stints for one game. Each team and period is read on its own: the starting five and the substitution rows
    that fit the play-by-play best; when two readings fit equally well, the one closer to the box score's minutes."""
    issues: list[str] = []
    by_period = {p: list(g.itertuples(index=False)) for p, g in plays.groupby("period", sort=True)}
    cands: dict[tuple[int, str], list[SidePlan]] = {}
    choice: dict[tuple[int, str], SidePlan] = {}
    repaired = 0
    for p in range(1, periods + 1):
        rows = by_period.get(p, [])
        p0, p1 = float(period_start(p)), float(period_start(p) + period_length(p))
        for s in SIDES:
            carry = choice[(p - 1, s)].end if p > 1 else frozenset()
            plans, changed = side_candidates(rows, s, roster, p, box_starters.get(s, []), carry, box_minutes, p0, p1)
            cands[(p, s)] = plans
            choice[(p, s)] = plans[0]
            repaired += changed
    # equally consistent readings: keep the one whose minutes come closest to the box score
    side_players = {s: [a for a, sd in roster.items() if sd == s] for s in SIDES}
    for _ in range(2):
        for (p, s), plans in cands.items():
            if len(plans) < 2:
                continue
            other: dict[int, float] = defaultdict(float)
            for (q, t), c in choice.items():
                if t == s and q != p:
                    for a, x in c.secs.items():
                        other[a] += x
            choice[(p, s)] = min(plans, key=lambda c: _minutes_error(c, other, box_minutes, side_players[s]))
    tie_breaks = sum(1 for v in cands.values() if len(v) > 1)
    stints: list[Stint] = []
    off_floor = 0
    for p in range(1, periods + 1):
        rows = by_period.get(p, [])
        plans = {s: choice[(p, s)] for s in SIDES}
        for s in SIDES:
            if plans[s].score:
                issues.append(f"P{p} {s}: reading scored {plans[s].score}, rows dropped {sorted(plans[s].dropped)}, "
                              f"outgoing player replaced {sorted(plans[s].blind)}")
        got, off = _stints(rows, p, plans, roster)
        stints += got
        off_floor += off
    for st in stints:
        st.clutch_secs = overlap(st.start, st.end, clutch)
    return Rebuild(stints, issues, repaired, tie_breaks, off_floor)


def _stints(rows: list, p: int, plans: dict[str, SidePlan], roster: dict[int, str]) -> tuple[list[Stint], int]:
    """Walk a period with the chosen readings, closing a stint at every substitution and crediting each play."""
    p0, p1 = float(period_start(p)), float(period_start(p) + period_length(p))
    on = {s: set(plans[s].start) for s in SIDES}
    cur = Stint(p, p0, p0, {s: tuple(sorted(on[s])) for s in SIDES})
    out: list[Stint] = []
    off_floor = 0
    foul_rem, foul_stint = None, cur
    for i, r in enumerate(rows):
        if r.foul:
            foul_rem, foul_stint = r.rem, cur
        if r.sub:
            for s in SIDES:
                if i not in plans[s].subs:
                    continue
                a_in, a_out = plans[s].subs[i]
                if r.t > cur.start or cur.events:
                    cur.end = float(r.t)
                    out.append(cur)
                    cur = Stint(p, float(r.t), float(r.t), {})
                on[s].discard(a_out)
                on[s].add(a_in)
                cur.lineup = {x: tuple(sorted(on[x])) for x in SIDES}
            continue
        if r.present:
            off_floor += sum(1 for a in _named(r) if roster.get(a) and a not in on[roster[a]])
        if not r.side:
            continue
        vals = np.array([r.pts, r.fga, r.fgm, r.tpa, r.tpm, r.fta, r.ftm, r.oreb, r.dreb, r.tov], dtype=int)
        if vals.any():
            # free throws count for the ten players on the floor at the foul, as in the box score's plus-minus
            st = foul_stint if (r.fta and foul_rem == r.rem) else cur
            st.box[r.side] += vals
            if r.clutch:
                st.clutch_box[r.side] += vals
            st.events += 1
    cur.end = p1
    out.append(cur)
    return out, off_floor


# ------------------------------------------------------------------ the season build

OTHER = {"away": "home", "home": "away"}
SHOT_KEYS = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]


def possessions(own: np.ndarray, opp: np.ndarray) -> float:
    """The app's estimate, FGA - OREB + TOV + 0.44 x FTA, averaged for the two sides."""
    def one(b):
        return b[FGA] - b[OREB] + b[TOV] + 0.44 * b[FTA]
    return (one(own) + one(opp)) / 2


@dataclass
class Acc:
    """Seconds and both sides' counting stats, summed over stints."""
    secs: float = 0.0
    own: np.ndarray = field(default_factory=lambda: np.zeros(len(STATS), dtype=np.int64))
    opp: np.ndarray = field(default_factory=lambda: np.zeros(len(STATS), dtype=np.int64))
    games: set = field(default_factory=set)

    def add(self, secs: float, own: np.ndarray, opp: np.ndarray, game: int | None = None) -> None:
        self.secs += secs
        self.own += own
        self.opp += opp
        if game is not None:
            self.games.add(game)

    def minus(self, other: Acc) -> Acc:
        return Acc(self.secs - other.secs, self.own - other.own, self.opp - other.opp)

    @property
    def poss(self) -> float:
        return possessions(self.own, self.opp)

    def net_raw(self) -> float | None:
        p = self.poss
        return 100 * (int(self.own[PTS]) - int(self.opp[PTS])) / p if p > 0 else None

    def row(self, prefix: str = "") -> dict:
        pts, opp, poss = int(self.own[PTS]), int(self.opp[PTS]), self.poss
        ok = poss > 0
        return {f"{prefix}secs": r1(self.secs), f"{prefix}poss": r1(poss), f"{prefix}pts": pts, f"{prefix}opp_pts": opp,
                f"{prefix}ortg": r1(100 * pts / poss) if ok else None, f"{prefix}drtg": r1(100 * opp / poss) if ok else None,
                f"{prefix}net": r1(100 * (pts - opp) / poss) if ok else None}


@dataclass
class PbpBuild:
    season: int
    as_of: str
    game_flow: list[dict] = field(default_factory=list)
    game_runs: list[dict] = field(default_factory=list)
    lineup_games: list[dict] = field(default_factory=list)
    lineup_season: list[dict] = field(default_factory=list)
    player_on_off: list[dict] = field(default_factory=list)
    team_clutch: list[dict] = field(default_factory=list)
    player_clutch: list[dict] = field(default_factory=list)
    checks: dict = field(default_factory=dict)


def _pct(m, a):
    return r1(100 * m / a) if a else None


def lineup_id(players) -> str:
    return "-".join(str(a) for a in sorted(players))


def compute_pbp(raw: pd.DataFrame, build) -> PbpBuild:
    """Everything the play-by-play gives for the season so far, from the plays and the box-score build."""
    from nba_pipeline.teams import code as team_code
    t0 = build.today.isoformat()
    out = PbpBuild(season=build.season, as_of=t0)
    raw = raw[(raw.season_type == REGULAR_SEASON) & (raw.game_date.astype(str) < t0)]
    plays = normalize(raw)
    by_game = {int(g): df for g, df in plays.groupby("game_id", sort=True)}
    sides_of = raw.drop_duplicates("game_id").set_index("game_id")[["away_team_abbrev", "home_team_abbrev"]]
    games = {g["id"]: g for g in build.games}
    tg = {(r["game_id"], r["team_code"]): r for r in build.team_games}
    roster_rows: dict[int, list[dict]] = defaultdict(list)
    for r in build.player_games:
        roster_rows[r["game_id"]].append(r)

    lineups: dict[tuple[str, tuple], Acc] = defaultdict(Acc)
    on: dict[tuple[int, str], Acc] = defaultdict(Acc)
    played: dict[tuple[int, str], Acc] = defaultdict(Acc)
    team_cl: dict[str, Acc] = defaultdict(Acc)
    team_cl_wl: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    team_cl_shots: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(len(SHOT_KEYS), dtype=np.int64))
    player_cl: dict[tuple[int, str], Acc] = defaultdict(Acc)
    player_cl_shots: dict[tuple[int, str], np.ndarray] = defaultdict(lambda: np.zeros(len(SHOT_KEYS), dtype=np.int64))
    ck = dict(games=0, no_pbp=[], wrong_teams=[], score_mismatch=[], player_games=0, minutes_off=[], pm_checked=0,
              pm_off=0, lineup_minutes_bad=[], lead_changes_checked=0, lead_changes_off=[],
              largest_lead_checked=0, largest_lead_off=[], poss_gap_max=0.0,
              repaired=0, tie_breaks=0, off_floor=0, stints=0, not_in_box=[])
    known = {int(r["id"]) for r in build.players}

    for gid in sorted({r["game_id"] for r in build.team_games}):
        g = games.get(gid)
        if g is None:
            continue
        pl = by_game.get(gid)
        if pl is None:
            ck["no_pbp"].append(gid)
            continue
        code = {"away": g["away_code"], "home": g["home_code"]}
        ab = sides_of.loc[gid]
        if team_code(ab.away_team_abbrev) != code["away"] or team_code(ab.home_team_abbrev) != code["home"]:
            ck["wrong_teams"].append(gid)
            continue
        box = {s: tg.get((gid, code[s])) for s in SIDES}
        if box["away"] is None or box["home"] is None:
            continue
        last = pl.iloc[-1]
        if int(last.away_score) != box["away"]["pts"] or int(last.home_score) != box["home"]["pts"]:
            ck["score_mismatch"].append(gid)
            continue
        ck["games"] += 1
        periods = max(int(box["away"]["num_periods"]), int(pl.period.max()))
        roster: dict[int, str] = {}
        starters: dict[str, list[int]] = {s: [] for s in SIDES}
        box_min: dict[int, float] = {}
        box_pm: dict[int, int | None] = {}
        for r in roster_rows[gid]:
            pid, side = int(r["player_id"]), ("home" if r["home_away"] == "home" else "away")
            roster[pid] = side
            if r["starter"] and not r["did_not_play"]:
                starters[side].append(pid)
            box_min[pid] = float(r["min"] or 0)
            box_pm[pid] = r["plus_minus"]
        # ESPN's box score sometimes leaves out a player the play-by-play has on the floor: take his team from the plays
        missing = set()
        for r in pl[(pl["sub"] | pl.present) & (pl.side != "")].itertuples(index=False):
            for a in ((r.a1, r.a2) if r.sub else (r.a1,)):
                if a and a not in roster:
                    roster[a] = r.side
                    missing.add(a)
        segs = clutch_segments(pl, periods)
        rb = rebuild_game(pl, periods, roster, starters, box_min, segs)
        ck["repaired"] += rb.repaired
        ck["tie_breaks"] += rb.tie_breaks
        ck["off_floor"] += rb.off_floor
        ck["stints"] += len(rb.stints)

        game_lineups: dict[tuple[str, tuple], Acc] = defaultdict(Acc)
        team_game = {s: Acc() for s in SIDES}
        clutch_game = {s: Acc() for s in SIDES}
        on_game: dict[int, Acc] = defaultdict(Acc)
        cl_game: dict[int, Acc] = defaultdict(Acc)
        for st in rb.stints:
            for s in SIDES:
                own, opp = st.box[s], st.box[OTHER[s]]
                game_lineups[(s, st.lineup[s])].add(st.secs, own, opp)
                team_game[s].add(st.secs, own, opp)
                cown, copp = st.clutch_box[s], st.clutch_box[OTHER[s]]
                clutch_game[s].add(st.clutch_secs, cown, copp)
                for pid in st.lineup[s]:
                    on_game[pid].add(st.secs, own, opp)
                    if st.clutch_secs > 0 or cown.any() or copp.any():
                        cl_game[pid].add(st.clutch_secs, cown, copp)

        # checks against the box score
        full = game_seconds(periods)
        for s in SIDES:
            lineup_secs = sum(a.secs for (sd, _), a in game_lineups.items() if sd == s)
            player_secs = sum(a.secs for pid, a in on_game.items() if roster.get(pid) == s)
            if abs(lineup_secs - full) > 0.01 or abs(player_secs - 5 * full) > 0.05:
                ck["lineup_minutes_bad"].append((gid, code[s], round(lineup_secs, 1), round(player_secs / 60, 1)))
            ck["poss_gap_max"] = max(ck["poss_gap_max"], abs(team_game[s].poss - float(box[s]["poss"] or 0)))
        for pid in roster:
            ours = on_game[pid].secs / 60 if pid in on_game else 0.0
            if pid in missing:
                if ours > 0:
                    ck["not_in_box"].append((gid, pid, round(ours, 2)))
                continue
            if box_min.get(pid, 0) > 0 or ours > 0:
                ck["player_games"] += 1
                if abs(ours - box_min.get(pid, 0)) > 1:
                    ck["minutes_off"].append((gid, pid, box_min.get(pid, 0), round(ours, 2)))
                if box_pm.get(pid) is not None:
                    ck["pm_checked"] += 1
                    a = on_game.get(pid)
                    pm = int(a.own[PTS] - a.opp[PTS]) if a else 0
                    ck["pm_off"] += pm != box_pm[pid]
        fl = flow_of(pl, periods)
        # against ESPN's box score, where it has a number (the engine stores a blank as 0)
        if box["away"]["lead_changes"]:
            ck["lead_changes_checked"] += 1
            if box["away"]["lead_changes"] != fl["lead_changes"]:
                ck["lead_changes_off"].append((gid, box["away"]["lead_changes"], fl["lead_changes"]))
        for s in SIDES:
            if box[s]["largest_lead"]:
                ck["largest_lead_checked"] += 1
                if box[s]["largest_lead"] != fl[f"{s}_largest_lead"]:
                    ck["largest_lead_off"].append((gid, code[s], box[s]["largest_lead"], fl[f"{s}_largest_lead"]))

        # per-game rows
        minutes_off = sum(1 for x in ck["minutes_off"] if x[0] == gid)
        out.game_flow.append(dict(game_id=gid, num_periods=periods, **fl, clutch_secs=r1(sum(b - a for a, b in segs)),
                                  stints=len(rb.stints), lineup_repairs=rb.repaired, minutes_off=minutes_off))
        for i, run in enumerate(runs_of(pl)):
            out.game_runs.append(dict(
                game_id=gid, seq=i, team_code=code[run["side"]], pts=run["pts"], plays=run["plays"],
                start_t=r1(run["start_t"]), end_t=r1(run["end_t"]), start_period=run["start_period"],
                start_clock=clock_text(run["start_rem"]), end_period=run["end_period"], end_clock=clock_text(run["end_rem"]),
                away_before=run["away_before"], home_before=run["home_before"], away_after=run["away_after"],
                home_after=run["home_after"], biggest=run["biggest"]))
        for (s, key), a in sorted(game_lineups.items(), key=lambda kv: (kv[0][0], -kv[1].secs)):
            row = a.row()
            out.lineup_games.append(dict(game_id=gid, team_code=code[s], lineup_id=lineup_id(key), player_ids=list(key),
                                         secs=row["secs"], poss=row["poss"], pts=row["pts"], opp_pts=row["opp_pts"]))
            lineups[(code[s], key)].add(a.secs, a.own, a.opp, gid)

        # season sums: on and off the floor, clutch
        for pid, a in on_game.items():
            if a.secs <= 0:
                continue
            side = roster[pid]
            on[(pid, code[side])].add(a.secs, a.own, a.opp, gid)
            t = team_game[side]
            played[(pid, code[side])].add(t.secs, t.own, t.opp, gid)
        clutch = sum(b - a for a, b in segs) > 0
        for s in SIDES:
            if clutch:
                c = clutch_game[s]
                team_cl[code[s]].add(c.secs, c.own, c.opp, gid)
                team_cl_wl[code[s]][0 if box[s]["win"] else 1] += 1
        for pid, a in cl_game.items():
            player_cl[(pid, code[roster[pid]])].add(a.secs, a.own, a.opp, gid if a.secs > 0 else None)
        shots = pl[pl.clutch & (pl.fga | pl.fta) & (pl.a1 != 0)]
        for r in shots.itertuples(index=False):
            side = roster.get(int(r.a1))
            if side is None:
                continue
            vec = np.array([r.pts, r.fgm, r.fga, r.tpm, r.tpa, r.ftm, r.fta], dtype=np.int64)
            player_cl_shots[(int(r.a1), code[side])] += vec
            team_cl_shots[code[side]] += vec

    # season rows
    for (team, key), a in lineups.items():
        out.lineup_season.append(dict(season=out.season, team_code=team, lineup_id=lineup_id(key), player_ids=list(key),
                                      as_of=t0, games=len(a.games), **a.row()))
    for (pid, team), a in on.items():
        if pid not in known:
            continue
        off = played[(pid, team)].minus(a)
        on_net, off_net = a.net_raw(), off.net_raw()
        out.player_on_off.append(dict(
            season=out.season, player_id=pid, team_code=team, as_of=t0, games=len(a.games), **a.row("on_"),
            **off.row("off_"), on_off=r1(on_net - off_net) if on_net is not None and off_net is not None else None,
            pm=int(a.own[PTS] - a.opp[PTS])))
    for team, a in team_cl.items():
        sh = dict(zip(SHOT_KEYS, (int(x) for x in team_cl_shots[team])))
        w, l = team_cl_wl[team]
        row = a.row()
        out.team_clutch.append(dict(season=out.season, team_code=team, as_of=t0, games=len(a.games), w=w, l=l, **row,
                                    pm=row["pts"] - row["opp_pts"], fgm=sh["fgm"], fga=sh["fga"], fg_pct=_pct(sh["fgm"], sh["fga"]),
                                    tpm=sh["tpm"], tpa=sh["tpa"], ftm=sh["ftm"], fta=sh["fta"]))
    for key in sorted(set(player_cl) | set(player_cl_shots)):
        if key[0] not in known:
            continue
        a = player_cl.get(key, Acc())
        sh = dict(zip(SHOT_KEYS, (int(x) for x in player_cl_shots.get(key, np.zeros(len(SHOT_KEYS), dtype=np.int64)))))
        team_row = a.row()
        out.player_clutch.append(dict(
            season=out.season, player_id=key[0], team_code=key[1], as_of=t0, games=len(a.games), secs=team_row["secs"],
            pts=sh["pts"], fgm=sh["fgm"], fga=sh["fga"], fg_pct=_pct(sh["fgm"], sh["fga"]), tpm=sh["tpm"], tpa=sh["tpa"],
            ftm=sh["ftm"], fta=sh["fta"], pm=team_row["pts"] - team_row["opp_pts"], poss=team_row["poss"],
            ortg=team_row["ortg"], drtg=team_row["drtg"], net=team_row["net"]))
    ck["poss_gap_max"] = round(ck["poss_gap_max"], 2)
    out.checks = ck
    return out


PREFIX = "play-by-play: "


def pbp_checks(pb: PbpBuild) -> tuple[list[str], list[str]]:
    """Errors are bugs (the five-man lineups must cover every second); warnings are gaps in ESPN's data.
    Every message starts with "play-by-play: " so a run's notes show which step wrote it."""
    ck = pb.checks
    errs, warns = [], []
    for gid, team, secs, player_minutes in ck["lineup_minutes_bad"]:
        errs.append(f"lineup minutes do not add up for {team} in game {gid}: {secs / 60:.1f} lineup minutes, "
                    f"{player_minutes} player minutes")
    if ck["no_pbp"]:
        warns.append(f"no play-by-play yet for {len(ck['no_pbp'])} finished games: {ck['no_pbp'][:10]}")
    if ck["score_mismatch"]:
        warns.append(f"final score differs from the box score, game left out: {ck['score_mismatch']}")
    if ck["wrong_teams"]:
        warns.append(f"home and road teams differ from the schedule, game left out: {ck['wrong_teams']}")
    off = ck["minutes_off"]
    if off:
        games = sorted({x[0] for x in off})
        warns.append(f"{len(off)} of {ck['player_games']} player-games differ from box-score minutes by more than a "
                     f"minute (ESPN's play-by-play misses substitutions in games {games})")
    if ck["not_in_box"]:
        warns.append(f"{len(ck['not_in_box'])} player-games are in the play-by-play but not in ESPN's box score")
    if ck["lead_changes_off"]:
        warns.append(f"lead changes differ from ESPN's box score in {len(ck['lead_changes_off'])} of "
                     f"{ck['lead_changes_checked']} games: {ck['lead_changes_off'][:5]}")
    if ck["largest_lead_off"]:
        warns.append(f"largest leads differ from ESPN's box score for {len(ck['largest_lead_off'])} of "
                     f"{ck['largest_lead_checked']} teams: {ck['largest_lead_off'][:5]}")
    if ck["pm_checked"] and ck["pm_off"] / ck["pm_checked"] > 0.05:
        warns.append(f"plus-minus differs from the box score in {ck['pm_off']} of {ck['pm_checked']} player-games")
    return [PREFIX + e for e in errs], [PREFIX + w for w in warns]
