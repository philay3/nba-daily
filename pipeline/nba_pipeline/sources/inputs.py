"""Hand-made inputs in the original engine's file formats (what `--inputs DIR` reads).

  odds.json          {GAME_CODE: {"line", "spread_abs", "total", "away_wp", "home_wp"}}
  injuries.json      [{"game_id", "team", "player", "pos", "status", "injury", "note"}]
  editorial.json     {"games": {GAME_CODE: {"watch", "tag", "note"}}, "results": {GAME_CODE: "..."}, "brief": [...]}
  sr_standings.json  [{"team", "seed", "w"?, "l"?}]  official conference seeds
  patch_<id>.json    PATCH FORMAT box scores for games the mirrors do not have yet
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Inputs:
    odds: dict | None = None
    injuries: list | None = None
    editorial: dict | None = None
    sr_standings: list | None = None
    patches: dict[int, dict] = field(default_factory=dict)


def _read(path: Path):
    return json.loads(path.read_text()) if path.exists() else None


def read_inputs(folder: Path | None) -> Inputs:
    if folder is None:
        return Inputs()
    folder = Path(folder)
    if not folder.is_dir():
        raise SystemExit(f"inputs folder not found: {folder}")
    patches = {}
    for p in sorted(folder.glob("patch_*.json")):
        data = json.loads(p.read_text())
        patches[int(data["game_id"])] = data
    return Inputs(odds=_read(folder / "odds.json"), injuries=_read(folder / "injuries.json"),
                  editorial=_read(folder / "editorial.json"), sr_standings=_read(folder / "sr_standings.json"),
                  patches=patches)
