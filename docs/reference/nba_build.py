#!/usr/bin/env python3
"""NBA Daily data builder.

  base    Download this season's ESPN box scores (hoopR mirror on GitHub), then compute
          team ratings, player averages, last night's full box scores, team-vs-team gaps,
          results and tonight's schedule. Writes *_base.json and final stat files.
  digest  Print (and save as digest.txt) a plain-text fact sheet for writing the picks, tags,
          notes and surprises: tonight's matchups with ranks, lines, injuries and missing
          scoring; last night's scores, biggest team-stat gaps and standout lines.
          Run it after base, once odds.json and injuries.json exist.
  finish  Merge odds.json, injuries.json, editorial.json (and optional sr_standings.json)
          into games.json, results.json, standings.json and brief.json, then run checks.

Usage: python3 nba_build.py base   --out DIR [--date YYYY-MM-DD]
       python3 nba_build.py digest --out DIR
       python3 nba_build.py finish --out DIR
"""
import argparse, json, math, os, re, sys, time, urllib.request, zlib
import datetime as dt
from zoneinfo import ZoneInfo
import pandas as pd

ET = ZoneInfo("America/New_York")
DATA = "https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba"
RAW = "https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-raw/main/nba/json/raw"
FIX = {"GS": "GSW", "NY": "NYK", "NO": "NOP", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}
EAST = {"ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"}
CODES = EAST | {"DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHX", "POR", "SAC", "SAS", "UTA"}


def code(a):
    a = str(a).upper()
    return FIX.get(a, a)


def r1(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 1)


def num(x):
    try:
        v = float(x)
        return None if math.isnan(v) else v
    except (TypeError, ValueError):
        return None


def fetch(url, path, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return True
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    print(f"fetch failed: {url}: {last}", file=sys.stderr)
    return False


def write(out, name, obj):
    with open(os.path.join(out, name), "w") as f:
        json.dump(obj, f, ensure_ascii=False)


def clean(rows):
    """JSON-safe: NaN -> None, numpy -> python."""
    out = []
    for r in rows:
        d = {}
        for k, v in r.items():
            if hasattr(v, "item"):
                v = v.item()
            if isinstance(v, float) and math.isnan(v):
                v = None
            d[k] = v
        out.append(d)
    return out


# ---------------------------------------------------------------- raw ESPN game json -> rows
def parse_raw(gid, js, game_date):
    """Turn one ESPN summary json (hoopR raw mirror) into player_box / team_box style rows."""
    comp = js["header"]["competitions"][0]
    side = {c["team"]["abbreviation"]: c for c in comp["competitors"]}
    prow, trow = [], []
    for t in js["boxscore"]["players"]:
        ab = t["team"]["abbreviation"]
        st = t["statistics"][0]
        keys = st["keys"]
        opp = [a for a in side if a != ab][0]
        for a in st["athletes"]:
            row = dict(game_id=gid, game_date=game_date, team_abbreviation=ab, opponent_team_abbreviation=opp,
                       home_away=side[ab]["homeAway"], athlete_id=int(a["athlete"]["id"]),
                       athlete_display_name=a["athlete"]["displayName"],
                       athlete_position_abbreviation=(a["athlete"].get("position") or {}).get("abbreviation", ""),
                       starter=bool(a.get("starter")), did_not_play=bool(a.get("didNotPlay")), reason=a.get("reason") or "")
            vals = dict(zip(keys, a.get("stats") or []))
            def pair(k):
                v = vals.get(k, "")
                if "-" in str(v):
                    m, att = str(v).split("-", 1)
                    return num(m), num(att)
                return None, None
            row["minutes"] = num(vals.get("minutes"))
            row["points"] = num(vals.get("points"))
            row["field_goals_made"], row["field_goals_attempted"] = pair("fieldGoalsMade-fieldGoalsAttempted")
            row["three_point_field_goals_made"], row["three_point_field_goals_attempted"] = pair("threePointFieldGoalsMade-threePointFieldGoalsAttempted")
            row["free_throws_made"], row["free_throws_attempted"] = pair("freeThrowsMade-freeThrowsAttempted")
            for k, col in [("rebounds", "rebounds"), ("assists", "assists"), ("turnovers", "turnovers"), ("steals", "steals"),
                           ("blocks", "blocks"), ("offensiveRebounds", "offensive_rebounds"), ("defensiveRebounds", "defensive_rebounds"),
                           ("fouls", "fouls")]:
                row[col] = num(vals.get(k))
            pm = vals.get("plusMinus")
            row["plus_minus"] = num(str(pm).replace("+", "")) if pm not in (None, "") else None
            prow.append(row)
    for t in js["boxscore"]["teams"]:
        ab = t["team"]["abbreviation"]
        s = {x["name"]: x.get("displayValue") for x in t["statistics"]}
        def pr(k):
            m, a = str(s.get(k, "0-0")).split("-", 1)
            return num(m), num(a)
        fgm, fga = pr("fieldGoalsMade-fieldGoalsAttempted")
        tpm, tpa = pr("threePointFieldGoalsMade-threePointFieldGoalsAttempted")
        ftm, fta = pr("freeThrowsMade-freeThrowsAttempted")
        c = side[ab]
        trow.append(dict(game_id=gid, game_date=game_date, team_abbreviation=ab, team_home_away=c["homeAway"],
                         team_score=num(c.get("score")), team_winner=bool(c.get("winner")),
                         team_display_name=t["team"].get("displayName"), team_name=t["team"].get("name"),
                         field_goals_made=fgm, field_goals_attempted=fga, three_point_field_goals_made=tpm,
                         three_point_field_goals_attempted=tpa, free_throws_made=ftm, free_throws_attempted=fta,
                         offensive_rebounds=num(s.get("offensiveRebounds")), defensive_rebounds=num(s.get("defensiveRebounds")),
                         total_rebounds=num(s.get("totalRebounds")), assists=num(s.get("assists")), steals=num(s.get("steals")),
                         blocks=num(s.get("blocks")), total_turnovers=num(s.get("totalTurnovers")), fouls=num(s.get("fouls")),
                         fast_break_points=num(s.get("fastBreakPoints")), points_in_paint=num(s.get("pointsInPaint")),
                         turnover_points=num(s.get("turnoverPoints")), largest_lead=num(s.get("largestLead")),
                         lead_changes=num(s.get("leadChanges"))))
    ls = {c["homeAway"]: [int(float(x.get("value", x.get("displayValue", 0)))) for x in c.get("linescores", [])] for c in comp["competitors"]}
    periods = list(zip(ls.get("away", []), ls.get("home", [])))
    return prow, trow, periods


# PATCH FORMAT (patch_<espn_id>.json), written from an ESPN game page when no mirror has the game yet:
# {"game_id": 401909906, "away": "TOR", "home": "LAL", "periods": [[23, 36], [31, 30], [28, 38], [43, 27]],
#  "teams": {"TOR": {"fgm":45,"fga":105,"tpm":17,"tpa":54,"ftm":18,"fta":25,"oreb":22,"dreb":25,"reb":47,"ast":35,
#                    "stl":14,"blk":1,"tov":15,"pf":26,"fb":23,"paint":46,"pts_off_to":23,"largest_lead":5,"lead_changes":1}, "LAL": {...}},
#  "players": [{"id": 3945274, "team": "LAL", "name": "Luka Doncic", "pos": "G", "starter": true, "dnp": false, "reason": "",
#               "min": 35, "pts": 45, "fgm": 12, "fga": 23, "tpm": 8, "tpa": 12, "ftm": 13, "fta": 13, "oreb": 0, "dreb": 15,
#               "reb": 15, "ast": 6, "stl": 5, "blk": 1, "tov": 7, "pf": 5, "pm": 27}, ...]}
# Team codes may be ESPN's (GS, NY, NO, SA, UTAH, WSH) or ours. Players who did not play: "dnp": true and a "reason".
# From the summary JSON: players from boxscore.players[].statistics[0].athletes, stats mapped by its labels
# (MIN PTS FG 3PT FT REB AST TO STL BLK OREB DREB PF +/-). Team keys from boxscore.teams[].statistics by name:
# fgm-fga fieldGoalsMade-fieldGoalsAttempted, tpm-tpa threePointFieldGoalsMade-threePointFieldGoalsAttempted,
# ftm-fta freeThrowsMade-freeThrowsAttempted, oreb offensiveRebounds, dreb defensiveRebounds, reb totalRebounds,
# ast assists, stl steals, blk blocks, tov totalTurnovers (NOT turnovers: the total includes team turnovers),
# pf fouls, fb fastBreakPoints, paint pointsInPaint, pts_off_to turnoverPoints, largest_lead largestLead,
# lead_changes leadChanges.
# Period scores: ESPN's summary JSON is cut off before its line score, so take them from the game page
# (www.espn.com/nba/game/_/gameId/<id>). If they cannot be found, use "periods": [] and the box score still counts.
def from_patch(p, game_date):
    gid = int(p["game_id"])
    a, h = p["away"], p["home"]
    side = {a: "away", h: "home"}
    pts = {t: sum(int(x["pts"]) for x in p["players"] if x["team"] == t and not x.get("dnp")) for t in (a, h)}
    periods = [tuple(int(v) for v in q) for q in (p.get("periods") or [])]
    if periods and (sum(q[0] for q in periods) != pts[a] or sum(q[1] for q in periods) != pts[h]):
        raise ValueError(f"patch {gid}: player points {pts} do not match the period scores")
    if periods:
        n_per = len(periods)
    else:  # no line score: count overtimes from minutes (240 player-minutes per team in regulation, 25 more per overtime)
        mins = sum(float(x.get("min") or 0) for x in p["players"] if x["team"] == a and not x.get("dnp"))
        n_per = 4 + max(0, round((mins - 240) / 25))
    prow, trow = [], []
    for x in p["players"]:
        t = x["team"]
        dnp = bool(x.get("dnp"))
        pid = x.get("id") or zlib.crc32(f"{t}|{x['name']}".encode())
        g = (lambda k: None if dnp else num(x.get(k)))
        prow.append(dict(game_id=gid, game_date=game_date, team_abbreviation=t, opponent_team_abbreviation=h if t == a else a,
                         home_away=side[t], athlete_id=int(pid), athlete_display_name=x["name"],
                         athlete_position_abbreviation=x.get("pos", ""), starter=bool(x.get("starter")), did_not_play=dnp,
                         reason=x.get("reason", ""), minutes=g("min"), points=g("pts"), field_goals_made=g("fgm"),
                         field_goals_attempted=g("fga"), three_point_field_goals_made=g("tpm"),
                         three_point_field_goals_attempted=g("tpa"), free_throws_made=g("ftm"), free_throws_attempted=g("fta"),
                         offensive_rebounds=g("oreb"), defensive_rebounds=g("dreb"), rebounds=g("reb"), assists=g("ast"),
                         steals=g("stl"), blocks=g("blk"), turnovers=g("tov"), fouls=g("pf"),
                         plus_minus=None if dnp or x.get("pm") is None else str(int(x["pm"]))))
    for t in (a, h):
        s = p["teams"][t]
        trow.append(dict(game_id=gid, game_date=game_date, team_abbreviation=t, team_home_away=side[t], team_score=pts[t],
                         team_winner=pts[t] > pts[h if t == a else a], field_goals_made=s["fgm"], field_goals_attempted=s["fga"],
                         three_point_field_goals_made=s["tpm"], three_point_field_goals_attempted=s["tpa"],
                         free_throws_made=s["ftm"], free_throws_attempted=s["fta"], offensive_rebounds=s["oreb"],
                         defensive_rebounds=s["dreb"], total_rebounds=s["reb"], assists=s["ast"], steals=s["stl"],
                         blocks=s["blk"], total_turnovers=s["tov"], fouls=s["pf"], fast_break_points=s.get("fb", 0),
                         points_in_paint=s.get("paint", 0), turnover_points=s.get("pts_off_to", 0),
                         largest_lead=s.get("largest_lead", 0), lead_changes=s.get("lead_changes", 0)))
    return prow, trow, periods, n_per


# ---------------------------------------------------------------- helpers on parsed strings
def periods_of(s):
    return [int(float(v)) for v in re.findall(r"'value': ([0-9.]+)", str(s))]


def records_of(s):
    return dict(re.findall(r"'type': '(\w+)', 'summary': '(\d+-\d+)'", str(s)))


def pct(a, b):
    return None if not b else 100.0 * a / b


# ================================================================ BASE
def base(out, date_str=None, drop=()):
    os.makedirs(out, exist_ok=True)
    today = dt.date.fromisoformat(date_str) if date_str else dt.datetime.now(ET).date()
    yday = today - dt.timedelta(days=1)
    season = today.year + 1 if today.month >= 8 else today.year
    meta = dict(today=today.isoformat(), yesterday=yday.isoformat(), season=season, notes=[])

    paths = {}
    for key, rel in [("pb", f"player_box/parquet/player_box_{season}.parquet"),
                     ("tb", f"team_box/parquet/team_box_{season}.parquet"),
                     ("sc", f"schedules/parquet/nba_schedule_{season}.parquet")]:
        p = os.path.join(out, os.path.basename(rel))
        if not fetch(f"{DATA}/{rel}", p):
            sys.exit(f"could not download {rel}")
        paths[key] = p
    pb = pd.read_parquet(paths["pb"])
    tb = pd.read_parquet(paths["tb"])
    sc = pd.read_parquet(paths["sc"])
    pb = pb[pb.season_type == 2].copy()
    tb = tb[tb.season_type == 2].copy()
    sc = sc[sc.season_type == 2].copy()
    for df in (pb, tb):
        df["game_date"] = df["game_date"].astype(str)
    sc["game_date"] = sc["game_date"].astype(str)
    if drop:  # testing only: pretend the season files do not have these games yet
        tb = tb[~tb.game_id.astype(int).isin(drop)].copy()
        pb = pb[~pb.game_id.astype(int).isin(drop)].copy()

    # ---- add finished games the season files do not have yet: first the raw per-game mirror,
    #      then patch_<espn_id>.json files written from ESPN game pages (see PATCH FORMAT below)
    sc["game_id"] = sc.game_id.astype(int)
    finals = sc[sc.status_type_name == "STATUS_FINAL"]
    y_sched = [int(g) for g in sc[sc.game_date == yday.isoformat()].game_id]
    have = set(tb.game_id.astype(int))
    want = sorted({int(g) for g in finals.game_id} | set(y_sched))
    period_map, period_n = {}, {}
    extra_p, extra_t = [], []
    for gid in [g for g in want if g not in have]:
        gd = sc[sc.game_id == gid].iloc[0]["game_date"]
        pfile = os.path.join(out, f"patch_{gid}.json")
        if os.path.exists(pfile):
            try:
                pr, tr, per, nper = from_patch(json.load(open(pfile)), gd)
                extra_p += pr
                extra_t += tr
                period_map[gid] = per
                period_n[gid] = nper
                meta["notes"].append(f"game {gid} added from an ESPN page patch")
                continue
            except Exception as e:  # noqa: BLE001
                print(f"patch failed {gid}: {e}", file=sys.stderr)
        p = os.path.join(out, f"raw_{gid}.json")
        if fetch(f"{RAW}/{gid}.json", p, tries=2):
            try:
                js = json.load(open(p))
                state = js["header"]["competitions"][0]["status"]["type"]
                if state.get("completed"):
                    pr, tr, per = parse_raw(gid, js, gd)
                    extra_p += pr
                    extra_t += tr
                    period_map[gid] = per
                    meta["notes"].append(f"game {gid} added from the raw per-game mirror")
            except Exception as e:  # noqa: BLE001
                print(f"raw parse failed {gid}: {e}", file=sys.stderr)
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
    bench = pb[(~pb.starter) & (~pb.did_not_play)].groupby(["game_id", "team"]).points.sum()
    T = tb[["game_id", "game_date", "team", "team_home_away", "team_score", "team_winner", "field_goals_made",
            "field_goals_attempted", "three_point_field_goals_made", "three_point_field_goals_attempted",
            "free_throws_made", "free_throws_attempted", "offensive_rebounds", "defensive_rebounds", "total_rebounds",
            "assists", "steals", "blocks", "total_turnovers", "fouls", "fast_break_points", "points_in_paint",
            "turnover_points", "largest_lead", "lead_changes"]].copy()
    T.columns = ["game_id", "date", "team", "ha", "pts", "win", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb",
                 "reb", "ast", "stl", "blk", "tov", "pf", "fb", "paint", "pts_off_to", "largest_lead", "lead_changes"]
    T["game_id"] = T.game_id.astype(int)
    for c in T.columns:
        if c not in ("game_id", "date", "team", "ha", "win"):
            T[c] = pd.to_numeric(T[c], errors="coerce").fillna(0)
    T["bench_pts"] = [float(bench.get((g, t), 0)) for g, t in zip(T.game_id, T.team)]
    O = T.drop(columns=["date", "ha", "win"]).rename(columns=lambda c: c if c == "game_id" else "o_" + c)
    G = T.merge(O, on="game_id")
    G = G[G.team != G.o_team].copy()
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
    better_high = ["ortg", "net", "l5_net", "ppg", "diff", "efg", "orb_pct", "ftr", "opp_tov_pct", "drb_pct", "fg_pct",
                   "fg3_pct", "ft_pct", "rpg", "apg", "spg", "bpg", "forced_tovpg", "fb_pg", "paint_pg", "pts_off_to_pg",
                   "bench_ppg", "fg3m_pg", "pace", "fg3a_rate"]
    better_low = ["drtg", "opp_ppg", "tov_pct", "opp_efg", "opp_ftr", "opp_fg_pct", "opp_fg3_pct", "opp_rpg", "tovpg",
                  "opp_fb_pg", "opp_paint_pg", "opp_pts_off_to_pg", "opp_bench_ppg", "opp_fg3m_pg"]
    for c in better_high:
        TS[c + "_rk"] = TS[c].rank(ascending=False, method="min").astype(int)
    for c in better_low:
        TS[c + "_rk"] = TS[c].rank(ascending=True, method="min").astype(int)
    TS = TS.sort_values("net", ascending=False)
    write(out, "team_season.json", clean(TS.to_dict("records")))

    # ---- player season (through last night) and before last night
    P = pb[~pb.did_not_play & (pb.minutes.fillna(0) > 0)].copy()
    P["game_id"] = P.game_id.astype(int)
    P["athlete_id"] = P.athlete_id.astype(int)

    def agg(df):
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

    S = agg(P)
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
    write(out, "player_season.json", clean(PS.to_dict("records")))

    # ---- last night's games
    y_ids = [g for g in y_sched if g in set(T.game_id)]
    meta["last_night_games"] = len(y_ids)
    before = agg(P[P.game_date < yday.isoformat()]) if len(P) else None
    bmap = {int(r.athlete_id): r for _, r in before.iterrows()} if before is not None else {}
    gcode = {}
    for _, r in sc.iterrows():
        gcode[int(r.game_id)] = f"{r.away}@{r.home}"

    box = []
    Y = pb[pb.game_id.astype(int).isin(y_ids)].copy()
    Y["game_id"] = Y.game_id.astype(int)
    for (gid, team), g in Y.groupby(["game_id", "team"], sort=False):
        played = g[~g.did_not_play & (g.minutes.fillna(0) > 0)]
        order = list(played[played.starter].index) + list(played[~played.starter].sort_values("minutes", ascending=False).index)
        dnp = g[g.did_not_play | (g.minutes.fillna(0) == 0)]
        for i, idx in enumerate(order + list(dnp.index)):
            r = g.loc[idx]
            pid = int(r.athlete_id)
            is_dnp = bool(r.did_not_play) or not (num(r.minutes) or 0) > 0
            row = dict(game_id=gcode.get(gid, str(gid)), espn_id=gid, team=team, opp=r.opp, player_id=pid,
                       player=r.athlete_display_name, pos=r.athlete_position_abbreviation or "", order=i,
                       starter=bool(r.starter) and not is_dnp, dnp=is_dnp,
                       reason=(str(r.reason).strip().capitalize() if is_dnp and r.reason else ""))
            if not is_dnp:
                fgm, fga = num(r.field_goals_made), num(r.field_goals_attempted)
                tpm, tpa = num(r.three_point_field_goals_made), num(r.three_point_field_goals_attempted)
                ftm, fta = num(r.free_throws_made), num(r.free_throws_attempted)
                row.update(min=int(r.minutes), pts=int(r.points), fg=f"{int(fgm)}-{int(fga)}", tp=f"{int(tpm)}-{int(tpa)}",
                           ft=f"{int(ftm)}-{int(fta)}", oreb=int(r.offensive_rebounds), dreb=int(r.defensive_rebounds),
                           reb=int(r.rebounds), ast=int(r.assists), stl=int(r.steals), blk=int(r.blocks),
                           tov=int(r.turnovers), pf=int(r.fouls), pm=None if pd.isna(r.pm) else int(r.pm),
                           ts_pct=r1(pct(r.points, 2 * (fga + 0.44 * fta))) if (fga + fta) > 0 else None)
                b = bmap.get(pid)
                flags = []
                if b is not None and b.gp > 0:
                    n = b.gp
                    avg = dict(min=b.mins / n, pts=b.pts / n, reb=b.reb / n, ast=b.ast / n, pm=b.pm / n, tpm=b.tpm / n)
                    row.update(gp_before=int(n), avg_min=r1(avg["min"]), avg_pts=r1(avg["pts"]), avg_reb=r1(avg["reb"]),
                               avg_ast=r1(avg["ast"]), avg_pm=r1(avg["pm"]),
                               d_pts=r1(row["pts"] - avg["pts"]), d_reb=r1(row["reb"] - avg["reb"]),
                               d_ast=r1(row["ast"] - avg["ast"]), d_min=r1(row["min"] - avg["min"]))
                    if abs(row["d_pts"]) >= 8 and max(avg["min"], row["min"]) >= 12:
                        flags.append(f"PTS {row['d_pts']:+.0f} vs avg")
                    if abs(row["d_reb"]) >= 5:
                        flags.append(f"REB {row['d_reb']:+.0f}")
                    if abs(row["d_ast"]) >= 4:
                        flags.append(f"AST {row['d_ast']:+.0f}")
                    if tpm - avg["tpm"] >= 3:
                        flags.append(f"3PM {tpm - avg['tpm']:+.0f}")
                    if abs(row["d_min"]) >= 10:
                        flags.append(f"MIN {row['d_min']:+.0f}")
                    if row["pts"] > b.hi_pts and row["pts"] >= 15:
                        flags.append("Season high PTS")
                else:
                    row.update(gp_before=0)
                    flags.append("First game this season")
                if row["pm"] is not None and abs(row["pm"]) >= 15:
                    flags.append(f"+/- {row['pm']:+d}")
                if row["pts"] >= 10 and row["reb"] >= 10 and row["ast"] >= 10:
                    flags.append("Triple-double")
                elif sum(1 for v in (row["pts"], row["reb"], row["ast"], row["stl"], row["blk"]) if v >= 10) >= 2:
                    flags.append("Double-double")
                row["flags"] = " · ".join(flags)
            box.append(row)
    write(out, "box_players.json", clean(box))

    # ---- last night team stats and team-vs-team gaps
    bt = []
    YG = G[G.game_id.isin(y_ids)]
    for _, r in YG.iterrows():
        bt.append(dict(game_id=gcode.get(int(r.game_id)), espn_id=int(r.game_id), team=r.team, opp=r.o_team, ha=r.ha,
                       pts=int(r.pts), fgm=int(r.fgm), fga=int(r.fga), fg_pct=r1(pct(r.fgm, r.fga)), tpm=int(r.tpm),
                       tpa=int(r.tpa), fg3_pct=r1(pct(r.tpm, r.tpa)), ftm=int(r.ftm), fta=int(r.fta),
                       ft_pct=r1(pct(r.ftm, r.fta)), oreb=int(r.oreb), dreb=int(r.dreb), reb=int(r.reb), ast=int(r.ast),
                       stl=int(r.stl), blk=int(r.blk), tov=int(r.tov), pf=int(r.pf), fb=int(r.fb), paint=int(r.paint),
                       pts_off_to=int(r.pts_off_to), bench_pts=int(r.bench_pts), largest_lead=int(r.largest_lead),
                       lead_changes=int(r.lead_changes), poss=r1(r.poss), ortg=r1(100 * r.pts / r.poss),
                       efg=r1(pct(r.fgm + 0.5 * r.tpm, r.fga)), tov_pct=r1(pct(r.tov, r.fga + 0.44 * r.fta + r.tov)),
                       orb_pct=r1(pct(r.oreb, r.oreb + r.o_dreb)), ftr=r1(pct(r.ftm, r.fga)),
                       ast_pct=r1(pct(r.ast, r.fgm))))
    write(out, "box_teams.json", clean(bt))

    # gaps: compare against how big that gap usually is in a game this season (std of away-home differences)
    stats = [("Scoring", "Points", "pts", 1), ("Shooting", "Field goal %", "fg_pct", 1), ("Shooting", "Effective FG %", "efg", 1),
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
    sd = {k: float((A[k] - A["o_" + k]).std()) for _, _, k, _ in stats}
    by = {(b["game_id"], b["ha"]): b for b in bt}
    comp = []
    order = {"Scoring": 0, "Shooting": 1, "Possession": 2, "Playmaking": 3, "Defense": 4, "Flow": 5}
    for gid in [gcode.get(g) for g in y_ids]:
        aw, hm = by.get((gid, "away")), by.get((gid, "home"))
        if not aw or not hm:
            continue
        for i, (grp, label, k, direction) in enumerate(stats):
            av, hv = aw.get(k), hm.get(k)
            if av is None or hv is None:
                continue
            d = av - hv
            z = abs(d) / sd[k] if sd[k] else 0
            if direction == 0:
                edge = aw["team"] if d > 0 else hm["team"] if d < 0 else ""
            else:
                edge = aw["team"] if d * direction > 0 else hm["team"] if d * direction < 0 else ""
            is_pct = k.endswith("pct") or k in ("efg", "ortg")
            fmt = (lambda v: f"{v:.1f}") if is_pct else (lambda v: f"{v:.0f}")
            level = "Major" if z >= 1.5 else "Notable" if z >= 1.0 else ""
            comp.append(dict(game_id=gid, key=k, order=order[grp] * 100 + i, group=grp, stat=label,
                             away=aw["team"], home=hm["team"], away_txt=fmt(av), home_txt=fmt(hv),
                             gap_txt=f"{abs(d):.1f}" if is_pct else f"{abs(d):.0f}",
                             edge=edge, edge_txt=(f"{edge} more" if direction == 0 and edge else edge or "Even"),
                             z=round(z, 2), level=level, volume=direction == 0))
    write(out, "box_compare.json", clean(comp))

    # ---- results (last night)
    rec_before = {}
    for t, g in G.groupby("team"):
        w = l = 0
        for _, r in g.iterrows():
            rec_before[(int(r.game_id), t)] = (w, l)
            w, l = (w + 1, l) if r.win else (w, l + 1)
    results = []
    for gid in y_ids:
        s = sc[sc.game_id == gid].iloc[0]
        if gid in period_map:
            aw_p, hm_p = [q[0] for q in period_map[gid]], [q[1] for q in period_map[gid]]
        else:
            aw_p, hm_p = periods_of(s.away_linescores), periods_of(s.home_linescores)
        a, h = s.away, s.home
        ar = G[(G.game_id == gid) & (G.team == a)].iloc[0]
        hr = G[(G.game_id == gid) & (G.team == h)].iloc[0]
        winner = a if ar.pts > hr.pts else h
        loser = h if winner == a else a
        wb, lb = rec_before[(gid, winner)], rec_before[(gid, loser)]
        wpct = wb[0] / sum(wb) if sum(wb) else 0.5
        lpct = lb[0] / sum(lb) if sum(lb) else 0.5
        results.append(dict(game_id=gcode[gid], espn_id=gid, date=yday.isoformat(), matchup=f"{a} @ {h}", away=a, home=h,
                            away_score=int(ar.pts), home_score=int(hr.pts), winner=winner,
                            periods=",".join(f"{x}-{y}" for x, y in zip(aw_p, hm_p)),
                            ot=max(period_n.get(gid, len(aw_p)) - 4, 0), away_max_lead=int(ar.largest_lead), home_max_lead=int(hr.largest_lead),
                            lead_changes=int(ar.lead_changes), upset=bool(wpct < lpct and sum(wb) >= 2), note=""))
    write(out, "results_base.json", clean(results))

    # ---- tonight's schedule
    rec_now = {}
    for t, g in G.groupby("team"):
        hm_, rd_ = g[g.ha == "home"], g[g.ha == "away"]
        rec_now[t] = dict(total=f"{int(g.win.sum())}-{int(len(g) - g.win.sum())}",
                          home=f"{int(hm_.win.sum())}-{int(len(hm_) - hm_.win.sum())}",
                          road=f"{int(rd_.win.sum())}-{int(len(rd_) - rd_.win.sum())}")
    last_played = G.groupby("team").date.max().to_dict()
    tonight = sc[sc.game_date == today.isoformat()].copy()
    games = []
    for _, s in tonight.iterrows():
        a, h = s.away, s.home
        tip = pd.Timestamp(s.date).tz_convert("UTC") if pd.Timestamp(s.date).tzinfo else pd.Timestamp(s.date, tz="UTC")
        tet = tip.tz_convert(ET)
        sched_rec = (records_of(s.away_records).get("total", ""), records_of(s.home_records).get("total", ""))
        ar, hr = rec_now.get(a, {}), rec_now.get(h, {})
        bname, bmkt = str(s.broadcast_name or ""), str(s.broadcast_market or "")
        if bmkt == "national" and bname:
            tv = bname
        elif "MNMT" in bname or "Monumental" in bname:
            tv = "Monumental · League Pass"
        else:
            tv = "League Pass"
        rest = {}
        for t in (a, h):
            lp = last_played.get(t)
            rest[t] = (today - dt.date.fromisoformat(lp)).days - 1 if lp else None
        b2b = ", ".join(t for t in (a, h) if rest[t] == 0)
        games.append(dict(game_id=f"{a}@{h}", espn_id=int(s.game_id), tip=tip.strftime("%Y-%m-%dT%H:%M:%SZ"),
                          time_et=tet.strftime("%-I:%M %p"), matchup=f"{a} @ {h}", away=a, home=h,
                          away_name=names.get(a, (a, a))[0], home_name=names.get(h, (h, h))[0],
                          away_record=ar.get("total", ""), home_record=hr.get("total", ""),
                          records=f"{ar.get('total', '')} · {hr.get('total', '')}",
                          away_road=ar.get("road", ""), home_home=hr.get("home", ""), espn_records=" · ".join(sched_rec),
                          away_rest=rest[a], home_rest=rest[h], b2b=b2b, tv=tv))
    games.sort(key=lambda g: (g["tip"], g["game_id"]))
    write(out, "games_base.json", games)

    # ---- standings by record (finish can apply official seeds from Sportradar)
    st = TS[["team", "name", "conf", "w", "l"]].copy()
    st["pct"] = (st.w / (st.w + st.l)).round(3)
    st = st.sort_values(["conf", "pct", "w", "team"], ascending=[True, False, False, True])
    st["seed"] = st.groupby("conf").cumcount() + 1
    write(out, "standings_base.json", clean(st.to_dict("records")))

    meta.update(teams=len(TS), players=len(PS), box_rows=len(box), tonight=len(games), season_games=int(T.game_id.nunique()))
    write(out, "meta.json", meta)
    print(json.dumps(meta, indent=1))


# ================================================================ DIGEST
DIGEST_KEYS = [("efg", "eFG%"), ("opp_efg", "opponent eFG%"), ("tov_pct", "turnover %"),
               ("opp_tov_pct", "forced turnover %"), ("orb_pct", "offensive rebound %"), ("drb_pct", "defensive rebound %"),
               ("ftr", "free throw rate"), ("opp_ftr", "opponent free throw rate"), ("fg3_pct", "3PT%"),
               ("fg3m_pg", "3PM per game"), ("opp_fg3_pct", "opponent 3PT%"), ("paint_pg", "paint points"),
               ("opp_paint_pg", "opponent paint points"), ("fb_pg", "fast-break points"), ("bench_ppg", "bench points"),
               ("pace", "pace"), ("l5_net", "last-5 net rating")]


def digest(out):
    import difflib
    rd = lambda n, d=None: json.load(open(os.path.join(out, n))) if os.path.exists(os.path.join(out, n)) else d
    meta = rd("meta.json", {})
    games = rd("games_base.json", [])
    TS = rd("team_season.json", [])
    ts = {t["team"]: t for t in TS}
    ps = rd("player_season.json", [])
    odds = rd("odds.json", {})
    inj = rd("injuries.json", [])
    results = rd("results_base.json", [])
    box = rd("box_players.json", [])
    comp = rd("box_compare.json", [])
    pidx = {(r["team"], r["player"]): r for r in ps}
    status = {(i.get("team"), i.get("player")): i.get("status") for i in inj}
    f1 = lambda v: "n/a" if v is None else f"{v:.1f}"
    sg = lambda v: "n/a" if v is None else f"{v:+.1f}"
    pmt = lambda v: "n/a" if v is None else f"{v:+d}"
    L = []
    p = L.append

    def line_txt(b):
        where = "vs" if b["game_id"].endswith("@" + b["team"]) else "at"
        avg = f" | season avg before: {f1(b.get('avg_pts'))} pts, {f1(b.get('avg_reb'))} reb, {f1(b.get('avg_ast'))} ast" if b.get("gp_before") else ""
        return (f"{b['player']} {b['team']} {where} {b['opp']}: {b['pts']} pts, {b['reb']} reb, {b['ast']} ast, {b['stl']} stl, "
                f"{b['blk']} blk, {b['tov']} tov, FG {b['fg']}, 3PT {b['tp']}, FT {b['ft']}, {b['min']} min, +/- {pmt(b.get('pm'))}"
                f"{avg}" + (f" | {b['flags']}" if b.get("flags") else ""))

    p(f"NBA DIGEST  tonight {meta.get('today')}  last night {meta.get('yesterday')}")
    p("Ranks are out of 30 teams, 1 = best (pace 1 = fastest). Ratings are points per 100 possessions.")
    for n in meta.get("notes", []):
        p("Note: " + n)
    if meta.get("last_night_missing"):
        p(f"WARNING: last night's games missing from the data (ESPN ids): {meta['last_night_missing']}")
    if not odds:
        p("WARNING: odds.json not found, so lines and win odds are left out below")
    if not inj:
        p("WARNING: injuries.json not found or empty, so injuries are left out below")

    # ---- league
    p("")
    p("LEAGUE")
    p("Unbeaten (3+ games): " + (", ".join(f"{t['team']} {t['w']}-{t['l']}" for t in TS if t["l"] == 0 and t["w"] >= 3) or "none"))
    p("Winless (3+ games): " + (", ".join(f"{t['team']} {t['w']}-{t['l']}" for t in TS if t["w"] == 0 and t["l"] >= 3) or "none"))
    by_net = sorted(TS, key=lambda t: -(t["net"] or 0))
    p("Best net rating: " + ", ".join(f"{t['team']} {sg(t['net'])} ({t['w']}-{t['l']})" for t in by_net[:5]))
    p("Worst net rating: " + ", ".join(f"{t['team']} {sg(t['net'])} ({t['w']}-{t['l']})" for t in by_net[-5:][::-1]))
    p("Best offense: " + ", ".join(f"{t['team']} {f1(t['ortg'])}" for t in sorted(TS, key=lambda t: t["ortg_rk"])[:3])
      + " | Best defense: " + ", ".join(f"{t['team']} {f1(t['drtg'])}" for t in sorted(TS, key=lambda t: t["drtg_rk"])[:3])
      + " | Fastest pace: " + ", ".join(f"{t['team']} {f1(t['pace'])}" for t in sorted(TS, key=lambda t: t["pace_rk"])[:3]))
    streaks = sorted([t for t in TS if t.get("streak") and int(t["streak"][1:]) >= 4], key=lambda t: -int(t["streak"][1:]))
    p("Streaks of 4+: " + (", ".join(f"{t['team']} {t['streak']}" for t in streaks) or "none"))
    wpct = {t["team"]: t["w"] / max(t["gp"], 1) for t in TS}
    rec_rk = {t: 1 + sum(1 for u in wpct if wpct[u] > wpct[t]) for t in wpct}
    odd = [f"{t['team']} {t['w']}-{t['l']} (record #{rec_rk[t['team']]}, net rating #{t['net_rk']})"
           for t in TS if abs(t["net_rk"] - rec_rk[t["team"]]) >= 10]
    p("Record and net rating far apart (10+ spots): " + ("; ".join(odd) or "none"))
    rot = [r for r in ps if (r["mpg"] or 0) >= 20 and r["gp"] >= 3]
    p("Top scorers (3+ games): " + ", ".join(f"{r['player']} {r['team']} {f1(r['ppg'])}" for r in sorted(rot, key=lambda r: -(r["ppg"] or 0))[:6]))
    p("Best +/- per game (20+ mpg, 3+ games): " + ", ".join(f"{r['player']} {r['team']} {sg(r['pm_pg'])}" for r in sorted(rot, key=lambda r: -(r["pm_pg"] or 0))[:6]))

    # ---- tonight
    p("")
    p(f"TONIGHT: {len(games)} games")
    for g in games:
        a, h = g["away"], g["home"]
        o = odds.get(g["game_id"], {})
        bits = [g["game_id"], f"{g['time_et']} ET", f"TV {g['tv']}"]
        bits.append(f"line {o['line']}" if o.get("line") else "no line yet")
        if o.get("total") is not None:
            bits.append(f"total {o['total']}")
        if o.get("away_wp") is not None and o.get("home_wp") is not None:
            bits.append(f"win odds {a} {o['away_wp']}% / {h} {o['home_wp']}%")
        p("")
        p(" | ".join(bits))
        for t, side in ((a, "away"), (h, "home")):
            s = ts.get(t)
            rest = g.get(side + "_rest")
            rest_txt = "NO REST (played last night)" if rest == 0 else ("first game" if rest is None else f"{rest} day{'' if rest == 1 else 's'} rest")
            split = f"road {g['away_road']}" if side == "away" else f"home {g['home_home']}"
            if not s:
                p(f"  {t}: no games this season")
                continue
            p(f"  {t} {s['w']}-{s['l']} ({split}, last 5 {s['l5_rec']}, streak {s['streak'] or 'none'}), {rest_txt}. Net {sg(s['net'])} #{s['net_rk']}, "
              f"offense {f1(s['ortg'])} #{s['ortg_rk']}, defense {f1(s['drtg'])} #{s['drtg_rk']}, pace {f1(s['pace'])} #{s['pace_rk']}, last-5 net {sg(s['l5_net'])}")
        A, H = ts.get(a), ts.get(h)
        if A and H:
            p(f"  Offense vs defense: {a} offense #{A['ortg_rk']} vs {h} defense #{H['drtg_rk']}; {h} offense #{H['ortg_rk']} vs {a} defense #{A['drtg_rk']}")
            big = [f"{label} {a} {f1(A[k])} #{A[k + '_rk']} vs {h} {f1(H[k])} #{H[k + '_rk']}"
                   for k, label in DIGEST_KEYS if A.get(k + "_rk") is not None and H.get(k + "_rk") is not None and abs(A[k + "_rk"] - H[k + "_rk"]) >= 15]
            p("  Big rank gaps (15+ spots): " + ("; ".join(big) or "none"))
        for t in (a, h):
            miss, parts = 0.0, []
            for i in [i for i in inj if i.get("team") == t]:
                s = pidx.get((t, i.get("player")))
                if s and i.get("status") in ("Out", "Doubtful"):
                    miss += s["ppg"] or 0
                if s:
                    parts.append(f"{i['player']} {i['status']} ({f1(s['ppg'])} ppg, {f1(s['mpg'])} mpg, {sg(s['pm_pg'])} +/- per game)")
                else:
                    near = difflib.get_close_matches(str(i.get("player")), [r["player"] for r in ps if r["team"] == t], n=1, cutoff=0.8)
                    parts.append(f"{i.get('player')} {i.get('status')} (no games for {t} this season"
                                 + (f"; NAME CHECK: the box scores spell a {t} player '{near[0]}'" if near else "") + ")")
            p(f"  {t} injuries, {miss:.1f} season PPG listed Out or Doubtful: " + ("; ".join(parts) or "none listed"))
        for t in (a, h):
            team_rot = [r for r in ps if r["team"] == t and (r["mpg"] or 0) >= 15]
            tag = lambda r: f" [{status[(t, r['player'])]}]" if (t, r["player"]) in status else ""
            pms = sorted(team_rot, key=lambda r: -(r["pm_pg"] or 0))
            if team_rot:
                p(f"  {t} top scorers: " + ", ".join(f"{r['player']} {f1(r['ppg'])}{tag(r)}" for r in sorted(team_rot, key=lambda r: -(r["ppg"] or 0))[:3])
                  + " | best +/- per game: " + ", ".join(f"{r['player']} {sg(r['pm_pg'])}{tag(r)}" for r in pms[:2])
                  + " | worst: " + f"{pms[-1]['player']} {sg(pms[-1]['pm_pg'])}{tag(pms[-1])}")

    # ---- last night
    p("")
    p(f"LAST NIGHT: {len(results)} games")
    for r in results:
        a, h = r["away"], r["home"]
        ws, ls = max(r["away_score"], r["home_score"]), min(r["away_score"], r["home_score"])
        loser = h if r["winner"] == a else a
        lose_lead = r["away_max_lead"] if loser == a else r["home_max_lead"]
        bits = [r["game_id"], f"{r['winner']} won {ws}-{ls}" + ((" in OT" if r["ot"] == 1 else f" in {r['ot']}OT") if r["ot"] else ""),
                f"quarters {r['periods'] or 'not available'}", f"largest leads {a} {r['away_max_lead']}, {h} {r['home_max_lead']}", f"lead changes {r['lead_changes']}"]
        if r.get("upset"):
            bits.append("UPSET (winner had the worse record)")
        if lose_lead >= 10:
            bits.append(f"COMEBACK ({loser} led by {lose_lead} and lost)")
        p("")
        p(" | ".join(bits))
        gaps = sorted([c for c in comp if c["game_id"] == r["game_id"] and c.get("level")], key=lambda c: -c["z"])
        p("  Biggest team-stat gaps: " + ("; ".join(f"{c['stat']} {c['away']} {c['away_txt']}, {c['home']} {c['home_txt']} ({c['level']})" for c in gaps[:5]) or "none"))
        rows = [b for b in box if b["game_id"] == r["game_id"] and not b["dnp"]]
        for b in sorted([b for b in rows if b.get("flags") or b["pts"] >= 20], key=lambda b: -b["pts"])[:6]:
            p("  " + line_txt(b))
        pm = sorted([b for b in rows if b.get("pm") is not None], key=lambda b: -b["pm"])
        if pm:
            p("  Best +/-: " + ", ".join(f"{b['player']} {b['team']} {pmt(b['pm'])}" for b in pm[:2])
              + " | Worst +/-: " + ", ".join(f"{b['player']} {b['team']} {pmt(b['pm'])}" for b in pm[-2:][::-1]))
        dnp = [b for b in box if b["game_id"] == r["game_id"] and b["dnp"] and b.get("reason") and "coach" not in b["reason"].lower()]
        if dnp:
            p("  Did not play: " + ", ".join(f"{b['player']} {b['team']} ({b['reason']})" for b in dnp))
    played = [b for b in box if not b["dnp"]]
    if played:
        p("")
        p("TOP LINES LAST NIGHT (by points, plus any 15+ reb, 10+ ast, 5+ stl or blk, or triple-double)")
        top = sorted(played, key=lambda b: -b["pts"])[:10]
        extra = [b for b in played if b not in top and (b["reb"] >= 15 or b["ast"] >= 10 or b["stl"] >= 5 or b["blk"] >= 5 or "Triple" in (b.get("flags") or ""))]
        for b in top + extra:
            p("  " + line_txt(b))
    text = "\n".join(L) + "\n"
    with open(os.path.join(out, "digest.txt"), "w") as fh:
        fh.write(text)
    print(text)


# ================================================================ FINISH
def finish(out):
    rd = lambda n, d=None: json.load(open(os.path.join(out, n))) if os.path.exists(os.path.join(out, n)) else d
    games = rd("games_base.json")
    odds = rd("odds.json", {})
    ed = rd("editorial.json", {})
    inj = rd("injuries.json", [])
    results = rd("results_base.json")
    stand = rd("standings_base.json")
    srs = rd("sr_standings.json")
    errs = []
    for g in games:
        o = odds.get(g["game_id"], {})
        for k in ("line", "spread_abs", "total", "away_wp", "home_wp"):
            g[k] = o.get(k)
        aw, hw = g["away_wp"], g["home_wp"]
        if aw is not None and hw is not None:
            g["fav"], g["fav_wp"] = (g["away"], aw) if aw >= hw else (g["home"], hw)
        else:
            g["fav"], g["fav_wp"] = None, None
        e = (ed.get("games") or {}).get(g["game_id"], {})
        g["watch"], g["tag"], g["note"] = e.get("watch"), e.get("tag", ""), e.get("note", "")
    for r in results:
        r["note"] = (ed.get("results") or {}).get(r["game_id"], r.get("note", ""))
    if srs:
        seeds = {s["team"]: s["seed"] for s in srs}
        if set(seeds) == {s["team"] for s in stand}:
            for s in stand:
                s["seed"] = seeds[s["team"]]
    brief = ed.get("brief") or []
    if not any(b.get("kind") == "date" for b in brief):  # add the two date rows when the editorial file leaves them out
        meta = rd("meta.json", {})
        day = lambda s: (lambda d: f"{d.strftime('%A, %b')} {d.day}")(dt.date.fromisoformat(s))
        if meta.get("today") and meta.get("yesterday"):
            brief = [dict(kind="date", order=0, title="Tonight", text=day(meta["today"])),
                     dict(kind="date", order=1, title="Last night", text=day(meta["yesterday"]))] + brief
    write(out, "games.json", games)
    write(out, "results.json", results)
    write(out, "standings.json", stand)
    write(out, "brief.json", brief)

    # checks
    ts = rd("team_season.json")
    if len({t["team"] for t in ts}) != 30:
        errs.append("team_season does not have 30 teams")
    if len({s["team"] for s in stand}) != 30:
        errs.append("standings does not have 30 teams")
    warns = []
    sr_rec = {s["team"]: f"{s['w']}-{s['l']}" for s in (srs or []) if "w" in s and "l" in s}
    for g in games:
        if g["away"] not in CODES or g["home"] not in CODES:
            errs.append(f"bad team code {g['game_id']}")
        for side in ("away", "home"):
            if sr_rec and sr_rec.get(g[side]) != g[side + "_record"]:
                warns.append(f"record differs from Sportradar for {g[side]}: box scores {g[side + '_record']}, Sportradar {sr_rec.get(g[side])} (a game may be missing)")
        if g.get("espn_records") and g["espn_records"] != g["records"]:
            warns.append(f"ESPN schedule shows {g['espn_records']} for {g['game_id']}, box scores give {g['records']}")
        if g["watch"] is not None and g["watch"] not in range(1, 7):
            errs.append(f"watch rank out of range {g['game_id']}")
        if g["fav_wp"] is not None and not 0 <= g["fav_wp"] <= 100:
            errs.append(f"win odds out of range {g['game_id']}")
    for r in results:
        if not r["periods"]:
            warns.append(f"no period scores for {r['game_id']} (box score came from a patch without a line score)")
            continue
        a = [int(p.split("-")[0]) for p in r["periods"].split(",")]
        h = [int(p.split("-")[1]) for p in r["periods"].split(",")]
        if sum(a) != r["away_score"] or sum(h) != r["home_score"]:
            errs.append(f"period scores do not add up {r['game_id']}")
    box = rd("box_players.json")
    bt = {(b["game_id"], b["team"]): b for b in rd("box_teams.json")}
    tot = {}
    for b in box:
        if not b["dnp"]:
            tot[(b["game_id"], b["team"])] = tot.get((b["game_id"], b["team"]), 0) + b["pts"]
    for k, v in tot.items():
        if k in bt and bt[k]["pts"] != v:
            errs.append(f"player points do not add up to the team score {k}")
    gids = {g["game_id"] for g in games}
    seen = set()
    for i in inj:
        if i.get("game_id") not in gids:
            errs.append(f"injury row for a team not playing tonight: {i.get('team')} {i.get('player')}")
        if i.get("status") not in ("Out", "Doubtful", "Questionable", "Probable", "Day-to-day"):
            errs.append(f"bad status {i.get('player')}: {i.get('status')}")
        key = (i.get("team"), i.get("player"))
        if key in seen:
            errs.append(f"duplicate injury row {key}")
        seen.add(key)
    kinds = [b.get("kind") for b in brief]
    if kinds.count("date") != 2 or kinds.count("headline") != 1:
        errs.append("brief needs two date rows and one headline")
    print(json.dumps(dict(games=len(games), results=len(results), injuries=len(inj), errors=errs, warnings=warns), indent=1))
    if errs:
        sys.exit(1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["base", "digest", "finish"])
    ap.add_argument("--out", default="nba_out")
    ap.add_argument("--date")
    ap.add_argument("--drop", type=int, nargs="*", default=[], help=argparse.SUPPRESS)
    a = ap.parse_args()
    if a.phase == "base":
        base(a.out, a.date, tuple(a.drop))
    elif a.phase == "digest":
        digest(a.out)
    else:
        finish(a.out)
