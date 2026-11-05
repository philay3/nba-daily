# Data

Where the numbers come from, when they refresh, and what they mean.

## Sources

| Source | What we take | How |
| --- | --- | --- |
| hoopR mirror, season files (`sportsdataverse/hoopR-nba-data`) | Every box score of the season: `player_box_<season>.parquet`, `team_box_<season>.parquet`, and the full schedule `nba_schedule_<season>.parquet` | Downloaded each run from `raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba/...`, or read from `--source-dir` |
| hoopR mirror, shot file (`shots/parquet/shots_<season>.parquet`) | Every shot of the season with its spot on the court, from ESPN's play-by-play (see [Shots](#shots)) | Same as the season files. Optional: without it the run carries on and leaves the shot tables as they were |
| hoopR mirror, play-by-play (`play_by_play_<season>.parquet`) | ESPN's play-by-play for every game: substitutions, clock, running score, shots, free throws, rebounds, turnovers, fouls (about 500 plays a game, 20 MB by the end of a season) | Downloaded each run from `.../nba/pbp/parquet/`, or read from `--source-dir`. Only tables computed from it are stored, never the plays |
| hoopR raw per-game mirror (`sportsdataverse/hoopR-nba-raw`) | ESPN's summary JSON for a single game | Fallback for finished games the season files do not have yet |
| PATCH files (`patch_<espn_id>.json` in `--inputs`) | A box score written from ESPN's game summary by hand or by `record-fixtures` | Second fallback, checked before the raw mirror; format in `pipeline/nba_pipeline/sources/patch.py` |
| ESPN game summary (`site.api.espn.com/.../summary?event=<id>`) | Tonight's lines from `pickcenter` (first provider, usually DraftKings), moneylines, and win odds from `predictor` when posted | One request per game tonight, one at a time |
| ESPN injuries (`site.api.espn.com/.../injuries`) | Every team's injury list | One request per run |
| Inputs folder (`--inputs DIR`) | `odds.json`, `injuries.json`, `editorial.json`, `sr_standings.json` in the old engine's formats | Files win over ESPN when present |

ESPN's JSON endpoints are public but unofficial and undocumented. They can change shape, rate limit, or block cloud IP ranges without notice. The parsers treat any missing key as "no data" and the run carries on, noting what it could not fetch in `pipeline_runs.notes` and in the digest. CI never calls ESPN; parser tests use saved responses in `pipeline/fixtures/espn`. To refresh those, run `python -m nba_pipeline record-fixtures --date YYYY-MM-DD --out pipeline/fixtures/espn_live` from a home connection.

## Refresh timing

- The hoopR data build runs daily at 07:00 UTC (2 or 3 a.m. in New York) and again whenever the raw repo is pushed, so last night's late West Coast games are usually in the season files by the morning.
- `.github/workflows/daily.yml` runs the pipeline at 9:45 a.m. New York time (cron entries for both EDT and EST; a second run an hour later is a harmless refresh).
- Lines and injuries are snapshots taken at run time. Injury designations change through the afternoon; run the pipeline again (manual dispatch) closer to tip-off for fresher ones.

## Scope

- Regular season only: `season_type = 2`. Play-in and playoff games are filtered out, so a day with only postseason games shows no games. Supporting them needs a series model, separate standings logic and a season-type column in the views.
- Only games between two of the 30 teams count. ESPN files the All-Star games (World, Stars, Stripes and similar) as regular season; they are dropped and listed in the run's `non_nba_games`. Player rows the mirror carries with no athlete at all are dropped too (`dropped_player_rows`).
- NBA Cup group games count (ESPN files them as regular season). Knockout placeholders whose teams are still `TBD` are skipped until the matchup is set. The championship game is in the files as regular season even though the league does not count it in the standings; v1 does not special-case it.
- One season per run. `--season 2026` (or any year with hoopR files) rebuilds an older season; dates and `--season` should agree.
- As of the run date: a run for date D counts only games before D. That makes a backfill for a past date reproduce that morning's numbers.

## Team codes

Ours: `ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS`. ESPN writes six differently (`GS`, `NY`, `NO`, `SA`, `UTAH`, `WSH`); every source is mapped at the boundary.

## What is computed

All of this is a port of the original engine (`docs/reference/nba_build.py`); the parity tests pin it to that engine's output, except for the deliberate fixes listed in DECISIONS.md (so far one: points off turnovers).

- Possessions per team-game: `FGA - OREB + TOV + 0.44 x FTA`, averaged for the two teams so both share one number. TOV is ESPN's total turnovers (player plus team).
- Offensive, defensive and net rating: points per 100 possessions. Pace: possessions per 48 minutes, where a game's minutes are `48 + 5 x overtimes`.
- Four factors on both ends: effective FG % `(FGM + 0.5 x 3PM) / FGA`, turnover % `TOV / (FGA + 0.44 x FTA + TOV)`, offensive rebound % `OREB / (OREB + opponent DREB)`, free throw rate `FTM / FGA`, plus the opponent versions (defensive rebound % on defense).
- Points off turnovers: the points a team scored off the opponent's turnovers. ESPN's team stat `turnoverPoints` (`turnover_points` in the mirror) is labeled "Points Conceded Off Turnovers", so each team takes the opponent's figure, and its own figure is the points it allowed (`opp_pts_off_to_pg`). The original engine read it the other way round; see DECISIONS.md.
- League ranks for 39 stats, 1 = best, ties share the better rank. Pace 1 = fastest. Volume stats (attempts) have no "better" side.
- Team-vs-team gaps for every game: the road-minus-home difference of each stat divided by the standard deviation of that difference across every game this season. Major is 1.5 or more, Notable 1.0 or more.
- Player deltas for every game: points, rebounds, assists and minutes against his averages from games before that date, with the engine's flags (points +/- 8 with 12+ minutes, rebounds +/- 5, assists +/- 4, three or more extra threes, minutes +/- 10, a season high with 15+ points, plus-minus of 15 either way, double- and triple-doubles, first game of the season).
- Missing scoring: the season points per game of players listed Out or Doubtful, matched to season stats by team and exact name. A name spelled differently from the box scores counts as "no games this season"; the digest flags close spellings with NAME CHECK, and ESPN injury names are normalized (accents, punctuation, Jr./III) to the box-score spelling when there is exactly one match.
- Rest days, back-to-backs, records entering each game, upsets (winner had the worse record entering, with 2+ games played) and comebacks (the loser once led by 10 or more).
- Rest days after tonight come from the schedule, played or not: whole days since the team's previous scheduled game. A team playing on consecutive days is on a back-to-back even before either game is played. Postponed, canceled and suspended games are left out. Up to tonight, rest still comes from the games played (the original engine's rule); a run warns if the two disagree for tonight.
- Shot zones (see [Shots](#shots)): attempts, makes, points, FG%, points per shot (two decimals) and share of attempts by zone, for the league, each team on offense and on defense (its opponents' shots), each player and each team-game. Each row carries the league's numbers for the same zone and the FG% gap between the two printed values. On the web, the hexbin view sizes each hex by attempts and colors it by the subject's FG% from the zone most of its shots came from, against the league: the same number as the +/- column of the zone table, gray under 5 attempts from the zone.

## Every game day and the week ahead

- `games` holds the whole regular-season schedule, past and future, refreshed on every run: tip times (`time_valid` is false while ESPN lists a date but no time, shown as TBD), TV, status (postponed and the like). A game that leaves the schedule without being played is deleted.
- `game_previews` is the look-ahead each run builds for its date and the next two days: records through the run date, rest days, back-to-back flags (second night: played the day before; first night: plays the next day), and both teams' players listed Out or Doubtful with their season scoring. `injury_report` says which report those numbers use; it is null when no report covers the game (an `injuries.json` input file covers tonight only, ESPN's report covers every team).
- The daily run fetches ESPN odds for every game in those 3 days (one summary per game, one at a time) and ESPN's injury list for every team playing in them. Each injury row points at the team's next game, and a game-day designation is read for that game's day ("questionable for Thursday's game" counts for a Thursday game; "tonight" counts only for tonight's).
- The web app measures each date from the newest run: an earlier date shows its final scores; the run date and the two days after show the full matchup breakdown; later dates show the schedule, records, TV and a line once posted. The week view lists the next 7 days. Records are through the newest run.
- Checks on every run (errors): each day's look-ahead game count equals the schedule's, and every back-to-back flag matches the schedule. Warnings: tomorrow's games without an injury report or odds.

## Shots

hoopR's shot file has one row per shot, free throws included: `game_id`, `period_number`, `clock_display_value`, `team_id`, `athlete_id_1` (the shooter), `athlete_id_2` (the passer on a make, the blocker on a miss), `type_text`, `scoring_play`, `score_value`, and two sets of coordinates. ESPN does not document the coordinates, so the system below was worked out from the data. `pipeline/tests/test_shots.py` runs every check in this section on the fixture.

### Where the rim is, the units, which half

- `coordinate_x_raw` runs across the court in whole feet, 0 to 50. The rim is at 25.
- `coordinate_y_raw` is feet from the rim toward half court. The baseline is 5.25 feet behind the rim (the lowest value in the data is -5), half court is 41.75 feet out, and the far baseline 88.75 (the highest value is 88, a heave).
- One half court for everything: every shot is measured toward the basket the shooting team attacks, in both halves of the game.
- hoopR's `coordinate_x` and `coordinate_y` turn the same spots into a full-court view (`coordinate_x` is 41.75 minus the raw y, with the sign flipped for one team) that keeps each team on one end for the whole game, with no switch at the half. We use the raw columns.
- We store `x` = raw x minus 25 (feet left or right of the rim) and `y` = raw y (feet out from the rim). ESPN does not say which sideline is 0; nothing here depends on it, since there is no left or right corner.

| Check (fixture: 92 games through Nov 1, 2026) | Result |
| --- | --- |
| Dunks: distance from raw (25, 0) | median 1.4 ft, 96% within 5 ft (960 dunks) |
| Layups | median 2.2 ft, 93% within 6 ft (3,845 layups) |
| Jump shots | median 24.2 ft |
| Free throws | all placed at (25, 13.75): 13.75 ft is the free throw line's distance from the rim (15 ft from the backboard, the rim 1.25 ft in front of it). It is a placeholder, not a real spot |
| The three-point line (22 ft in the corners up to 8.75 ft past the rim, 23.75 ft around the arc) against made shots' points | agrees on 7,443 of 7,451 makes (99.9%); 99.96% of 103,346 makes over 2025-26 |
| The lane (8 ft either side of the rim, out to y = 14) against ESPN's points in the paint | within 2 points in every team-game, exact in 146 of 184. Over 2025-26 these edges match ESPN exactly in more team-games (81%) than edges a foot narrower, wider, shorter or longer |
| Assisted makes against box score assists | exact in 183 of 184 team-games, the other off by one |

### What counts as an attempt

- Free throws are dropped (`type_text` starts with "Free Throw").
- Missed heaves are dropped. Since 2025-26 a missed end-of-quarter heave is not charged as a field goal attempt. ESPN types them "Heave Jump Shot" (1,099 in 2025-26, none made) and the box score leaves them out: with them the fixture has 85 more attempts than the box scores, without them 2 fewer. Made heaves count as attempts and makes. The 2024-25 file has no heave type, so the rule changes nothing there.
- Everything else counts, including tip-ins logged twice at the same second and "No Shot (Default Shot)" rows: dropping either made the match with the box scores worse.

### Three or two, zones, assists

- A make is a three when its points say 3. A miss is placed by the line.
- Zones, as NBA.com draws them:
  - Restricted area: within 4 ft of the rim.
  - Paint: inside the 16-foot lane up to the free throw line (`|x| <= 8`, `y <= 14` in whole feet), outside the restricted area.
  - Midrange: any other two.
  - Corner 3: a three with `y <= 8.75`, the straight part of the line (up to 14 ft from the baseline).
  - Above the break 3: any other three up to half court.
  - Backcourt: beyond half court (`y > 41.75`). Missed heaves are not attempts but made ones are, so this zone's FG% is high and means little.
- Assisted: a make with a second player listed. In the data that player is always a teammate. On a miss the second player is the shot blocker, always an opponent; we do not store it.

### Coverage: shots against the box scores

Every run compares each team-game's shots with its box score and prints the result under `shots.coverage` in the run summary. A game with a box score but no shots is a run warning; its chart and zone table show nothing until the shot file has it.

| Season | Team-games with shots | Box score attempts | Shots | Exact | Short | Over | Worst gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-27 fixture, 92 games | 184 | 16,257 | 16,255 | 174 | 6, one shot each | 4, one shot each | 1 |
| 2025-26 regular season | 2,460 of 2,462 | 219,180 | 219,192 | 2,414 | 18 | 28 | 3 |

Where the gaps come from: not missing locations. The shot file holds every shooting play in hoopR's play-by-play (220,542 of 220,542 in 2025-26, 16,342 of 16,342 on the fixture, heaves included), and every one of them has a spot. The play-by-play itself sometimes logs one shot more or fewer for a team than the box score counts, which is the short and over above. One 2025-26 game (401810469) has no play-by-play in the mirror at all, so it has no shots. The pipeline still drops and counts any shot without a spot (`shots.dropped.no_location`) in case ESPN starts leaving them out.

Makes match the box score in every fixture team-game (all but 3 in 2025-26) and made threes in every one (all but 2), so on the fixture, points from shots equal points minus free throws in every team-game.

### Storage

About 220,000 shots a season, about 45 MB with indexes (3.2 MB for the fixture). Each run rewrites only the games whose shots changed: `shot_games` keeps a hash of each game's rows. Zone profiles are rebuilt every run for the season.

## Play-by-play

`pipeline/nba_pipeline/pbp.py` reads the season's play-by-play after the box-score engine and writes seven tables. None of them holds raw plays.

| Table | One row per | What it holds |
| --- | --- | --- |
| `game_flow` | game | The score after every scoring play (for the worm chart), lead changes, ties, largest leads, how long each side led, time in clutch, how many stints and repairs the lineup rebuild needed |
| `game_runs` | run | Unanswered scoring runs of 8 or more points, plus each team's biggest run of the game, with start and end clock and the score before and after |
| `lineup_games` | game, team, five-man unit | Seconds, possessions, points for and against |
| `lineup_season` | season, team, unit | The same summed over the season, with offensive, defensive and net rating |
| `player_on_off` | season, player, team | The team's ratings with him on the floor and off it, in the games he played, and his on-floor plus-minus |
| `team_clutch`, `player_clutch` | season, team (or player) | Clutch-time games, record, minutes, points, shooting, plus-minus and ratings (for players: his own scoring, and the team's margin while he was on the floor) |

A full season takes about 19 MB in Postgres (measured on 2025-26; `lineup_games` is half of it), and the step adds about 25 seconds to a late-season run.

### Rules

- Order: plays are sorted by `game_play_number`, which follows the game clock. `sequence_number` is ESPN's edit order (a play corrected later gets a higher number), so it is not used. In this order the running score is consistent on every row and the last play's score equals the box score in every game of the fixture day.
- Time: elapsed game seconds, 0 at tip-off, 720 per quarter, 300 per overtime. The clock under a minute keeps tenths (`24.6`).
- Field goal attempts leave out missed end-of-quarter heaves (`Heave Jump Shot` with no score), because ESPN's box score does too. Rebounds are player rebounds; team rebounds are not counted, as in the box score. Turnovers include team turnovers (shot clock and the like).
- Possessions use the app's estimate, per stretch of play and per side: FGA - OREB + TOV + 0.44 x FTA, averaged for the two teams, so lineups and on/off read on the same scale as the team ratings.
- Free throws count for the ten players on the floor when the foul happened, even if substitutions came between the foul and the shots. That is how the box score's plus-minus works: crediting them to the lineup at the shot matches the box score's plus-minus in only about 4 player-games in 10 last season, crediting them to the lineup at the foul matches 98.8%.
- Lead changes count each time the lead passes from one team to the other (a tie in between does not count as a change). Times tied counts ties after a basket, not 0-0.
- A scoring run is the points one team scores before the other team scores again. Its time runs from its first basket to its last.
- Clutch time: the last 5 minutes of the 4th quarter or any overtime with the margin within 5. A play is clutch when the margin before it is within 5, so the basket that stretches a 5-point game to 7 still counts. Clutch minutes are the stretches of game clock in that state.
- On/off: on is every second he was on the floor; off is his team's remaining time in the games he played (not the games he missed). On-off is the net rating on minus the net rating off.

### Who is on the floor

Substitutions say who enters (athlete 1) and who leaves (athlete 2). The feed does not list the five players who start each period, so each team's period is read on its own:

1. Period 1 takes the box score's five starters.
2. Otherwise a player named in a play, or leaving the game, before he enters was on the floor when the period began. Technical fouls and ejections do not count, since they can name a player on the bench.
3. A player who plays a whole period without a logged event is still on from the end of the previous period.
4. ESPN sometimes keeps both the original and the corrected version of a substitution, names the wrong player leaving, or names nobody. When the plain reading does not fit, other starting fives and fixes to the contradicting rows (drop one or two, or work out who really left) are tried, and the reading with the fewest contradictions wins: a row that cannot apply costs 3, a dropped row 2, a corrected outgoing player 1, a play naming a benched player 1.
5. When two readings fit equally well, the one whose minutes come closest to the box score is kept. This is the only use of the box score's minutes, so the minutes check below stays an honest test of the rest.

Every stretch of play has exactly five players a side.

### Checks

Each run checks the rebuild against the box score and reports the results in `pipeline_runs` (messages start with `play-by-play:`). Lineup minutes that do not add up are an error (a bug); gaps in ESPN's data are warnings.

| Check | Fixture day (92 games before 2026-11-02) | 2025-26 regular season |
| --- | --- | --- |
| Five-man lineup minutes per team per game add up to 240 player minutes, plus 25 per overtime | Every team-game, including 4 overtime games | Every team-game |
| Rebuilt minutes within a minute of the box score | 2,074 of 2,079 player-games; the other 5 are all in one game (401909096, HOU at SAS), where ESPN's feed misses substitutions: the same five players are off in plus-minus too | 26,597 of 26,599; the other 2 are in one game with the same kind of gap |
| On-floor margin equals the box score's plus-minus | 2,034 of 2,079 player-games (97.8%); season totals exact for 397 of 442 players, all within 5 | 26,292 of 26,599 (98.8%) |
| Final score, lead changes and largest leads against ESPN's box score | All match (lead changes compared in the 82 games where ESPN lists any) | Lead changes match wherever ESPN lists them (it leaves them blank in many early games); largest leads 2,314 of 2,315 teams |
| Lineup possessions against the box score's estimate | Within 1 for every team-game | Within 3, except one game where ESPN's box is missing 21 turnovers |
| Clutch points against a separate count straight from the raw rows (in the tests) | Every team matches | |
| Team-periods that needed a repaired reading; ties settled by box minutes | 22 of 744; 2 | 99 of about 10,000; 1 |

Other gaps the run reports: a finished game whose play-by-play is not in the file yet (1 last season) or whose final score differs from the box score (1 last season) is left out of the play-by-play tables, and a player the plays have on the floor but ESPN's box score leaves out takes his team from the plays (21 player-games last season, all one player).

### Fixture

`pipeline/fixtures/hoopr_2026-11-02/play_by_play_2027.parquet` is the mirror's file as downloaded on 2026-11-03, cut to the games before 2026-11-02 (the same 92 as the box-score fixture) and to the columns the pipeline reads: the 23 in `pbp.COLUMNS`, plus the four game-level line columns the model reads (`game_spread`, `home_favorite`, `game_spread_available`, `home_team_spread`), which were added later from a fresh download of the same file, matched by game id. A task that needs more columns should do the same: download the season file again, keep the same games and add only its columns.

## Power ratings and the model

`pipeline/nba_pipeline/model.py` runs after the play-by-play step and writes five tables, all rebuilt for the season every run (about 5,000 rating rows and 1,300 prediction rows by the end of a season, well under 2 MB).

| Table | One row per | What it holds |
| --- | --- | --- |
| `power_ratings` | season, date, team | Adjusted offense, defense and net per 100 possessions with ranks, from the games before that date; the raw numbers for the same games; the pace the projections use |
| `model_days` | season, date | League average, home court and the spread of results the model used that day, and how many games each rests on |
| `model_games` | game | The prediction for every finished game (as of its date) and every game in the next 3 days (as of the run date), ESPN's line, the result, and the pick against the line |
| `model_backtest` | season | Average miss for the model and the line, record against the line, winners picked, Brier score |
| `model_calibration` | season, bin | Games grouped by the favorite's win chance (50-60%, 60-70% and so on): average chance and how often the favorite won |

### The fit

- Each finished game gives two rows, one per team on offense, with its points per 100 possessions (the app's possession estimate): league average + that offense + the other defense, plus half of home court for the home team and minus half for the road team.
- Ridge regression: each offense and defense is pulled toward 0 (the league average) as if the team had also played 7 average games, so early ratings sit near the middle and spread out as games add up. Home court is pulled toward 2 points (at the league's pace) with the weight of 100 games, so this season's games move it more as the sample grows.
- A fit for date D uses only games before D. The run fits every game date of the season in order, adding each night's games to running sums, so a full season takes under a second.
- 7 games came from last season: predicting each 2025-26 game from the games before it, weights of 4 to 7 games gave the lowest average miss (11.4 points), 10 to 14 gave 11.5, 20 gave 11.6 and 30 gave 11.7.

### Projections

- Expected possessions: home pace x road pace / league pace, where each team's pace is pulled toward the league's with the weight of 5 games.
- Predicted home margin: (home adjusted net - road adjusted net + home court) x possessions / 100, then 1.5 points against a team on the second night of a back-to-back (from the schedule). Last season the model without the rest term was 2.9 points too high on home teams on a back-to-back (145 games) and 0.8 too low on road teams on one (156 games).
- Win chance: a normal distribution around the margin. Its spread starts at 12 points and moves toward this season's misses (each game's actual margin minus its pregame prediction, games before D only) with the weight of 100 games. It ended 2025-26 at 14.4 points.
- Games in the next 3 days use the run date's ratings, and the line from that run's odds when one is posted.

### ESPN's line

The play-by-play carries ESPN's pregame spread on every row of a game: `home_team_spread` is the expected home margin (positive when the home team is favored), `game_spread` its size, `home_favorite` the side and `game_spread_available` whether there is one. One value per game, the same on every row. Checks (in `pipeline/tests/test_model.py`):

- Sign: ESPN's summary for 401909906 lists "LAL -3.5" with the Lakers at home, and the play-by-play has `home_team_spread` = 3.5.
- In 2025-26, the sign of `home_team_spread` always matches `home_favorite` (1,234 games), and favorites won 69.5% of the time.
- 4 games in 2025-26 have `game_spread_available` false; they have no line in the backtest. Every fixture game has one.

### Backtest

| | Fixture: 92 games before 2026-11-02 | 2025-26 regular season, 1,231 games |
| --- | --- | --- |
| Average miss, model | 12.7 points | 11.4 (on the 1,230 with a line) |
| Average miss, ESPN's line | 11.2 | 10.8 |
| Against the line | 46-46 | 580-638-12 (47.6%) |
| Winners picked, model / line | 59 / 64 of 92 | 844 / 854 of 1,229 |
| Brier score | 0.238 | 0.206 |
| Home court, spread of results at the end | 2.0, 14.0 points | 1.7, 14.4 points |

Calibration over 2025-26: favorites given 50-60% won 58.8% (488 games), 60-70% won 68.4% (370), 70-80% won 80.8% (261), 80-90% won 85.0% (107). The chances run a little low, since the spread of results is wide. The model is not better than the line; it is a transparent baseline to compare the line with.

Each run checks that every finished game has a prediction and that no prediction used a game on or after its own date (errors, starting with "model:").

## Injury status rules

Each row gets one of Out, Doubtful, Questionable, Probable, Day-to-day. A game-day designation in the latest comment wins when it is about tonight ("questionable for Monday's game" on a Monday means Questionable); otherwise ESPN's status (Day-To-Day becomes Day-to-day). Suspended players are Out with injury "Suspension". The note is written from ESPN's structured fields (injury detail and expected return), never copied from ESPN's comment text.

## Win odds

The old dashboard took win odds from Sportradar through Claude's sports tool, which a GitHub Action cannot call. The pipeline uses ESPN's `predictor` when the summary has one and otherwise the no-vig split of the two moneylines (`wp_source` says which). `odds.json` in `--inputs` still overrides both.

## Editorial rules (for picks, tags, notes)

The pipeline ships with a no-op editorial provider (`pipeline/nba_pipeline/editorial.py`); `editorial.json` in `--inputs` supplies picks the old way, and a Claude API provider is a TODO there. Whoever writes them follows the old task's rules:

- Games to watch: rank up to 6 on team quality, how close the line or win odds are, national TV, who is missing, and real storylines from the digest. Number 1 is tagged "Game of the night". Other tags are two or three words (Tightest line, National TV, Upset watch, Unbeaten watch, Still winless, Surprise team, Star watch, Status watch, Mismatch, Biggest spread, Shorthanded, Both on no rest, Road favorite, Pace clash, Ratings vs line).
- Every game tonight gets a tag and a one- or two-sentence note with the numbers that matter. Every result last night gets a note on what decided it.
- Headline: two or three sentences (games tonight, best matchup, tightest line, teams on no rest, last night's best line). Surprises: 4 to 6 short items, only from the digest. No "career high" or "record" claims unless a source says so.
- Plain words, short sentences, no hype, no em dashes. Every number must match the digest.
