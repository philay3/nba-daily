"""One pipeline run: sources -> compute -> inputs (odds, injuries, editorial, seeds) -> checks -> shots ->
play-by-play -> power ratings and the game model -> load."""
from __future__ import annotations

import datetime as dt
import sys
import traceback
from dataclasses import dataclass, field
from pathlib import Path

from nba_pipeline.checks import run_checks
from nba_pipeline.compute import Build, Fill, compute
from nba_pipeline.config import FIXTURES_DIR, season_for
from nba_pipeline.digest import render_digest
from nba_pipeline.editorial import EditorialProvider, FileEditorial, NoopEditorial, editorial_rows
from nba_pipeline.export import dashboard_files, tables_from_build
from nba_pipeline.model import ModelBuild, build_model, check_model, read_lines
from nba_pipeline.pbp import PbpBuild, compute_pbp, pbp_checks, read_plays
from nba_pipeline.previews import check_previews, preview_rows, upcoming_games
from nba_pipeline.shots import ShotBuild, build_shots
from nba_pipeline.sources import http_client
from nba_pipeline.sources.espn import fetch_injuries, fetch_summary, odds_from_summary, parse_injuries
from nba_pipeline.sources.hoopr import pbp_path, read_season, read_shots, season_paths, shots_path
from nba_pipeline.sources.inputs import Inputs, read_inputs
from nba_pipeline.sources.patch import from_patch
from nba_pipeline.sources.raw import fetch_raw, is_completed, parse_raw

SEED_DATE = dt.date(2026, 11, 2)


@dataclass
class RunResult:
    day: dt.date
    season: int
    build: Build | None = None
    files: dict = field(default_factory=dict)
    digest: str = ""
    odds: list = field(default_factory=list)
    injuries: list = field(default_factory=list)
    editorial: list = field(default_factory=list)
    previews: list = field(default_factory=list)
    shots: ShotBuild | None = None
    counts: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    run_id: int | None = None
    pbp: PbpBuild | None = None
    model: ModelBuild | None = None

    def summary(self) -> dict:
        meta = self.build.meta if self.build else {}
        ck = self.pbp.checks if self.pbp else {}
        pbp = dict(games=ck.get("games"), player_games=ck.get("player_games"),
                   minutes_off_by_more_than_1=len(ck.get("minutes_off", [])), plus_minus_differs=ck.get("pm_off"),
                   repaired_team_periods=ck.get("repaired"), not_in_box=len(ck.get("not_in_box", []))) if ck else None
        return dict(date=self.day.isoformat(), season=self.season, run_id=self.run_id,
                    tonight=meta.get("tonight"), last_night_games=meta.get("last_night_games"),
                    last_night_missing=meta.get("last_night_missing"), missing_games=meta.get("missing_games"),
                    notes=meta.get("notes"), shots=self.shots.meta if self.shots else None, play_by_play=pbp,
                    model=self.model.backtest[0] if self.model and self.model.backtest else None,
                    counts=self.counts, errors=self.errors, warnings=self.warnings)


# ------------------------------------------------------------------ missing games

def make_filler(patches: dict[int, dict], client):
    """PATCH files first (they are deliberate), then the raw per-game mirror."""
    def fill(gid: int, game_date: str) -> Fill | None:
        p = patches.get(gid)
        if p is not None:
            try:
                pr, tr, per, nper = from_patch(p, game_date)
                return Fill(pr, tr, per, nper, "patch", f"game {gid} added from an ESPN page patch")
            except Exception as e:  # noqa: BLE001
                print(f"patch failed {gid}: {e}", file=sys.stderr)
        if client is None:
            return None
        js = fetch_raw(client, gid)
        if js is None:
            return None
        try:
            if is_completed(js):
                pr, tr, per = parse_raw(gid, js, game_date)
                return Fill(pr, tr, per, None, "raw", f"game {gid} added from the raw per-game mirror")
        except Exception as e:  # noqa: BLE001
            print(f"raw parse failed {gid}: {e}", file=sys.stderr)
        return None
    return fill


# ------------------------------------------------------------------ inputs -> rows

def odds_rows_from_file(day: dt.date, odds: dict, tonight: list[dict]) -> list[dict]:
    by_code = {g["code"]: g for g in tonight}
    rows = []
    for code_, o in odds.items():
        g = by_code.get(code_)
        if g is None:
            continue
        rows.append(dict(snapshot_date=day.isoformat(), game_id=g["id"], game_code=code_, provider=None,
                         line=o.get("line"), spread_abs=o.get("spread_abs"), total=o.get("total"), away_ml=None,
                         home_ml=None, away_wp=o.get("away_wp"), home_wp=o.get("home_wp"),
                         wp_source="input" if o.get("away_wp") is not None else None, source="file"))
    return rows


def odds_rows_from_espn(day: dt.date, games: list[dict], client) -> tuple[list[dict], list[str]]:
    """Lines for every game in the look-ahead (tonight first). A game days away may have no line yet."""
    rows, notes = [], []
    for g in sorted(games, key=lambda g: (g["game_date"], g["tip"], g["code"])):
        js = fetch_summary(client, g["id"])  # one ESPN request at a time
        if js is None:
            notes.append(f"no ESPN summary for {g['code']} ({g['id']}, {g['game_date']}), so no line")
            continue
        o = odds_from_summary(js)
        rows.append(dict(snapshot_date=day.isoformat(), game_id=g["id"], game_code=g["code"], provider=o["provider"],
                         line=o["line"], spread_abs=o["spread_abs"], total=o["total"], away_ml=o["away_ml"],
                         home_ml=o["home_ml"], away_wp=o["away_wp"], home_wp=o["home_wp"], wp_source=o["wp_source"],
                         source="espn"))
    return rows, notes


def injury_rows_from_file(day: dt.date, injuries: list, tonight: list[dict], player_season: list[dict]) -> list[dict]:
    by_code = {g["code"]: g for g in tonight}
    pid = {(r["team_code"], r["name"]): r["player_id"] for r in player_season}
    rows, seen = [], set()
    for i, r in enumerate(injuries):
        key = (r["team"], r["player"])
        if key in seen:  # the checks report duplicates; the table keeps the first
            continue
        seen.add(key)
        g = by_code.get(r.get("game_id"))
        rows.append(dict(snapshot_date=day.isoformat(), team_code=r["team"], player_name=r["player"],
                         player_id=pid.get(key), game_id=g["id"] if g else None, game_code=r.get("game_id"),
                         position=r.get("pos") or "", status=r["status"], injury=r.get("injury") or "",
                         note=r.get("note") or "", return_date=None, sort_order=i, source="file"))
    return rows


def injury_rows_from_espn(day: dt.date, upcoming: list[dict], build: Build, client) -> tuple[list[dict], list[str]]:
    """ESPN's report for every team playing in the look-ahead; each row points at the team's next game."""
    js = fetch_injuries(client)
    if js is None:
        return [], ["ESPN injuries could not be fetched; injuries left empty for this date"]
    games = [dict(code=g["code"], away=g["away_code"], home=g["home_code"], tip=g["tip"], id=g["id"],
                  game_date=g["game_date"]) for g in upcoming]
    by_name = {t["display_name"]: t["code"] for t in build.teams}
    by_id = {str(t["espn_id"]): t["code"] for t in build.teams if t.get("espn_id") is not None}
    roster: dict[str, list[str]] = {}
    for r in build.player_season:
        roster.setdefault(r["team_code"], []).append(r["name"])
    parsed = parse_injuries(js, day, games, by_name, by_id, roster)
    pid = {(r["team_code"], r["name"]): r["player_id"] for r in build.player_season}
    rows = [dict(snapshot_date=day.isoformat(), team_code=r["team"], player_name=r["player"],
                 player_id=pid.get((r["team"], r["player"])), game_id=r["game_espn_id"], game_code=r["game_id"],
                 position=r["pos"], status=r["status"], injury=r["injury"], note=r["note"],
                 return_date=r["return_date"], sort_order=i, source="espn") for i, r in enumerate(parsed)]
    return rows, []


def apply_official_seeds(build: Build, sr_standings: list | None) -> None:
    if not sr_standings:
        return
    seeds = {s["team"]: s["seed"] for s in sr_standings}
    if set(seeds) == {r["team_code"] for r in build.team_season}:
        for r in build.team_season:
            r["seed"], r["seed_source"] = int(seeds[r["team_code"]]), "official"


# ------------------------------------------------------------------ the run

def run_day(date: dt.date, season: int | None = None, source_dir: Path | None = None, inputs_dir: Path | None = None,
            use_espn: bool = True, offline: bool = False, write: bool = True, command: str = "run",
            editorial_provider: EditorialProvider | None = None, database_url: str | None = None) -> RunResult:
    season = season or season_for(date)
    result = RunResult(day=date, season=season)
    conn = run_id = None
    args = dict(date=date.isoformat(), season=season, source_dir=str(source_dir) if source_dir else None,
                inputs=str(inputs_dir) if inputs_dir else None, use_espn=use_espn, offline=offline)
    if write:
        from nba_pipeline.db import connect
        from nba_pipeline.load import start_run
        conn = connect(database_url, autocommit=True)
        run_id = start_run(conn, date, season, command, args)
        result.run_id = run_id
    try:
        _run(result, date, season, source_dir, read_inputs(inputs_dir), use_espn, offline, editorial_provider)
        if conn is not None:
            from nba_pipeline.load import finish_run, load_build
            with conn.transaction():
                result.counts = load_build(conn, result.build, result.odds, result.injuries, result.editorial,
                                           previews=result.previews, shots=result.shots, pbp=result.pbp,
                                           model=result.model)
            finish_run(conn, run_id, "error" if result.errors else "ok", result.counts, result.build.meta.get("notes"),
                       result.warnings, result.errors)
    except BaseException as e:
        if conn is not None and run_id is not None:
            from nba_pipeline.load import finish_run
            finish_run(conn, run_id, "error", notes=result.build.meta.get("notes") if result.build else None,
                       error="".join(traceback.format_exception_only(type(e), e)).strip())
        raise
    finally:
        if conn is not None:
            conn.close()
    return result


def _run(result: RunResult, date: dt.date, season: int, source_dir: Path | None, inputs: Inputs, use_espn: bool,
         offline: bool, provider: EditorialProvider | None) -> None:
    pb, tb, sc = read_season(season_paths(season, source_dir))
    client = None if offline else http_client()
    try:
        build = compute(pb, tb, sc, date, season, fill_missing=make_filler(inputs.patches, client))
        result.build = build
        tonight = [g for g in build.games if g["game_date"] == date.isoformat()]
        upcoming = upcoming_games(build)  # tonight, tomorrow and the day after
        notes = build.meta["notes"]
        covered: set[int] = set()  # games the injury report speaks for

        if inputs.odds is not None:
            result.odds = odds_rows_from_file(date, inputs.odds, tonight)
        elif use_espn and client is not None and upcoming:
            result.odds, extra = odds_rows_from_espn(date, upcoming, client)
            notes += extra
        if inputs.injuries is not None:
            result.injuries = injury_rows_from_file(date, inputs.injuries, tonight, build.player_season)
            covered = {g["id"] for g in tonight}
        elif use_espn and client is not None and upcoming:
            result.injuries, extra = injury_rows_from_espn(date, upcoming, build, client)
            notes += extra
            if not extra:
                covered = {g["id"] for g in upcoming}
    finally:
        if client is not None:
            client.close()
    apply_official_seeds(build, inputs.sr_standings)
    result.previews = preview_rows(build, result.injuries, covered)

    # editorial reads the fact sheet, so build the files once without it, then again with it
    provider = provider or (FileEditorial(inputs.editorial) if inputs.editorial is not None else NoopEditorial())
    tables = tables_from_build(build, result.odds, result.injuries, editorial_rows(date, {}, "engine"))
    digest_text = render_digest(tables)
    ed = provider.write(date, digest_text, dashboard_files(tables))
    result.editorial = editorial_rows(date, ed, provider.name)
    tables = tables_from_build(build, result.odds, result.injuries, result.editorial)
    result.files = dashboard_files(tables)
    result.digest = render_digest(tables, result.files)
    result.errors, result.warnings = run_checks(result.files, inputs.sr_standings,
                                                editorial_supplied=provider.name != "none")
    errs, warns = check_previews(build, result.previews, result.odds)
    result.errors += errs
    result.warnings += warns
    # shots are optional: a missing or unreadable file, or a game without shots, is a warning, and the box scores
    # load either way (the shot tables keep what they had)
    try:
        result.shots = build_shots(read_shots(shots_path(season, source_dir)), build)
    except Exception as e:  # noqa: BLE001
        result.shots = ShotBuild(available=False, notes=[f"the shot file could not be read ({type(e).__name__}: {e}), "
                                                         "so the shot tables were left as they were"])
    result.warnings += [f"shots: {n}" for n in result.shots.notes]
    path = pbp_path(season, source_dir)
    play_by_play(result, build, path)
    game_model(result, build, path)


def game_model(result: RunResult, build: Build, pbp_file: Path | None) -> None:
    """Power ratings for every date so far, projections for the next 3 days, and the backtest against ESPN's pregame
    line (read from the play-by-play file). Without that file the backtest has no line to compare."""
    try:
        lines = read_lines(pbp_file)
    except Exception as e:  # noqa: BLE001
        lines = {}
        result.warnings.append(f"model: ESPN's pregame lines could not be read ({type(e).__name__}: {e})")
    result.model = build_model(build, lines, result.odds)
    build.meta["notes"] += result.model.notes
    errs, warns = check_model(result.model, build)
    result.errors += errs
    result.warnings += warns


def play_by_play(result: RunResult, build: Build, path: Path | None) -> None:
    """Game flow, runs, clutch, lineups and on/off from the season's play-by-play. A separate step: without the file
    the play-by-play tables keep their last run, and a failure here still lets the box scores load."""
    if path is None:
        build.meta["notes"].append("no play-by-play file for this season; the play-by-play tables were left as they were")
        return
    try:
        result.pbp = compute_pbp(read_plays(path), build)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        result.errors.append(f"play-by-play: the step failed: {type(e).__name__}: {e}")
        return
    errs, warns = pbp_checks(result.pbp)
    result.errors += errs
    result.warnings += warns


def seed(fixtures: Path = FIXTURES_DIR, migrate_first: bool = True, database_url: str | None = None) -> RunResult:
    """Load the bundled fixture day (hoopR files as downloaded 2026-11-02 + the golden inputs), no network."""
    if migrate_first:
        from nba_pipeline.db import connect, migrate
        with connect(database_url) as conn:
            migrate(conn)
    return run_day(SEED_DATE, source_dir=Path(fixtures) / "hoopr_2026-11-02",
                   inputs_dir=Path(fixtures) / "golden_2026-11-02" / "inputs", use_espn=False, offline=True,
                   command="seed", database_url=database_url)
