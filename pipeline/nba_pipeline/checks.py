"""Consistency checks from the original engine's `finish` step, run on the dashboard files of a day."""
from __future__ import annotations

from nba_pipeline.sources.espn import STATUSES
from nba_pipeline.teams import CODES


def run_checks(files: dict, sr_standings: list | None = None, editorial_supplied: bool = True) -> tuple[list[str], list[str]]:
    errs: list[str] = []
    warns: list[str] = []
    games, results, stand = files["games"], files["results"], files["standings"]
    ts, inj, brief = files["team_season"], files["injuries"], files["brief"]

    # The engine treated these as errors; in an unattended pipeline they are warnings, because the
    # first days of a season legitimately have teams without a game yet.
    for name, rows in (("team_season", ts), ("standings", stand)):
        n = len({t["team"] for t in rows})
        if n != 30:
            warns.append(f"{name} has {n} teams, not 30 (expected only in the first days of a season)")
    sr_rec = {s["team"]: f"{s['w']}-{s['l']}" for s in (sr_standings or []) if "w" in s and "l" in s}
    for g in games:
        if g["away"] not in CODES or g["home"] not in CODES:
            errs.append(f"bad team code {g['game_id']}")
        for side in ("away", "home"):
            if sr_rec and sr_rec.get(g[side]) != g[side + "_record"]:
                warns.append(f"record differs from Sportradar for {g[side]}: box scores {g[side + '_record']}, "
                             f"Sportradar {sr_rec.get(g[side])} (a game may be missing)")
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
    bt = {(b["game_id"], b["team"]): b for b in files["box_teams"]}
    tot: dict = {}
    for b in files["box_players"]:
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
        if i.get("status") not in STATUSES:
            errs.append(f"bad status {i.get('player')}: {i.get('status')}")
        key = (i.get("team"), i.get("player"))
        if key in seen:
            errs.append(f"duplicate injury row {key}")
        seen.add(key)
    kinds = [b.get("kind") for b in brief]
    if kinds.count("date") != 2 or kinds.count("headline") != 1:
        msg = "brief needs two date rows and one headline"
        (errs if editorial_supplied else warns).append(msg if editorial_supplied else msg + " (no editorial provider ran)")
    return errs, warns
