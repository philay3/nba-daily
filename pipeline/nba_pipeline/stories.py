"""Story finder: ranked story ideas for every game night of the season, from the box scores.

For each night it looks at the players and teams who played and finds:

- outliers: a line far from the player's own season average before that night (z-score for points, rebounds,
  assists, threes, plus-minus and true shooting);
- streaks: consecutive games played with 20+ points, a double-double, or 3+ threes, still alive after that night;
- firsts: the first 20, 30 or 40-point game, double-double, triple-double, 10-rebound, 10-assist or 5-three game of
  his season (he must have played 3 games before, and no earlier game may have it);
- rare lines: 30-10-10, 20-20, 40 points, a triple-double, 8 threes, rare by how often the league has done it;
- team swings: a team's net rating over its last games against its earlier games.

Every story gets a rarity (a z-score, or the z-score of a probability) and is weighted by how prominent the player
is (minutes and usage). The top 20 of each night are kept with the numbers behind them. Nothing looks ahead: a
night's baselines, league rates and "firsts" use games before that night only (streaks and prominence include the
night itself, which is already played).

Also kept: each player's current baselines (season and last 10 games, mean and standard deviation).
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from statistics import NormalDist

from nba_pipeline.compute import Build

TOP_N = 20
Z_FLAG = 2.0  # outliers and team swings need |z| of at least this
RARITY_CAP = 5.0
MIN_GAMES_BEFORE = 4  # games played before the night, for an outlier
FIRST_MIN_GAMES = 3  # games played before the night, for a "first this season"
STREAK_MIN = 3
L10 = 10
PRIOR_GAMES = 5  # weight of the league rate when estimating a player's own rate of an event
TEAM_PROMINENCE = 0.75
TEAM_MIN_GAMES = 6
TS_MIN_ATTEMPTS = 5.0  # true shooting attempts for a game to count in the true shooting baseline

# key -> (label, sd floor). The floor keeps a tiny early-season spread from turning ordinary nights into outliers.
STATS = {
    "pts": ("points", 4.0),
    "reb": ("rebounds", 2.0),
    "ast": ("assists", 1.5),
    "tpm": ("threes", 1.0),
    "plus_minus": ("plus-minus", 6.0),
    "ts_pct": ("true shooting", 8.0),
}

KINDS = {"outlier": "Outlier", "streak": "Streak", "first": "First this season", "rare": "Rare line", "team": "Team swing"}


def _dd_count(r: dict) -> int:
    return sum(1 for k in ("pts", "reb", "ast", "stl", "blk") if (r.get(k) or 0) >= 10)


# events for streaks: key -> (test, plural phrase)
STREAKS = {
    "pts20": (lambda r: r["pts"] >= 20, "straight games with 20 or more points"),
    "dd": (lambda r: _dd_count(r) >= 2, "straight double-doubles"),
    "tpm3": (lambda r: r["tpm"] >= 3, "straight games with 3 or more threes"),
}

# "first this season" events, by family: only the highest first in a family is claimed on one night.
# key -> (family, tier, test, phrase, stat for a single-stat threshold or None, threshold)
FIRSTS = {
    "pts20": ("pts", 1, lambda r: r["pts"] >= 20, "20-point game", "pts", 20),
    "pts30": ("pts", 2, lambda r: r["pts"] >= 30, "30-point game", "pts", 30),
    "pts40": ("pts", 3, lambda r: r["pts"] >= 40, "40-point game", "pts", 40),
    "dd": ("dd", 1, lambda r: _dd_count(r) >= 2, "double-double", None, None),
    "td": ("dd", 2, lambda r: _dd_count(r) >= 3, "triple-double", None, None),
    "reb10": ("reb", 1, lambda r: r["reb"] >= 10, "10-rebound game", "reb", 10),
    "ast10": ("ast", 1, lambda r: r["ast"] >= 10, "10-assist game", "ast", 10),
    "tpm5": ("tpm", 1, lambda r: r["tpm"] >= 5, "game with 5 or more threes", "tpm", 5),
}

# rare lines: key -> (test, headline from the line). Rarity comes from how often the league has done it this season.
RARE = {
    "30_10_10": (lambda r: r["pts"] >= 30 and r["reb"] >= 10 and r["ast"] >= 10,
                 lambda r: f"{r['name']} had a 30-10-10 line: {r['pts']}, {r['reb']} and {r['ast']}"),
    "20_20": (lambda r: r["pts"] >= 20 and r["reb"] >= 20,
              lambda r: f"{r['name']} had a 20-20 game: {r['pts']} points, {r['reb']} rebounds"),
    "pts40": (lambda r: r["pts"] >= 40, lambda r: f"{r['name']} scored {r['pts']}"),
    "td": (lambda r: _dd_count(r) >= 3, lambda r: f"{r['name']} had a triple-double"),
    "tpm8": (lambda r: r["tpm"] >= 8, lambda r: f"{r['name']} made {r['tpm']} threes"),
}

_N = NormalDist()


@dataclass
class StoryBuild:
    stories: list[dict] = field(default_factory=list)
    baselines: list[dict] = field(default_factory=list)
    candidates: int = 0  # stories found before the top 20 cut
    nights: int = 0


# ------------------------------------------------------------------ math


def baseline(values: list[float]) -> tuple[int, float | None, float | None]:
    """(n, mean, sample standard deviation). The deviation needs 2 values."""
    n = len(values)
    if not n:
        return 0, None, None
    mean = sum(values) / n
    if n < 2:
        return n, mean, None
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    return n, mean, math.sqrt(var)


def zscore(value: float, mean: float | None, sd: float | None, floor: float = 0.0) -> float | None:
    """(value - mean) / sd, with the deviation raised to `floor`. None without a mean or a usable deviation."""
    if mean is None:
        return None
    s = max(sd or 0.0, floor)
    if s <= 0:
        return None
    return (value - mean) / s


def rarity_of_p(p: float) -> float:
    """A probability as a z-score: how far into the tail an event this rare sits (0 for p >= 0.5)."""
    p = min(max(p, 1e-9), 1.0)
    if p >= 0.5:
        return 0.0
    return min(RARITY_CAP, _N.inv_cdf(1 - p))


def ts_pct(pts: float, fga: float, fta: float) -> float | None:
    tsa = fga + 0.44 * fta
    return None if tsa <= 0 else 100.0 * pts / (2 * tsa)


def prominence(mpg: float, usg: float | None) -> float:
    """0 to 1: half minutes (36 a game is full), half usage (30% is full)."""
    m = min(max(mpg / 36.0, 0.0), 1.0)
    u = min(max((usg or 0.0) / 30.0, 0.0), 1.0)
    return 0.5 * m + 0.5 * u


def score_of(rarity: float, prom: float) -> float:
    return rarity * (0.5 + prom)


def _r1(x):
    return None if x is None else round(float(x), 1)


def _r2(x):
    return None if x is None else round(float(x), 2)


# ------------------------------------------------------------------ inputs


def _played(r: dict) -> bool:
    return not r["did_not_play"] and (r.get("min") or 0) > 0


def _lines(build: Build) -> dict[int, list[dict]]:
    """Each player's played games in date order, with the numbers the finder reads."""
    team_used = {(t["game_id"], t["team_code"]): (t["fga"] + 0.44 * t["fta"] + t["tov"], t["minutes"]) for t in build.team_games}
    out: dict[int, list[dict]] = defaultdict(list)
    for r in build.player_games:
        if not _played(r):
            continue
        used, length = team_used.get((r["game_id"], r["team_code"]), (None, None))
        line = dict(game_id=r["game_id"], date=r["game_date"], team=r["team_code"], opp=r["opp_code"],
                    home=r["home_away"] == "home", name=r["name"], min=float(r["min"]),
                    pts=r["pts"] or 0, reb=r["reb"] or 0, ast=r["ast"] or 0, stl=r["stl"] or 0, blk=r["blk"] or 0,
                    tov=r["tov"] or 0, fgm=r["fgm"] or 0, fga=r["fga"] or 0, tpm=r["tpm"] or 0, tpa=r["tpa"] or 0,
                    ftm=r["ftm"] or 0, fta=r["fta"] or 0, plus_minus=r["plus_minus"],
                    tsa=(r["fga"] or 0) + 0.44 * (r["fta"] or 0), team_used=used, length=length)
        line["ts_pct"] = ts_pct(line["pts"], line["fga"], line["fta"])
        out[r["player_id"]].append(line)
    for lst in out.values():
        lst.sort(key=lambda x: (x["date"], x["game_id"]))
    return out


def stat_values(games: list[dict], stat: str) -> list[float]:
    """The values that count in a baseline: true shooting only in games with enough attempts."""
    if stat == "ts_pct":
        return [g["ts_pct"] for g in games if g["tsa"] >= TS_MIN_ATTEMPTS and g["ts_pct"] is not None]
    return [float(g[stat]) for g in games if g[stat] is not None]


def usage(games: list[dict]) -> float | None:
    """Share of his team's plays (FGA + 0.44 FTA + TOV) used while on the floor, over these games."""
    num = den = 0.0
    for g in games:
        if g["team_used"] is None or not g["length"]:
            continue
        num += (g["fga"] + 0.44 * g["fta"] + g["tov"]) * g["length"]
        den += g["min"] * g["team_used"]
    return None if den <= 0 else 100.0 * num / den


# ------------------------------------------------------------------ the finder


def build_stories(build: Build) -> StoryBuild:
    lines = _lines(build)
    cands, nights = find_candidates(build, lines)
    out = StoryBuild(nights=len(nights))
    for d in nights:
        found = cands.get(d, [])
        out.candidates += len(found)
        for rank, s in enumerate(pick_top(found), 1):
            s.update(story_date=d, rank=rank, season=build.season)
            out.stories.append(s)
    out.baselines = current_baselines(lines, build)
    return out


def find_candidates(build: Build, lines: dict[int, list[dict]] | None = None) -> tuple[dict[str, list[dict]], list[str]]:
    """Every story each rule finds, by night, before the top 20 cut."""
    lines = _lines(build) if lines is None else lines
    nights = sorted({g["date"] for lst in lines.values() for g in lst})

    # league counts by night, for event rates (games before a night use the running total)
    per_night: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for lst in lines.values():
        for g in lst:
            c = per_night[g["date"]]
            c["games"] += 1
            for k, (test, _) in STREAKS.items():
                c["s:" + k] += bool(test(g))
            for k, (_, _, test, *_rest) in FIRSTS.items():
                c["f:" + k] += bool(test(g))
            for k, (test, _) in RARE.items():
                c["r:" + k] += bool(test(g))
    before: dict[str, dict[str, int]] = {}  # league totals from games before each night
    run: dict[str, int] = defaultdict(int)
    for d in nights:
        before[d] = dict(run)
        for k, v in per_night[d].items():
            run[k] += v
    through = {d: {k: before[d].get(k, 0) + per_night[d].get(k, 0) for k in set(before[d]) | set(per_night[d])} for d in nights}

    cands: dict[str, list[dict]] = defaultdict(list)
    for pid, lst in lines.items():
        for i, g in enumerate(lst):
            prior, upto = lst[:i], lst[: i + 1]
            prom = prominence(sum(x["min"] for x in upto) / len(upto), usage(upto))
            ctx = dict(pid=pid, g=g, prior=prior, upto=upto, prom=prom)
            cands[g["date"]] += _outliers(ctx)
            cands[g["date"]] += _streaks(ctx, through[g["date"]])
            cands[g["date"]] += _firsts(ctx, before[g["date"]])
            cands[g["date"]] += _rare(ctx, before[g["date"]])
    for d, rows in _team_swings(build).items():
        cands[d] += rows
    return cands, nights


def pick_top(found: list[dict], n: int = TOP_N) -> list[dict]:
    """Best first, one story per player (or team) per night. The player's other stories that night ride along in
    the evidence as `also`, so a big night reads as one card, not five."""
    found = sorted(found, key=lambda s: (-s["score"], s["story_id"]))
    by_subject: dict = defaultdict(list)
    for s in found:
        by_subject[s["player_id"] if s["player_id"] is not None else s["team_code"]].append(s)
    kept = []
    for s in found:
        rest = by_subject[s["player_id"] if s["player_id"] is not None else s["team_code"]]
        if rest[0] is not s:
            continue
        s["evidence"] = {**s["evidence"], "also": [dict(kind=x["kind"], subtype=x["subtype"], headline=x["headline"],
                                                       z=x["z"], rarity=x["rarity"]) for x in rest[1:4]]}
        kept.append(s)
        if len(kept) == n:
            break
    return kept


def _story(ctx: dict, kind: str, subtype: str, headline: str, detail: str, rarity: float, evidence: dict,
           value=None, base=None, sd=None, z=None, games=None) -> dict:
    g = ctx["g"]
    rarity = min(rarity, RARITY_CAP)
    return dict(story_id=f"{kind}:{subtype}:{ctx['pid']}:{g['game_id']}", kind=kind, subtype=subtype,
                player_id=ctx["pid"], name=g["name"], team_code=g["team"], opp_code=g["opp"], game_id=g["game_id"],
                headline=headline, detail=detail, value=_r1(value), baseline=_r1(base), sd=_r1(sd), z=_r2(z),
                games=games, rarity=_r2(rarity), prominence=_r2(ctx["prom"]), score=_r2(score_of(rarity, ctx["prom"])),
                evidence=evidence)


def _fmt(v: float, stat: str) -> str:
    if stat == "ts_pct":
        return f"{v:.1f}%"
    if stat == "plus_minus":
        return f"{v:+.0f}"
    return f"{v:.0f}"


def _avg(v: float, stat: str) -> str:
    return f"{v:+.1f}" if stat == "plus_minus" else f"{v:.1f}" + ("%" if stat == "ts_pct" else "")


def _outliers(ctx: dict) -> list[dict]:
    g, prior = ctx["g"], ctx["prior"]
    if len(prior) < MIN_GAMES_BEFORE:
        return []
    out = []
    for stat, (label, floor) in STATS.items():
        v = g[stat]
        if v is None or (stat == "ts_pct" and g["tsa"] < 10):
            continue
        vals = stat_values(prior, stat)
        n, mean, sd = baseline(vals)
        if n < MIN_GAMES_BEFORE:
            continue
        z = zscore(v, mean, sd, floor)
        if z is None or abs(z) < Z_FLAG:
            continue
        high = z > 0
        if high and not _big_enough(stat, g):
            continue
        if not high and not _low_story(stat, g, mean):
            continue
        n10, m10, sd10 = baseline(vals[-L10:])
        z10 = zscore(v, m10, sd10, floor)
        name = g["name"]
        if stat == "pts":
            head = f"{name} scored {v}" if high else f"{name} was held to {v} points"
        elif stat == "reb":
            head = f"{name} grabbed {v} rebounds"
        elif stat == "ast":
            head = f"{name} had {v} assists"
        elif stat == "tpm":
            head = f"{name} made {v} threes"
        elif stat == "plus_minus":
            head = f"{name} was {v:+d} on the floor"
        else:
            head = (f"{name} shot {v:.1f}% true shooting" if high else f"{name} shot {v:.1f}% true shooting on a rough night")
        word = "above" if high else "below"
        detail = (f"His average before this game was {_avg(mean, stat)} {label} in {n} games. This was {abs(z):.1f} "
                  f"standard deviations {word} it.")
        ev = dict(stat=stat, label=label, value=_r1(v), floor=floor,
                  season=dict(n=n, mean=_r1(mean), sd=_r1(sd), z=_r2(z)),
                  l10=dict(n=n10, mean=_r1(m10), sd=_r1(sd10), z=_r2(z10)),
                  line=_line(g))
        out.append(_story(ctx, "outlier", f"{stat}_{'high' if high else 'low'}", head, detail, abs(z), ev,
                          value=v, base=mean, sd=sd, z=z, games=n))
    return out


def _big_enough(stat: str, g: dict) -> bool:
    """A high outlier must also be a big number on its own."""
    return {"pts": g["pts"] >= 20, "reb": g["reb"] >= 10, "ast": g["ast"] >= 8, "tpm": g["tpm"] >= 4,
            "plus_minus": (g["plus_minus"] or 0) >= 15,
            "ts_pct": (g["ts_pct"] or 0) >= 70 and g["pts"] >= 15}[stat]


def _low_story(stat: str, g: dict, mean: float) -> bool:
    """A cold night is a story only for a scorer who played real minutes."""
    if stat == "pts":
        return mean >= 15 and g["min"] >= 20
    if stat == "ts_pct":
        return g["tsa"] >= 12 and (g["ts_pct"] or 100) <= 40
    if stat == "plus_minus":
        return (g["plus_minus"] or 0) <= -20
    return False


def _line(g: dict) -> dict:
    return {k: g[k] for k in ("min", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta",
                              "plus_minus")} | dict(ts_pct=_r1(g["ts_pct"]))


def _rate(k: int, n: int, league: dict, key: str) -> tuple[float, float]:
    """A player's rate of an event, shrunk toward the league's rate: (rate, league rate)."""
    lg_games = league.get("games", 0)
    lg = (league.get(key, 0) + 1) / (lg_games + 2)
    return (k + PRIOR_GAMES * lg) / (n + PRIOR_GAMES), lg


def _streaks(ctx: dict, league_through: dict) -> list[dict]:
    g, upto = ctx["g"], ctx["upto"]
    out = []
    for key, (test, phrase) in STREAKS.items():
        if not test(g):
            continue
        n = 0
        for x in reversed(upto):
            if not test(x):
                break
            n += 1
        if n < STREAK_MIN:
            continue
        k = sum(1 for x in upto if test(x))
        rate, lg = _rate(k, len(upto), league_through, "s:" + key)
        p = rate ** n
        games = upto[-n:]
        detail = (f"He has done it in {k} of his {len(upto)} games this season. The league rate is {100 * lg:.0f}% "
                  f"of games played.")
        ev = dict(event=key, length=n, season_count=k, season_games=len(upto), rate=round(rate, 3),
                  league_rate=round(lg, 3), p=round(p, 5),
                  games=[dict(date=x["date"], game_id=x["game_id"], opp=x["opp"], pts=x["pts"], reb=x["reb"],
                              ast=x["ast"], tpm=x["tpm"]) for x in games])
        out.append(_story(ctx, "streak", key, f"{g['name']}: {n} {phrase}", detail, rarity_of_p(p), ev,
                          value=n, games=len(upto)))
    return out


def _firsts(ctx: dict, league_before: dict) -> list[dict]:
    g, prior = ctx["g"], ctx["prior"]
    if len(prior) < FIRST_MIN_GAMES:
        return []
    best: dict[str, tuple] = {}
    for key, (family, tier, test, phrase, stat, thr) in FIRSTS.items():
        if not test(g) or any(test(x) for x in prior):
            continue
        if family not in best or tier > best[family][0]:
            best[family] = (tier, key, phrase, stat, thr)
    out = []
    for _, key, phrase, stat, thr in best.values():
        if stat is not None:
            # how unlikely the threshold was for him: a z-score of the threshold against his own baseline
            label, floor = STATS[stat]
            n, mean, sd = baseline(stat_values(prior, stat))
            rarity = max(0.0, zscore(thr, mean, sd, floor) or 0.0)
            how = f"His average before this game was {_avg(mean, stat)} {label} in {n} games."
            ev = dict(event=key, threshold=thr, stat=stat, games_before=len(prior),
                      best_before=max(x[stat] for x in prior), season=dict(n=n, mean=_r1(mean), sd=_r1(sd)),
                      line=_line(g))
            val = g[stat]
        else:
            rate, lg = _rate(0, len(prior), league_before, "f:" + key)
            rarity = rarity_of_p(rate)
            how = f"He had not done it in {len(prior)} games. The league rate is {100 * lg:.1f}% of games played."
            ev = dict(event=key, games_before=len(prior), rate=round(rate, 4), league_rate=round(lg, 4), line=_line(g))
            val, mean, sd = None, None, None
        out.append(_story(ctx, "first", key, f"{g['name']}: first {phrase} of his season",
                          f"{how} {_box(g)}.", rarity, ev, value=val, base=mean, sd=sd, games=len(prior)))
    return out


def _box(g: dict) -> str:
    return f"He had {g['pts']} points, {g['reb']} rebounds and {g['ast']} assists"


def _rare(ctx: dict, league_before: dict) -> list[dict]:
    g = ctx["g"]
    out = []
    for key, (test, headline) in RARE.items():
        if not test(g):
            continue
        k, n = league_before.get("r:" + key, 0), league_before.get("games", 0)
        p = (k + 1) / (n + 2)
        times = "once" if k == 1 else f"{k} times"
        before = (f"The league had done it {times} in {n:,} player games this season before this night."
                  if k else f"Nobody had done it in {n:,} player games this season before this night.")
        ev = dict(event=key, league_count=k, league_games=n, p=round(p, 5), line=_line(g))
        out.append(_story(ctx, "rare", key, headline(g), f"{before} {_box(g)}.",
                          rarity_of_p(p), ev, games=n))
    return out


def _team_swings(build: Build) -> dict[str, list[dict]]:
    """A team's net rating over its last games against its earlier games, after every night it played."""
    by_team: dict[str, list[dict]] = defaultdict(list)
    for t in build.team_games:
        if t["net"] is not None:
            by_team[t["team_code"]].append(t)
    for lst in by_team.values():
        lst.sort(key=lambda t: (t["game_date"], t["game_id"]))
    # spread of single-game net ratings across the league through each night
    nets_by_night: dict[str, list[float]] = defaultdict(list)
    for lst in by_team.values():
        for t in lst:
            nets_by_night[t["game_date"]].append(t["net"])
    sd_through, seen = {}, []
    for d in sorted(nets_by_night):
        seen += nets_by_night[d]
        sd_through[d] = baseline(seen)[2]
    out: dict[str, list[dict]] = defaultdict(list)
    for code, lst in by_team.items():
        for i, tg in enumerate(lst):
            gp = i + 1
            if gp < TEAM_MIN_GAMES:
                continue
            w = min(L10, gp // 2)
            last, rest = lst[gp - w: gp], lst[: gp - w]
            sd = sd_through[tg["game_date"]]
            if not sd:
                continue
            m_last = _net(last)
            m_rest = _net(rest)
            z = (m_last - m_rest) / (sd * math.sqrt(1 / w + 1 / len(rest)))
            if abs(z) < Z_FLAG:
                continue
            wl = lambda xs: (sum(1 for x in xs if x["win"]), sum(1 for x in xs if not x["win"]))  # noqa: E731
            lw, ll = wl(last)
            rw, rl = wl(rest)
            hot = z > 0
            head = (f"{code} have turned it around: {lw}-{ll} in the last {w}" if hot
                    else f"{code} have cooled off: {lw}-{ll} in the last {w}")
            detail = (f"Net rating {m_last:+.1f} over the last {w} games, {m_rest:+.1f} in the {len(rest)} before "
                      f"({rw}-{rl}).")
            ev = dict(window=w, last=dict(games=w, w=lw, l=ll, net=_r1(m_last)),
                      rest=dict(games=len(rest), w=rw, l=rl, net=_r1(m_rest)), sd_game=_r1(sd), z=_r2(z),
                      games=[dict(date=x["game_date"], game_id=x["game_id"], opp=x["opp_code"], win=x["win"],
                                  pts=x["pts"], opp_pts=x["opp_pts"], net=x["net"]) for x in lst[:gp]])
            rarity = min(abs(z), RARITY_CAP)
            out[tg["game_date"]].append(dict(
                story_id=f"team:{'hot' if hot else 'cold'}:{code}:{tg['game_id']}", kind="team",
                subtype="hot" if hot else "cold", player_id=None, name=None, team_code=code, opp_code=tg["opp_code"],
                game_id=tg["game_id"], headline=head, detail=detail, value=_r1(m_last), baseline=_r1(m_rest),
                sd=_r1(sd), z=_r2(z), games=gp, rarity=_r2(rarity), prominence=TEAM_PROMINENCE,
                score=_r2(score_of(rarity, TEAM_PROMINENCE)), evidence=ev))
    return out


def _net(games: list[dict]) -> float:
    """Net rating over a stretch, from points and possessions (not an average of game ratings)."""
    poss = sum(t["poss"] or 0 for t in games)
    if not poss:
        return sum(t["net"] for t in games) / len(games)
    return 100.0 * (sum(t["pts"] for t in games) - sum(t["opp_pts"] for t in games)) / poss


# ------------------------------------------------------------------ current baselines


def current_baselines(lines: dict[int, list[dict]], build: Build) -> list[dict]:
    """Each player's season and last-10 baselines from every game before the run date."""
    rows = []
    for pid, lst in lines.items():
        for stat in STATS:
            vals = stat_values(lst, stat)
            n, mean, sd = baseline(vals)
            n10, m10, sd10 = baseline(vals[-L10:])
            rows.append(dict(season=build.season, player_id=pid, team_code=lst[-1]["team"], as_of=build.today.isoformat(),
                             stat=stat, gp=n, mean=_r1(mean), sd=_r1(sd), l10_gp=n10, l10_mean=_r1(m10), l10_sd=_r1(sd10)))
    return rows


# ------------------------------------------------------------------ checks


def story_checks(sb: StoryBuild, build: Build) -> tuple[list[str], list[str]]:
    """Re-check every claim against the box scores, independently of how it was found."""
    errs: list[str] = []
    played = defaultdict(list)
    for r in build.player_games:
        if _played(r):
            played[r["player_id"]].append(r)
    by_night = defaultdict(list)
    for s in sb.stories:
        by_night[s["story_date"]].append(s)
    for d, rows in by_night.items():
        if len(rows) > TOP_N or [s["rank"] for s in rows] != list(range(1, len(rows) + 1)):
            errs.append(f"stories: {d} has {len(rows)} stories or ranks out of order")
    for s in sb.stories:
        if s["kind"] != "first":
            continue
        _, _, test, *_ = FIRSTS[s["subtype"]]
        earlier = [r for r in played[s["player_id"]] if r["game_date"] < s["story_date"]]
        night = [r for r in played[s["player_id"]] if r["game_id"] == s["game_id"]]
        if not night or not test(_as_line(night[0])):
            errs.append(f"stories: {s['story_id']} claims a first the box score does not show")
        if any(test(_as_line(r)) for r in earlier):
            errs.append(f"stories: {s['story_id']} claims a first, but an earlier game this season had it")
    return errs, []


def _as_line(r: dict) -> dict:
    return {k: r[k] or 0 for k in ("pts", "reb", "ast", "stl", "blk", "tpm")}
