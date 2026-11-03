# Reference: the prototype

Kept for provenance. Nothing here runs in the app.

- `nba_build.py`: the original stats engine (Python, pandas). `pipeline/nba_pipeline/compute.py` is a port of its `base` phase, `digest.py` of `digest`, and `checks.py` plus `export.py` of `finish`. The golden files in `pipeline/fixtures/golden_2026-11-02` are this script's output for 2026-11-02, plus the deliberate fixes in `docs/DECISIONS.md`. So far there is one: the script reads ESPN's `turnoverPoints` as points scored, but it is points conceded, so points off turnovers are swapped between the two teams. The script itself is left as it was.
- `dashboard.html`: the Claude dashboard page the engine fed. `python -m nba_pipeline export-json` writes the ten JSON files it reads (games, results, box_players, box_teams, box_compare, team_season, player_season, injuries, standings, brief).
