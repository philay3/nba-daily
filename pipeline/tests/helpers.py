"""Constants and comparison helpers shared by the tests."""
from __future__ import annotations

import datetime as dt
import json

from nba_pipeline.config import FIXTURES_DIR

DAY = dt.date(2026, 11, 2)
GOLDEN = FIXTURES_DIR / "golden_2026-11-02"
HOOPR = FIXTURES_DIR / "hoopr_2026-11-02"
INPUTS = GOLDEN / "inputs"
ESPN = FIXTURES_DIR / "espn"
TEN = ["games", "results", "box_players", "box_teams", "box_compare", "team_season", "player_season",
       "injuries", "standings", "brief"]


def golden(name: str):
    return json.loads((GOLDEN / f"{name}.json").read_text())


def same(a, b, path="", tol=0.05):
    """Exact match, except floats may differ by tol. Returns (ok, where)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return (a is b), f"{path}: {a!r} != {b!r}"
    if isinstance(a, float) or isinstance(b, float):
        if a is None or b is None:
            return a is b, f"{path}: {a!r} != {b!r}"
        return abs(a - b) <= tol + 1e-9, f"{path}: {a!r} != {b!r}"
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            return False, f"{path}: keys differ {sorted(set(a) ^ set(b))}"
        for k in a:
            ok, where = same(a[k], b[k], f"{path}.{k}", tol)
            if not ok:
                return False, where
        return True, path
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False, f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            ok, where = same(x, y, f"{path}[{i}]", tol)
            if not ok:
                return False, where
        return True, path
    return a == b, f"{path}: {a!r} != {b!r}"
