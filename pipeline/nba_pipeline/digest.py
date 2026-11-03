"""The fact sheet: a port of the original engine's `digest` phase.

Plain text for writing picks, tags, notes and surprises (and for the future Claude editorial
provider): league leaders and streaks; every game tonight with records, rest, ratings and ranks,
big rank gaps, line, win odds, injuries with each player's season numbers and the scoring each
team is missing; every game last night with quarters, leads, comebacks, the biggest team-stat
gaps, standout lines, plus-minus and who did not play.
"""
from __future__ import annotations

import datetime as dt
import difflib

from nba_pipeline.export import dashboard_files

DIGEST_KEYS = [("efg", "eFG%"), ("opp_efg", "opponent eFG%"), ("tov_pct", "turnover %"),
               ("opp_tov_pct", "forced turnover %"), ("orb_pct", "offensive rebound %"), ("drb_pct", "defensive rebound %"),
               ("ftr", "free throw rate"), ("opp_ftr", "opponent free throw rate"), ("fg3_pct", "3PT%"),
               ("fg3m_pg", "3PM per game"), ("opp_fg3_pct", "opponent 3PT%"), ("paint_pg", "paint points"),
               ("opp_paint_pg", "opponent paint points"), ("fb_pg", "fast-break points"), ("bench_ppg", "bench points"),
               ("pace", "pace"), ("l5_net", "last-5 net rating")]


def render_digest(tables: dict, files: dict | None = None) -> str:
    files = files or dashboard_files(tables)
    day: dt.date = tables["day"]
    meta = dict(today=day.isoformat(), yesterday=(day - dt.timedelta(days=1)).isoformat(),
                notes=tables["meta"].get("notes") or [], last_night_missing=tables["meta"].get("last_night_missing") or [])
    games = files["games"]
    TS = files["team_season"]
    ts = {t["team"]: t for t in TS}
    ps = files["player_season"]
    odds = {r["game_code"]: r for r in tables["odds"]}
    inj = files["injuries"]
    results = files["results"]
    box = files["box_players"]
    comp = files["box_compare"]
    pidx = {(r["team"], r["player"]): r for r in ps}
    status = {(i.get("team"), i.get("player")): i.get("status") for i in inj}
    f1 = lambda v: "n/a" if v is None else f"{v:.1f}"  # noqa: E731
    sg = lambda v: "n/a" if v is None else f"{v:+.1f}"  # noqa: E731
    pmt = lambda v: "n/a" if v is None else f"{v:+d}"  # noqa: E731
    L: list[str] = []
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
            tag = lambda r: f" [{status[(t, r['player'])]}]" if (t, r["player"]) in status else ""  # noqa: E731
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
    return "\n".join(L) + "\n"
