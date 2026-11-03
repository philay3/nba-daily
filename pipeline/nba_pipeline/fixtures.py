"""record-fixtures: save live ESPN responses so new parser tests can run offline.

Run it at home (ESPN blocks many cloud IPs): it saves, for the date and the night before,
  summary_<id>.json   each game's ESPN summary (box score, pickcenter odds, predictor)
  patch_<id>.json     the same game in PATCH FORMAT when it is final
  odds_<date>.json    what the pipeline would store from those summaries
  injuries_<date>.json  ESPN's injuries JSON as returned
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from nba_pipeline.config import REGULAR_SEASON, season_for
from nba_pipeline.sources import http_client
from nba_pipeline.sources.espn import fetch_injuries, fetch_summary, odds_from_summary
from nba_pipeline.sources.hoopr import read_season, season_paths
from nba_pipeline.sources.patch import summary_to_patch
from nba_pipeline.sources.raw import is_completed


def record_fixtures(day: dt.date, out: Path, source_dir: Path | None = None) -> dict:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    _, _, sc = read_season(season_paths(season_for(day), source_dir))
    sc = sc[sc.season_type == REGULAR_SEASON].copy()
    sc["game_date"] = sc["game_date"].astype(str)
    dates = {day.isoformat(), (day - dt.timedelta(days=1)).isoformat()}
    ids = [int(g) for g in sc[sc.game_date.isin(dates)].game_id]
    saved: dict[str, list[str] | str] = {"summaries": [], "patches": []}
    odds = {}
    with http_client() as client:
        for gid in ids:
            js = fetch_summary(client, gid)
            if js is None:
                continue
            (out / f"summary_{gid}.json").write_text(json.dumps(js))
            saved["summaries"].append(str(gid))
            odds[str(gid)] = odds_from_summary(js)
            try:
                if is_completed(js):
                    (out / f"patch_{gid}.json").write_text(json.dumps(summary_to_patch(js)))
                    saved["patches"].append(str(gid))
            except (KeyError, IndexError, ValueError):
                pass
        (out / f"odds_{day.isoformat()}.json").write_text(json.dumps(odds, indent=1))
        inj = fetch_injuries(client)
        if inj is not None:
            (out / f"injuries_{day.isoformat()}.json").write_text(json.dumps(inj))
            saved["injuries"] = f"injuries_{day.isoformat()}.json"
    return saved
