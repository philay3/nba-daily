# NBA Daily

Data and graphics for daily NBA videos and posts.

A Python pipeline fills Postgres every morning with every regular-season box score so far (ESPN data through the hoopR mirror), team ratings and four factors with league ranks, player season stats and plus-minus, team-vs-team gap significance, player lines against their pre-game averages, every field goal attempt with its spot and zone, tonight's schedule, odds and injuries. A Next.js app shows it as a daily feed, and a graphics studio exports post-ready PNGs.

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
cp .env.example .env                # DATABASE_URL for the local container; set NEXT_PUBLIC_BRAND_HANDLE too
docker compose up -d db             # Postgres 16 on localhost:5432

python3 -m venv .venv && source .venv/bin/activate
python3 -m pip install -e "pipeline[dev]"
npm --prefix web ci

python3 -m nba_pipeline migrate     # create the tables
python3 -m nba_pipeline seed        # load the bundled day (2026-11-02), no network needed
npm --prefix web run dev            # open http://localhost:3000
```

The seeded day is Monday, Nov 2, 2026: 15 games that night and 4 the night before. `http://localhost:3000/?date=2026-11-03` shows a day without games (Election Day).

Checks:

```bash
cd pipeline && python3 -m pytest -q && cd ..        # parity with the old engine, parsers, database load
npm --prefix web run typecheck && npm --prefix web run lint && npm --prefix web test && npm --prefix web run build
npm install -g playwright && npx playwright install chromium        # once, for the smoke test
npm --prefix web run start &                                        # or `run dev`
NODE_PATH="$(npm root -g)" npm --prefix web run smoke               # every page and graphic, PNG export sizes
```

Live data for a day (downloads the hoopR mirror and ESPN odds and injuries):

```bash
python3 -m nba_pipeline run --date 2026-11-03
```

The `Makefile` wraps the same commands: `make db-up migrate seed web`, `make run DATE=2026-11-03`, `make check`.

## Pages

- `/` Today: games to watch, the full slate with lines and missing scoring, a matchup breakdown (season stats ranked, edges, injuries, rotations), last night's results.
- `/games/[id]`: final score, quarter flow, where the game was decided, shot charts for both teams with a zone table against the league, both box scores with plus-minus and big deltas.
- `/teams`, `/teams/[code]`: ratings and four factors on both ends, offense vs defense, net rating; shot profile on offense and defense; team game log and roster.
- `/players`, `/players/[id]`: sortable season table; the season's shot chart and zones; player game log with points and plus-minus trends.
- `/standings`, `/injuries`.
- `/studio`: player game card, matchup preview, league offense vs defense, game recap, shot chart. Each exports a PNG at 1080x1350, 1080x1920 or 1920x1080.

## Pipeline commands

| Command | Does |
| --- | --- |
| `run --date D [--source-dir DIR] [--inputs DIR] [--no-espn] [--season S]` | Build day D: season stats through D-1, last night's games, tonight's slate, odds, injuries, editorial; upsert into Postgres |
| `digest --date D` | Print the plain-text fact sheet used to write picks and notes |
| `export-json --date D --out DIR` | Write the ten dashboard JSON files (same shape as the old Claude dashboard) from the database |
| `seed` | Load the bundled fixture day with its golden inputs |
| `record-fixtures --date D --out DIR` | Save live ESPN responses (summaries, odds, injuries) for new tests |
| `migrate` | Apply `web/drizzle` migrations |

## Screenshots

`docs/screenshots/` has the Today and game pages at 1440 and 390 pixels wide, the Teams page, the shot chart sections of the game, team and player pages (`shots-*.png`), the studio editor, and every studio template at its export size (refresh them with `SCREENSHOTS=1 DATE=2026-11-02 GAME_ID=401909906 PLAYER_ID=3945274 NODE_PATH="$(npm root -g)" npm --prefix web run smoke`).

## Docs

- `docs/DATA.md`: sources, refresh timing, caveats.
- `docs/DEPLOY.md`: Neon + Vercel + GitHub Actions, step by step, with costs.
- `docs/DECISIONS.md`: why the stack looks the way it does.
- `AGENTS.md`: architecture, conventions and rules for coding agents.

No NBA or team logos and no player photos are used anywhere: team codes, names and colors only.
