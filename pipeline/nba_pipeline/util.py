"""Small numeric helpers, identical to the original engine's."""
from __future__ import annotations

import math
import re


def r1(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 1)


def num(x):
    try:
        v = float(x)
        return None if math.isnan(v) else v
    except (TypeError, ValueError):
        return None


def pct(a, b):
    return None if not b else 100.0 * a / b


def as_int(x):
    v = num(x)
    return None if v is None else int(v)


def clean(rows):
    """JSON-safe: NaN -> None, numpy -> python."""
    out = []
    for r in rows:
        d = {}
        for k, v in r.items():
            if hasattr(v, "item"):
                v = v.item()
            if isinstance(v, float) and math.isnan(v):
                v = None
            d[k] = v
        out.append(d)
    return out


def periods_of(s):
    """hoopR stores linescores as the repr of a list of dicts; pull the 'value' fields."""
    return [int(float(v)) for v in re.findall(r"'value': ([0-9.]+)", str(s))]


def records_of(s):
    return dict(re.findall(r"'type': '(\w+)', 'summary': '(\d+-\d+)'", str(s)))
