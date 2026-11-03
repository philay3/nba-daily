"""Regenerate the golden files after a deliberate change to the engine. This is not a test.

    cd pipeline && python3 -I tests/regen_golden.py

It runs the fixture day in memory, like the parity tests, and rewrites the ten dashboard files and digest.txt in
fixtures/golden_2026-11-02. meta.json, the *_base.json files and inputs/ stay as they are. Then it prints every
field that changed, so the change can be checked and explained in docs/DECISIONS.md.

Never run it just to make a failing parity test pass.
"""
from __future__ import annotations

import json
from collections import Counter

from nba_pipeline.config import FIXTURES_DIR
from nba_pipeline.export import TEN, write_files
from nba_pipeline.run import SEED_DATE, run_day

GOLDEN = FIXTURES_DIR / "golden_2026-11-02"


def changed_fields(old: list[dict], new: list[dict]) -> tuple[Counter, Counter]:
    """Rows are compared in order. Returns (field -> rows changed, row "key" -> rows changed, for box_compare)."""
    fields, keys = Counter(), Counter()
    for a, b in zip(old, new):
        diff = [k for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]
        fields.update(diff)
        if diff and "key" in b:
            keys[b["key"]] += 1
    return fields, keys


def main() -> None:
    before = {name: json.loads((GOLDEN / f"{name}.json").read_text()) for name in TEN}
    digest_before = (GOLDEN / "digest.txt").read_text()
    result = run_day(SEED_DATE, source_dir=FIXTURES_DIR / "hoopr_2026-11-02", inputs_dir=GOLDEN / "inputs",
                     use_espn=False, offline=True, write=False)
    if result.errors:
        raise SystemExit(f"the fixture day has check errors: {result.errors}")
    write_files(result.files, GOLDEN)
    (GOLDEN / "digest.txt").write_text(result.digest)

    for name in TEN:
        old, new = before[name], result.files[name]
        if old == new:
            print(f"{name}.json: unchanged")
            continue
        if len(old) != len(new):
            print(f"{name}.json: {len(old)} rows before, {len(new)} now")
        fields, keys = changed_fields(old, new)
        print(f"{name}.json: " + ", ".join(f"{k} ({n} rows)" for k, n in sorted(fields.items())))
        if keys:
            print("    only in rows with key: " + ", ".join(f"{k} ({n})" for k, n in sorted(keys.items())))
    print("digest.txt: " + ("unchanged" if digest_before == result.digest else "changed, check git diff"))


if __name__ == "__main__":
    main()
