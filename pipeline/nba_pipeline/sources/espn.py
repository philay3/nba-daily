"""ESPN's public JSON endpoints (unofficial and undocumented: shapes can change without notice).

- Game summary: boxscore, pickcenter odds, predictor win odds, header line score.
- Injuries: every team's injury list.

Fetch one URL at a time, add a cache-buster (`cb`), and parse defensively: a missing key
means "no data", never a crash.
"""
from __future__ import annotations

import datetime as dt
import difflib
import re
import unicodedata

import httpx

from nba_pipeline.config import ESPN_INJURIES, ESPN_SUMMARY, ET
from nba_pipeline.sources import get_with_retry
from nba_pipeline.teams import CODES, code
from nba_pipeline.util import num

STATUSES = ("Out", "Doubtful", "Questionable", "Probable", "Day-to-day")
SEVERITY = {"Out": 0, "Doubtful": 1, "Questionable": 2, "Day-to-day": 3, "Probable": 4}


def cache_buster() -> str:
    return dt.datetime.now(ET).strftime("%Y%m%d%H%M")


def fetch_summary(client: httpx.Client, gid: int) -> dict | None:
    r = get_with_retry(client, ESPN_SUMMARY, params={"event": gid, "cb": cache_buster()}, tries=2)
    return r.json() if r is not None else None


def fetch_injuries(client: httpx.Client) -> dict | None:
    r = get_with_retry(client, ESPN_INJURIES, params={"cb": cache_buster()}, tries=2)
    return r.json() if r is not None else None


# ------------------------------------------------------------------ odds

def map_line(details) -> str | None:
    """'GS -4.5' -> 'GSW -4.5'; 'EVEN' stays; anything unparseable is kept as ESPN wrote it."""
    if details is None or str(details).strip() == "":
        return None
    s = str(details).strip()
    if s.upper() in ("EVEN", "PK", "PICK"):
        return "EVEN"
    parts = s.split()
    if len(parts) == 2 and code(parts[0]) in CODES:
        return f"{code(parts[0])} {parts[1]}"
    return s


def implied(ml) -> float | None:
    v = num(ml)
    if v is None or v == 0:
        return None
    return 100.0 / (v + 100.0) if v > 0 else -v / (-v + 100.0)


def odds_from_summary(js: dict) -> dict:
    """First pickcenter provider (usually DraftKings): line, spread, total, moneylines and win odds."""
    out = dict(provider=None, line=None, spread_abs=None, total=None, away_ml=None, home_ml=None,
               away_wp=None, home_wp=None, wp_source=None)
    pcs = js.get("pickcenter") or []
    if pcs:
        pc = pcs[0]
        out["provider"] = (pc.get("provider") or {}).get("name")
        out["line"] = map_line(pc.get("details"))
        spread = num(pc.get("spread"))
        if out["line"] == "EVEN":
            out["spread_abs"] = 0.0
        elif out["line"] is not None and spread is not None:
            out["spread_abs"] = abs(spread)
        out["total"] = num(pc.get("overUnder"))
        aml, hml = (pc.get("awayTeamOdds") or {}).get("moneyLine"), (pc.get("homeTeamOdds") or {}).get("moneyLine")
        out["away_ml"] = int(num(aml)) if num(aml) is not None else None
        out["home_ml"] = int(num(hml)) if num(hml) is not None else None
    out.update(win_odds(js, out["away_ml"], out["home_ml"]))
    return out


def win_odds(js: dict, away_ml=None, home_ml=None) -> dict:
    """ESPN's predictor (BPI) when posted, else the no-vig split of the moneylines, else nothing."""
    pred = js.get("predictor") or {}
    a = num((pred.get("awayTeam") or {}).get("gameProjection"))
    h = num((pred.get("homeTeam") or {}).get("gameProjection"))
    if a is not None and h is not None and a + h > 0:
        return dict(away_wp=round(a, 1), home_wp=round(h, 1), wp_source="espn_predictor")
    pa, ph = implied(away_ml), implied(home_ml)
    if pa is not None and ph is not None:
        away = round(100.0 * pa / (pa + ph), 1)
        return dict(away_wp=away, home_wp=round(100.0 - away, 1), wp_source="moneyline")
    return dict(away_wp=None, home_wp=None, wp_source=None)


# ------------------------------------------------------------------ injuries

def normalize_name(name: str) -> str:
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[.'’]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"[^a-z]+", " ", s).strip()


def short_position(p) -> str:
    p = str(p or "").upper().split("-")[0].strip()
    if p in ("PG", "SG", "G"):
        return "G"
    if p in ("SF", "PF", "F"):
        return "F"
    return "C" if p == "C" else ""


def espn_status(raw) -> str:
    s = str(raw or "").strip().lower()
    if "suspen" in s or s.startswith("out"):
        return "Out"
    if "doubt" in s:
        return "Doubtful"
    if "question" in s:
        return "Questionable"
    if "probable" in s:
        return "Probable"
    return "Day-to-day"


_DESIG = [("Doubtful", r"\bdoubtful\b"), ("Questionable", r"\bquestionable\b"), ("Probable", r"\bprobable\b"),
          ("Out", r"\b(ruled out|won't play|will not play|will miss|is out|out for|remains out|sidelined for)\b")]


def game_day_status(comment: str, game_day: dt.date, tonight: bool = True) -> str | None:
    """'X is questionable for Monday's game' for a Monday game -> 'Questionable'. None when the comment says
    nothing about that game. "Tonight" counts only when the game is tonight (the report's own date)."""
    if not comment:
        return None
    day = game_day.strftime("%A").lower()
    for sentence in re.split(r"(?<=[.!?])\s+", str(comment)):
        s = sentence.lower()
        if day not in s and not (tonight and "tonight" in s):
            continue
        for status, pattern in _DESIG:
            if re.search(pattern, s):
                return status
    return None


def _team_of(team_obj: dict, item: dict, by_name: dict[str, str], by_espn_id: dict[str, str]) -> str | None:
    for cand in (team_obj.get("abbreviation"), (team_obj.get("team") or {}).get("abbreviation"),
                 ((item.get("athlete") or {}).get("team") or {}).get("abbreviation")):
        if cand and code(cand) in CODES:
            return code(cand)
    for cand in (team_obj.get("displayName"), (team_obj.get("team") or {}).get("displayName")):
        if cand and cand in by_name:
            return by_name[cand]
    tid = str(team_obj.get("id") or "")
    return by_espn_id.get(tid)


def _return_note(ret: dt.date | None, tonight: dt.date) -> str:
    if ret is None:
        return ""
    if (ret - tonight).days > 30:
        return f"~{ret.strftime('%B')}"
    return f"~{ret.strftime('%b')} {ret.day}"


def parse_injuries(js: dict, tonight: dt.date, games: list[dict], by_name: dict[str, str] | None = None,
                   by_espn_id: dict[str, str] | None = None, roster: dict[str, list[str]] | None = None) -> list[dict]:
    """ESPN injuries JSON -> rows for teams playing in `games`, in the dashboard's injuries.json shape plus extras.

    games: the games ahead (tonight's, or the whole look-ahead) as dicts with code, away, home, tip (ISO), id and
           optionally game_date (default: tonight). Each row points at its team's next game in that list, and a
           game-day designation is read for that game's day.
    roster: team -> box-score names; an injury name that matches one after normalizing accents,
            punctuation and suffixes takes the box-score spelling (what the digest calls a NAME CHECK).
    """
    by_name = by_name or {}
    by_espn_id = by_espn_id or {}
    roster = roster or {}
    playing: dict[str, dict] = {}
    for g in sorted(games, key=lambda g: (g.get("game_date") or tonight.isoformat(), g.get("tip") or "")):
        playing.setdefault(g["away"], g)
        playing.setdefault(g["home"], g)
    rows, seen = [], set()
    for team_obj in js.get("injuries") or []:
        for item in team_obj.get("injuries") or []:
            team = _team_of(team_obj, item, by_name, by_espn_id)
            if team not in playing:
                continue
            ath = item.get("athlete") or {}
            name = str(ath.get("displayName") or "").strip()
            if not name:
                continue
            norm = normalize_name(name)
            matches = [n for n in roster.get(team, []) if normalize_name(n) == norm]
            if len(matches) == 1:
                name = matches[0]
            key = (team, name)
            if key in seen:
                continue
            seen.add(key)
            details = item.get("details") or {}
            comment = item.get("shortComment") or item.get("longComment") or ""
            raw_status = item.get("status") or (item.get("type") or {}).get("description") or ""
            suspended = "suspen" in str(raw_status).lower() or "suspen" in str(details.get("type", "")).lower()
            g = playing[team]
            gday = dt.date.fromisoformat(g["game_date"]) if g.get("game_date") else tonight
            status = "Out" if suspended else (game_day_status(comment, gday, gday == tonight) or espn_status(raw_status))
            injury = "Suspension" if suspended else str(details.get("type") or details.get("location") or "").strip()
            if not injury and re.search(r"\brest\b", str(comment).lower()):
                injury = "Rest"
            ret = None
            if details.get("returnDate"):
                try:
                    ret = dt.date.fromisoformat(str(details["returnDate"])[:10])
                except ValueError:
                    ret = None
            detail = str(details.get("detail") or "").strip()
            if detail.lower() in ("not specified", "other", "unknown"):
                detail = ""
            note = "; ".join(x for x in (detail, _return_note(ret, tonight)) if x)
            rows.append(dict(game_id=g["code"], team=team, player=name,
                             pos=short_position((ath.get("position") or {}).get("abbreviation")),
                             status=status, injury=injury, note=note,
                             return_date=ret.isoformat() if ret else None, espn_status=str(raw_status),
                             game_espn_id=g.get("id"), _date=gday.isoformat(), _tip=g.get("tip") or "",
                             _away=team == g["away"]))
    rows.sort(key=lambda r: (r["_date"], r["_tip"], r["game_id"], not r["_away"], SEVERITY.get(r["status"], 9), r["player"]))
    for r in rows:
        r.pop("_date"), r.pop("_tip"), r.pop("_away")
    return rows


def name_check(player: str, team_names: list[str]) -> str | None:
    """Closest box-score spelling for an injury name (used by the digest's NAME CHECK)."""
    near = difflib.get_close_matches(str(player), team_names, n=1, cutoff=0.8)
    return near[0] if near else None
