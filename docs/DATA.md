# Data

Where the numbers come from, when they refresh, and what they mean.

## Sources

| Source | What we take | How |
| --- | --- | --- |
| hoopR mirror, season files (`sportsdataverse/hoopR-nba-data`) | Every box score of the season: `player_box_<season>.parquet`, `team_box_<season>.parquet`, and the full schedule `nba_schedule_<season>.parquet` | Downloaded each run from `raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba/...`, or read from `--source-dir` |
| hoopR mirror, shot file (`shots/parquet/shots_<season>.parquet`) | Every shot of the season with its spot on the court, from ESPN's play-by-play (see [Shots](#shots)) | Same as the season files. Optional: without it the run carries on and leaves the shot tables as they were |
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
