"""hoopR's raw per-game mirror: the ESPN summary JSON of each game, usually there before the season files."""
from __future__ import annotations

import httpx

from nba_pipeline.config import HOOPR_RAW
from nba_pipeline.sources import get_with_retry
from nba_pipeline.util import num


def fetch_raw(client: httpx.Client, gid: int) -> dict | None:
    r = get_with_retry(client, f"{HOOPR_RAW}/{gid}.json", tries=2)
    return r.json() if r is not None else None


def is_completed(js: dict) -> bool:
    return bool(js["header"]["competitions"][0]["status"]["type"].get("completed"))


def parse_raw(gid, js, game_date):
    """Turn one ESPN summary json (hoopR raw mirror) into player_box / team_box style rows.

    Ported unchanged from the original engine; extra keys (jersey, short name, ejected,
    team turnovers, technicals) only feed the database.
    """
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
                       starter=bool(a.get("starter")), did_not_play=bool(a.get("didNotPlay")), reason=a.get("reason") or "",
                       ejected=bool(a.get("ejected")), athlete_jersey=a["athlete"].get("jersey"),
                       athlete_short_name=a["athlete"].get("shortName"))
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
                         lead_changes=num(s.get("leadChanges")), team_turnovers=num(s.get("teamTurnovers")),
                         technical_fouls=num(s.get("technicalFouls")), flagrant_fouls=num(s.get("flagrantFouls"))))
    ls = {c["homeAway"]: [int(float(x.get("value", x.get("displayValue", 0)))) for x in c.get("linescores", [])] for c in comp["competitors"]}
    periods = list(zip(ls.get("away", []), ls.get("home", [])))
    return prow, trow, periods
