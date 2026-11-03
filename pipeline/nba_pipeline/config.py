"""Paths, constants and environment for the pipeline."""
from __future__ import annotations

import datetime as dt
import os
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

PACKAGE_DIR = Path(__file__).resolve().parent
PIPELINE_DIR = PACKAGE_DIR.parent
REPO_ROOT = PIPELINE_DIR.parent
FIXTURES_DIR = PIPELINE_DIR / "fixtures"
MIGRATIONS_DIR = Path(os.environ.get("NBA_MIGRATIONS_DIR", REPO_ROOT / "web" / "drizzle"))
CACHE_DIR = Path(os.environ.get("NBA_CACHE_DIR", REPO_ROOT / ".cache"))

# hoopR mirror of ESPN data (rebuilt daily around 07:00 UTC and on raw-repo pushes)
HOOPR_DATA = "https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba"
HOOPR_RAW = "https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-raw/main/nba/json/raw"

# ESPN's public (unofficial, undocumented) JSON endpoints
ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
ESPN_INJURIES = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"

USER_AGENT = "nba-daily-pipeline/0.1 (+https://github.com/philay3/nba-daily)"

REGULAR_SEASON = 2


def load_dotenv(path: Path | None = None) -> None:
    """Load KEY=value lines from the repo-root .env without overriding the real environment."""
    path = path or REPO_ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


def database_url(required: bool = True) -> str | None:
    load_dotenv()
    url = os.environ.get("DATABASE_URL") or None
    if required and not url:
        raise SystemExit("DATABASE_URL is not set (copy .env.example to .env, or export it)")
    return url


def today_et() -> dt.date:
    return dt.datetime.now(ET).date()


def season_for(day: dt.date) -> int:
    """ESPN season year: the 2026-27 season is 2027 (August starts the next season)."""
    return day.year + 1 if day.month >= 8 else day.year
