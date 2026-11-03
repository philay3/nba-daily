"""Editorial: games to watch, tags, notes, result notes, headline and surprises.

A provider returns a dict in the original editorial.json shape:
  {"games": {GAME_CODE: {"watch": 1-6 | None, "tag": "...", "note": "..."}},
   "results": {GAME_CODE: "..."},
   "brief": [{"kind": "headline" | "surprise", "order": n, "title": "...", "text": "..."}]}

The pipeline always adds the two date rows ("Tonight" and "Last night") when the brief leaves them out.

TODO(claude-api): add a ClaudeEditorial provider that sends the digest fact sheet (nba_pipeline.digest)
plus the rules in docs/DATA.md ("Editorial rules") to the Claude API and parses the JSON it returns.
Keep the numbers checkable: every number in a note must appear in the digest. Read the key from
ANTHROPIC_API_KEY and fall back to NoopEditorial when it is missing.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Protocol


class EditorialProvider(Protocol):
    name: str

    def write(self, day: dt.date, digest_text: str, files: dict) -> dict: ...


class NoopEditorial:
    """Default: no picks or notes. The web app falls back to data-driven ordering and copy."""
    name = "none"

    def write(self, day: dt.date, digest_text: str, files: dict) -> dict:
        return {"games": {}, "results": {}, "brief": []}


class FileEditorial:
    """editorial.json written by hand (or by the old Claude task)."""
    name = "file"

    def __init__(self, data: dict | None = None, path: Path | None = None):
        self.data = data if data is not None else json.loads(Path(path).read_text())

    def write(self, day: dt.date, digest_text: str, files: dict) -> dict:
        return self.data


def date_text(day: dt.date) -> str:
    return f"{day.strftime('%A, %b')} {day.day}"


def editorial_rows(day: dt.date, ed: dict, source: str) -> list[dict]:
    """editorial.json -> rows for the editorial table, with the date rows the engine's finish step adds."""
    rows = []
    for code, e in (ed.get("games") or {}).items():
        rows.append(dict(date=day.isoformat(), kind="game", ref=code, seq=0, sort_order=0, watch=e.get("watch"),
                         tag=e.get("tag") or "", title="", text=e.get("note") or "", source=source))
    for code, note in (ed.get("results") or {}).items():
        rows.append(dict(date=day.isoformat(), kind="result", ref=code, seq=0, sort_order=0, watch=None, tag="",
                         title="", text=note or "", source=source))
    brief = list(ed.get("brief") or [])
    if not any(b.get("kind") == "date" for b in brief):
        yday = day - dt.timedelta(days=1)
        brief = [dict(kind="date", order=0, title="Tonight", text=date_text(day)),
                 dict(kind="date", order=1, title="Last night", text=date_text(yday))] + brief
        date_source = "engine"
    else:
        date_source = source
    for seq, b in enumerate(brief):
        rows.append(dict(date=day.isoformat(), kind=b.get("kind", "surprise"), ref=str(seq), seq=seq,
                         sort_order=int(b.get("order") or 0), watch=None, tag="", title=b.get("title") or "",
                         text=b.get("text") or "", source=date_source if b.get("kind") == "date" else source))
    return rows
