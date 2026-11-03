# NBA Daily

Data and graphics for daily NBA videos and posts.

A Python pipeline fills Postgres every morning with every regular-season box score so far (ESPN data through the hoopR mirror), team ratings and four factors with league ranks, player season stats and plus-minus, team-vs-team gap significance, player lines against their pre-game averages, tonight's schedule, odds and injuries. A Next.js app shows it as a daily feed, and a graphics studio exports post-ready PNGs.

| Path | What it is |
| --- | --- |
| `pipeline/` | Python package `nba_pipeline`: sources, stats engine, Postgres loader, digest, JSON export, tests |
| `web/` | Next.js App Router app (TypeScript, Drizzle, D3) and the `/studio` graphics templates |
| `web/drizzle/` | SQL migrations generated from `web/src/db/schema.ts` |
| `pipeline/fixtures/` | One real day of data (2026-11-02) plus the old engine's golden output, used by tests and `seed` |
| `docs/` | Decisions, data sources, deploy guide, screenshots |

## Quick start

Requirements: Docker (for Postgres), Node 22, Python 3.11 or newer.

```bash
git clone https://github.com/philay3/nba-daily.git
cd nba-daily
cp .env.example .env
docker compose up -d db

python3 -m pip install -e "pipeline[dev]"
npm --prefix web ci

python3 -m nba_pipeline migrate     # create the tables
python3 -m nba_pipeline seed        # load the bundled day (2026-11-02), no network needed
npm --prefix web run dev            # open http://localhost:3000
```

Live data for a day (downloads the hoopR mirror and ESPN odds and injuries):

```bash
python3 -m nba_pipeline run --date 2026-11-03
```

The `Makefile` wraps the same commands: `make db-up migrate seed web`, `make run DATE=2026-11-03`, `make check`.

## Pages

- `/` Today: games to watch, the full slate with lines and missing scoring, a matchup breakdown (season stats ranked, edges, injuries, rotations), last night's results.
- `/games/[id]`: final score, quarter flow, where the game was decided, both box scores with plus-minus and big deltas.
- `/teams`, `/teams/[code]`: ratings and four factors on both ends, offense vs defense, net rating; team game log and roster.
- `/players`, `/players/[id]`: sortable season table; player game log with points and plus-minus trends.
- `/standings`, `/injuries`.
- `/studio`: player game card, matchup preview, league offense vs defense, game recap. Each exports a PNG at 1080x1350, 1080x1920 or 1920x1080.

## Pipeline commands

| Command | Does |
| --- | --- |
| `run --date D [--source-dir DIR] [--inputs DIR] [--no-espn] [--season S]` | Build day D: season stats through D-1, last night's games, tonight's slate, odds, injuries, editorial; upsert into Postgres |
| `digest --date D` | Print the plain-text fact sheet used to write picks and notes |
| `export-json --date D --out DIR` | Write the ten dashboard JSON files (same shape as the old Claude dashboard) from the database |
| `seed` | Load the bundled fixture day with its golden inputs |
| `record-fixtures --date D --out DIR` | Save live ESPN responses (summaries, odds, injuries) for new tests |
| `migrate` | Apply `web/drizzle` migrations |

## Docs

- `docs/DATA.md`: sources, refresh timing, caveats.
- `docs/DEPLOY.md`: Neon + Vercel + GitHub Actions, step by step, with costs.
- `docs/DECISIONS.md`: why the stack looks the way it does.
- `AGENTS.md`: architecture, conventions and rules for coding agents.

No NBA or team logos and no player photos are used anywhere: team codes, names and colors only.
