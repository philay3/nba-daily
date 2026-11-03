# Data

Where the numbers come from, when they refresh, and what they mean.

## Sources

| Source | What we take | How |
| --- | --- | --- |
| hoopR mirror, season files (`sportsdataverse/hoopR-nba-data`) | Every box score of the season: `player_box_<season>.parquet`, `team_box_<season>.parquet`, and the full schedule `nba_schedule_<season>.parquet` | Downloaded each run from `raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba/...`, or read from `--source-dir` |
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

## Every game day and the week ahead

- `games` holds the whole regular-season schedule, past and future, refreshed on every run: tip times (`time_valid` is false while ESPN lists a date but no time, shown as TBD), TV, status (postponed and the like). A game that leaves the schedule without being played is deleted.
- `game_previews` is the look-ahead each run builds for its date and the next two days: records through the run date, rest days, back-to-back flags (second night: played the day before; first night: plays the next day), and both teams' players listed Out or Doubtful with their season scoring. `injury_report` says which report those numbers use; it is null when no report covers the game (an `injuries.json` input file covers tonight only, ESPN's report covers every team).
- The daily run fetches ESPN odds for every game in those 3 days (one summary per game, one at a time) and ESPN's injury list for every team playing in them. Each injury row points at the team's next game, and a game-day designation is read for that game's day ("questionable for Thursday's game" counts for a Thursday game; "tonight" counts only for tonight's).
- The web app measures each date from the newest run: an earlier date shows its final scores; the run date and the two days after show the full matchup breakdown; later dates show the schedule, records, TV and a line once posted. The week view lists the next 7 days. Records are through the newest run.
- Checks on every run (errors): each day's look-ahead game count equals the schedule's, and every back-to-back flag matches the schedule. Warnings: tomorrow's games without an injury report or odds.

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
