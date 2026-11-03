"""hoopR mirror of ESPN data: three season box-score files, plus the season's play-by-play and an optional shot
file, or a local directory with the same names."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from nba_pipeline.config import CACHE_DIR, HOOPR_DATA
from nba_pipeline.sources import get_with_retry, http_client

FILES = {
    "pb": "player_box/parquet/player_box_{season}.parquet",
    "tb": "team_box/parquet/team_box_{season}.parquet",
    "sc": "schedules/parquet/nba_schedule_{season}.parquet",
}
PBP = "pbp/parquet/play_by_play_{season}.parquet"


def file_names(season: int) -> dict[str, str]:
    return {k: Path(rel.format(season=season)).name for k, rel in FILES.items()}


def season_paths(season: int, source_dir: Path | None = None, cache_dir: Path = CACHE_DIR) -> dict[str, Path]:
    """Local paths of the three season files: from source_dir, or freshly downloaded into the cache."""
    if source_dir is not None:
        paths = {k: Path(source_dir) / name for k, name in file_names(season).items()}
        missing = [str(p) for p in paths.values() if not p.exists()]
        if missing:
            raise SystemExit(f"missing season files in {source_dir}: {', '.join(missing)}")
        return paths
    out = Path(cache_dir) / "hoopr" / str(season)
    out.mkdir(parents=True, exist_ok=True)
    paths = {}
    with http_client() as client:
        for key, rel in FILES.items():
            url = f"{HOOPR_DATA}/{rel.format(season=season)}"
            r = get_with_retry(client, url)
            if r is None:
                raise SystemExit(f"could not download {url}")
            p = out / Path(rel.format(season=season)).name
            p.write_bytes(r.content)
            paths[key] = p
    return paths


def read_season(paths: dict[str, Path]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    return pd.read_parquet(paths["pb"]), pd.read_parquet(paths["tb"]), pd.read_parquet(paths["sc"])


# One row per shot of the season, free throws included (built from ESPN's play-by-play). Optional: a run
# carries on without it, because the box scores do not depend on it.
SHOTS = "shots/parquet/shots_{season}.parquet"


def shots_path(season: int, source_dir: Path | None = None, cache_dir: Path = CACHE_DIR) -> Path | None:
    """The season's shot file from source_dir, or freshly downloaded into the cache. None when there is none."""
    name = Path(SHOTS.format(season=season)).name
    if source_dir is not None:
        p = Path(source_dir) / name
        return p if p.exists() else None
    out = Path(cache_dir) / "hoopr" / str(season)
    out.mkdir(parents=True, exist_ok=True)
    with http_client() as client:
        r = get_with_retry(client, f"{HOOPR_DATA}/{SHOTS.format(season=season)}")
    if r is None:
        return None
    p = out / name
    p.write_bytes(r.content)
    return p


def read_shots(path: Path | None) -> pd.DataFrame | None:
    return pd.read_parquet(path) if path is not None else None


def pbp_path(season: int, source_dir: Path | None = None, cache_dir: Path = CACHE_DIR) -> Path | None:
    """The season's play-by-play file (about 20 MB by the end of a season): from source_dir when it holds one,
    otherwise downloaded. None when there is none, and the run carries on without the play-by-play tables."""
    name = Path(PBP.format(season=season)).name
    if source_dir is not None:
        p = Path(source_dir) / name
        return p if p.exists() else None
    out = Path(cache_dir) / "hoopr" / str(season)
    out.mkdir(parents=True, exist_ok=True)
    with http_client() as client:
        r = get_with_retry(client, f"{HOOPR_DATA}/{PBP.format(season=season)}")
    if r is None:
        return None
    p = out / name
    p.write_bytes(r.content)
    return p
