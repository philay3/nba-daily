"""Team codes. ESPN writes six teams differently from us; everything is mapped at the source boundary."""
from __future__ import annotations

FIX = {"GS": "GSW", "NY": "NYK", "NO": "NOP", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}
ESPN_CODE = {ours: espn for espn, ours in FIX.items()}
EAST = {"ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"}
WEST = {"DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHX", "POR", "SAC", "SAS", "UTA"}
CODES = EAST | WEST


def code(a) -> str:
    """ESPN abbreviation (or ours) -> our team code."""
    a = str(a).upper()
    return FIX.get(a, a)


def conference(team: str) -> str:
    return "East" if team in EAST else "West"


def hex_color(c) -> str:
    """ESPN gives colors as 'rrggbb'; we store '#rrggbb' (grey when missing)."""
    c = str(c or "").strip().lstrip("#").lower()
    return f"#{c}" if len(c) == 6 and all(ch in "0123456789abcdef" for ch in c) else "#7f8b99"
