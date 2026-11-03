# Cloud session tasks

Ready-made tasks for Claude Code cloud sessions. Start a session on this repo and paste:

> Read docs/cloud-tasks.md. Do the "Every task" setup, then do Task N. Commit in small chunks and open a pull request with screenshots of anything new on screen.

Order: Task 0 first and merge it. Tasks 1, 2 and 3 can run at the same time. Tasks 4 and 5 are better after Task 3 (history) is merged. Task 6 can run any time after Task 0.

Every task adds tables, and drizzle-kit numbers migrations in order, so merge one pull request at a time. After a merge, tell the next session: "Rebase on main and regenerate your migration with npm --prefix web run db:generate."

## Every task: setup and rules

Setup in the cloud VM (PostgreSQL 16 is installed but not running, and there is no `.env` yet):

```bash
service postgresql start
su postgres -c "psql -c \"CREATE ROLE nba LOGIN SUPERUSER PASSWORD 'nba'\"" || true
su postgres -c "createdb -O nba nba_daily" || true
[ -f .env ] || cp .env.example .env
python3 -m pip install -e "pipeline[dev]"
npm --prefix web ci
python3 -m nba_pipeline migrate
python3 -m nba_pipeline seed
cd pipeline && python3 -m pytest -q && cd ..
```

Rules:
- Read AGENTS.md first and follow it.
- Data comes from the hoopR mirror on raw.githubusercontent.com, which cloud sessions can reach. ESPN is blocked in cloud sessions, so ESPN code is tested on fixtures only.
- Production is Neon's free plan: 1 GB per project. Never store raw play-by-play in Postgres. Store what you compute from it.
- Every new table goes in `web/src/db/schema.ts` with a generated migration.
- Keep the parity tests passing. If a task changes a formula on purpose, regenerate the golden files and say why in docs/DECISIONS.md. `cd pipeline && python3 -I tests/regen_golden.py` rewrites them and lists every field that changed.
- Every number you add needs a test or a check against an independent source.
- UI and graphic text: plain words, short sentences, no em dashes.
- Before opening the pull request: pytest, `npm --prefix web run typecheck`, `npm --prefix web run lint`, `npm --prefix web run build`, and the smoke test. Add screenshots of new pages and graphics to docs/screenshots.

## Task 0: Fix points off turnovers (small, do first)

ESPN's team stat `turnoverPoints` (`turnover_points` in team_box) is labeled "Points Conceded Off Turnovers" in ESPN's own data: it is the points the opponent scored off this team's turnovers. `compute.py` treats it as points this team scored. Swap it at the team-game level, so `pts_off_to` means points scored off the opponent's turnovers and the opponent field means points allowed, everywhere it flows: team_games, team_season and its ranks, game_gaps, export-json, digest, and web labels.

Check: on 2026-11-02, Charlotte committed 27 turnovers against Detroit. After the fix, Detroit shows 37 points off turnovers and Charlotte 9.

This changes the golden files on purpose. Regenerate them, note it in docs/DECISIONS.md, and keep every other parity check unchanged.

## Task 1: Shot charts and shot profiles

Data: `https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba/shots/parquet/shots_{season}.parquet`, one row per shot with game_id, period_number, clock_display_value, team_id, athlete_id_1 (shooter), athlete_id_2 (assister), type_text, scoring_play, score_value, coordinate_x and coordinate_y.

1. Work out the coordinate system from the data: where the rim is, the units, and which half of the court. Document it in docs/DATA.md with a check, for example that layups and dunks cluster at the rim.
2. Load a `shots` table: one row per field goal attempt, no free throws. Derive shot distance, zone (restricted area, paint outside the restricted area, midrange, corner 3, above-the-break 3, backcourt) and an assisted flag.
3. Compute player and team zone profiles: attempts, makes, FG%, points per shot, share of attempts by zone, league average per zone, and for teams the same numbers allowed on defense.
4. Web: a reusable SVG half-court chart with made and missed dots, plus a hexbin view colored by FG% against league average for that zone. Add a zone table with the league comparison. Put it on player pages, team pages (offense and defense) and game pages (both teams).
5. Studio: a new "Shot chart" template at all three sizes.

Tests: zone classification on known coordinates. Shot counts per team and game should match field goal attempts in team_games. Report the gap, since ESPN leaves a few shots without a location.

## Task 2: Play-by-play: game flow, clutch and lineups

Data: `https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba/pbp/parquet/play_by_play_{season}.parquet`, about 600,000 plays a season, with substitutions, clock, scores and team ids. Read it in the pipeline, but store only derived tables.

1. Game flow: the score margin after every scoring play in every game (for a "worm" chart), and the biggest scoring runs (like 12-0) with start and end times.
2. Clutch: the last 5 minutes of the 4th quarter or overtime with the margin within 5. Team and player clutch points, FG%, net rating and plus-minus.
3. Lineups: rebuild who is on the floor from substitutions. When the feed doesn't list period starters, infer them from the players who appear in that period. Every stint must have exactly 5 players per team. Then compute 5-man lineup minutes, possessions, offensive, defensive and net rating, and each player's on/off net rating.
4. Web: worm chart and runs on game pages, top lineups (at least 50 possessions) and an on/off table on team pages, on/off and clutch on player pages.
5. Studio: a "Game flow" template.

Checks: lineup minutes per team per game add up to 240, plus 25 per overtime. Player on-court minutes match box score minutes within a minute.

## Task 3: History and trends

Data: the mirror has player_box, team_box and schedules parquet files back to 2002, for example `.../nba/player_box/parquet/player_box_2016.parquet`.

1. Backfill 2016 through 2026 into the same tables, with a season column everywhere. Add a `backfill --from 2016 --to 2026` command that can be rerun and resumed. Compute season aggregates and ranks for every season.
2. Keep the database well under 1 GB, and report its size after the backfill.
3. Web: a season picker on Teams, Players and Standings. Add a League trends page with one line chart per stat by season: pace, offensive rating, share of shots from three, eFG%, free throw rate and turnover %. Add season-by-season career tables on player pages, and the same by franchise on team pages, using ESPN team ids so moves and renames line up.

Checks: per-season game counts match the schedule's finals. Spot-check 3 players' season averages against the mirror's player_season_stats files.

## Task 4: Power ratings and model vs Vegas

1. Ratings: every day, fit opponent-adjusted offensive and defensive ratings per 100 possessions, using ridge regression on game-level efficiency with a home-court term, shrunk toward league average early in the season. Store a daily snapshot so ratings can be charted over time.
2. Projections for tonight: predicted margin (adjusted net rating difference scaled by expected pace, plus home court and a rest adjustment fitted from data) and win probability (a normal distribution with the spread of outcomes fitted on past seasons).
3. Backtest: play-by-play rows carry ESPN's pregame spread for each game (game_spread, home_favorite, home_team_spread). Compare the model to that line on past seasons and this one: mean absolute error, record against the spread, and calibration of win probability by bins. Store the results.
4. Web: a Ratings page (table plus chart over time), the model's line next to ESPN's on Today and game pages, and a Model page with backtest numbers and a calibration chart.
5. Studio: a "Model vs Vegas" card for one game.

Tests: fits are deterministic on fixtures, and nothing looks ahead: a game's prediction uses only games before it.

## Task 5: Story finder

Turn the data into ranked story ideas every morning.

1. For every player, keep rolling baselines (season and last 10 games: mean and standard deviation).
2. Flag each night's outliers by z-score for points, rebounds, assists, threes, plus-minus and true shooting.
3. Track streaks (consecutive 20-point games, double-doubles, games with 3 or more threes), "first time this season" lines, rare combinations like 30-10-10, and team swings (last 10 games against the season).
4. Score each story by rarity and how prominent the player is (minutes, usage), and store the top 20 per day with the numbers behind each one.
5. Web: a Stories page ranked by score, with filters for player, team and type. Each card links to its evidence (game page, player trend).
6. Studio: a "Story card" template that turns any story into a graphic.

Tests: z-score math on synthetic data, and no "first this season" claim that isn't true.

## Task 6: Stat audit

Before numbers go public, check what every stat means and that it adds up.

1. For each column in team_games, player_games, team_season, player_season and game_gaps: confirm the definition against ESPN's label in the summary fixture and our docs, and confirm the "better" direction used for ranks and edges.
2. Run consistency checks across the season: team totals equal the sum of players for points, rebounds, assists, field goals, threes, free throws and turnovers. Possessions should fall in a normal range, and ratings should rebuild from their parts.
3. Write docs/STATS.md with one line per stat: name, definition, source and direction. Add the checks as tests, and report anything suspicious.

We already found one flipped stat (Task 0), so assume there could be more.
