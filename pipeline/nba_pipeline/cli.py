"""Command line: python -m nba_pipeline <command> ...

  run              build a day and load it into Postgres
  digest           print the fact sheet for a day
  export-json      write the ten dashboard JSON files for a day (from the database)
  seed             load the bundled fixture day (2026-11-02) with its golden inputs, offline
  record-fixtures  save live ESPN responses for tests (run at home; ESPN is not reachable in CI)
  migrate          apply web/drizzle migrations
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

from nba_pipeline.config import FIXTURES_DIR, today_et


def _date(s: str) -> dt.date:
    try:
        return dt.date.fromisoformat(s)
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"not a date (YYYY-MM-DD): {s}") from e


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="nba_pipeline", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="build a day and load it into Postgres")
    run.add_argument("--date", type=_date, default=None, help="tonight's date (default: today in New York)")
    run.add_argument("--season", type=int, default=None, help="ESPN season year, e.g. 2027 for 2026-27 (default: from --date)")
    run.add_argument("--source-dir", type=Path, default=None,
                     help="read player_box/team_box/schedule parquet files from DIR instead of downloading")
    run.add_argument("--inputs", type=Path, default=None,
                     help="DIR with odds.json, injuries.json, editorial.json, sr_standings.json and patch_<id>.json files")
    run.add_argument("--no-espn", action="store_true", help="skip ESPN odds and injuries fetches")
    run.add_argument("--offline", action="store_true", help="no network at all (implies --no-espn; no raw-mirror fallback)")
    run.add_argument("--dry-run", action="store_true", help="compute and check, but do not write to the database")

    dg = sub.add_parser("digest", help="print the fact sheet for a day (from the database)")
    dg.add_argument("--date", type=_date, default=None)
    dg.add_argument("--out", type=Path, default=None, help="also write it to this file")

    ex = sub.add_parser("export-json", help="write the ten dashboard JSON files for a day (from the database)")
    ex.add_argument("--date", type=_date, default=None)
    ex.add_argument("--out", type=Path, required=True)

    sd = sub.add_parser("seed", help="load the bundled fixture day with its golden inputs (offline)")
    sd.add_argument("--fixtures", type=Path, default=FIXTURES_DIR)
    sd.add_argument("--no-migrate", action="store_true", help="do not apply migrations first")

    rf = sub.add_parser("record-fixtures", help="save live ESPN responses (summaries, injuries) for tests")
    rf.add_argument("--date", type=_date, default=None)
    rf.add_argument("--out", type=Path, required=True)
    rf.add_argument("--source-dir", type=Path, default=None, help="schedule parquet dir (default: download the mirror)")

    sub.add_parser("migrate", help="apply web/drizzle migrations to DATABASE_URL")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "migrate":
        from nba_pipeline.db import connect, migrate
        with connect() as conn:
            applied = migrate(conn)
        print(f"migrations applied: {applied or 'none (up to date)'}")
        return 0
    if args.command == "run":
        from nba_pipeline.run import run_day
        result = run_day(date=args.date or today_et(), season=args.season, source_dir=args.source_dir,
                         inputs_dir=args.inputs, use_espn=not (args.no_espn or args.offline),
                         offline=args.offline, write=not args.dry_run, command="run")
        print(json.dumps(result.summary(), indent=1))
        return 1 if result.errors else 0
    if args.command == "seed":
        from nba_pipeline.run import seed
        result = seed(args.fixtures, migrate_first=not args.no_migrate)
        print(json.dumps(result.summary(), indent=1))
        return 1 if result.errors else 0
    if args.command == "digest":
        from nba_pipeline.db import connect
        from nba_pipeline.digest import render_digest
        from nba_pipeline.export import read_tables
        day = args.date or today_et()
        with connect() as conn:
            text = render_digest(read_tables(conn, day))
        if args.out:
            args.out.write_text(text)
        sys.stdout.write(text)
        return 0
    if args.command == "export-json":
        from nba_pipeline.db import connect
        from nba_pipeline.export import dashboard_files, read_tables, write_files
        day = args.date or today_et()
        with connect() as conn:
            files = dashboard_files(read_tables(conn, day))
        write_files(files, args.out)
        print(json.dumps({k: len(v) for k, v in files.items()}, indent=1))
        return 0
    if args.command == "record-fixtures":
        from nba_pipeline.fixtures import record_fixtures
        saved = record_fixtures(args.date or today_et(), args.out, source_dir=args.source_dir)
        print(json.dumps(saved, indent=1))
        return 0
    return 2
