"""hoopR mirror of ESPN box scores: three season parquet files, or a local directory with the same names."""
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
