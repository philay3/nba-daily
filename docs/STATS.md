# Stats

What every stored stat means, where it comes from, and which side is better. One line per column of `team_games`, `player_games`, `team_season`, `player_season` and `game_gaps`. The formulas live in `pipeline/nba_pipeline/compute.py`; the checks in `pipeline/nba_pipeline/audit.py` run every day and `pipeline/tests/test_stats.py` ties this file to the code.

How to read it:

- **Source.** "ESPN `name`" is ESPN's stat key in the game summary, as hoopR's box score files carry it (`team_box`, `player_box`), with ESPN's own label in quotes. "Computed" means we derive it. "Schedule" is hoopR's schedule file.
- **Better.** `higher` or `lower` is the side that is good for the team or player. `none` means there is no better side: an id, a count of attempts, a style stat. For `team_season`, this column is the rank direction in code: rank 1 is the best, and for the two style stats with a rank, rank 1 is the fastest or the most. For `game_gaps`, it is the edge direction in code.
- **Precision.** Rates are stored at one decimal and gap z-scores at two, as the original engine printed them. Season figures are always rebuilt from counting stats, never from stored rates.
- **Abbreviations.** FGM and FGA: field goals made and attempted. 3PM and 3PA: threes. FTM and FTA: free throws. OREB and DREB: offensive and defensive rebounds. TOV: turnovers. "opp" is the other team in the same game.

## Shared definitions

- **Possessions** (`poss`): FGA - OREB + TOV + 0.44 x FTA, worked out for each team and averaged for the two. Both teams in a game get the same number. TOV here is total turnovers, team turnovers included.
- **Game minutes** (`minutes`): 48, plus 5 per overtime.
- **Ratings**: points per 100 possessions. Offensive rating is the team's points, defensive rating the opponent's, net the difference.
- **Pace**: possessions per 48 minutes, so an overtime game is not counted as fast.
- **Four factors** (Dean Oliver): effective FG %, turnover %, offensive rebound % and free throw rate, for the offense and for the defense. Free throw rate is FTM / FGA, Oliver's version. Basketball-Reference uses FTA / FGA, so our numbers run lower than theirs. The site labels it "free throws made per field goal attempt".
- **Rebounds** are players' rebounds only. ESPN's team totals leave out team rebounds (a miss out of bounds, for example), and so do we. Offensive rebound % is computed the same way Basketball-Reference does.

## team_games

One row per team per game.

| Column | Definition | Source | Better |
| --- | --- | --- | --- |
| `game_id` | ESPN game id | ESPN | none |
| `team_code` | This team, our code (GSW, not GS) | ESPN, mapped | none |
| `opp_code` | The other team | ESPN, mapped | none |
| `home_away` | `home` or `away` | ESPN `homeAway` | none |
| `game_date` | Game date in New York | Schedule | none |
| `win` | Scored more than the opponent | ESPN `winner` | none |
| `pts` | Points scored | ESPN team score | higher |
| `opp_pts` | Points allowed: the opponent's `pts` in the same game | Computed | lower |
| `fgm` | Field goals made | ESPN `fieldGoalsMade` "FG" | higher |
| `fga` | Field goals attempted | ESPN `fieldGoalsAttempted` "FG" | none |
| `tpm` | Threes made | ESPN `threePointFieldGoalsMade` "3PT" | higher |
| `tpa` | Threes attempted | ESPN `threePointFieldGoalsAttempted` "3PT" | none |
| `ftm` | Free throws made | ESPN `freeThrowsMade` "FT" | higher |
| `fta` | Free throws attempted | ESPN `freeThrowsAttempted` "FT" | higher |
| `oreb` | Offensive rebounds by players | ESPN `offensiveRebounds` "Offensive Rebounds" | higher |
| `dreb` | Defensive rebounds by players | ESPN `defensiveRebounds` "Defensive Rebounds" | higher |
| `reb` | Total rebounds by players, `oreb` + `dreb` | ESPN `totalRebounds` "Rebounds" | higher |
| `ast` | Assists | ESPN `assists` "Assists" | higher |
| `stl` | Steals | ESPN `steals` "Steals" | higher |
| `blk` | Blocks | ESPN `blocks` "Blocks" | higher |
| `tov` | Total turnovers: the players' plus the team's | ESPN `totalTurnovers` "Total Turnovers" | lower |
| `team_tov` | Team turnovers (shot clock, 8 seconds and the like), not charged to a player | ESPN `teamTurnovers` "Team Turnovers" | lower |
| `pf` | Personal fouls, the sum of the players' fouls | ESPN `fouls` "Fouls" | lower |
| `tech_fouls` | Technical fouls | ESPN `technicalFouls` "Technical Fouls" | lower |
| `flagrant_fouls` | Flagrant fouls | ESPN `flagrantFouls` "Flagrant Fouls" | lower |
| `fb` | Fast-break points scored | ESPN `fastBreakPoints` "Fast Break Points" | higher |
| `paint` | Points scored in the paint (field goals only, always even) | ESPN `pointsInPaint` "Points in Paint" | higher |
| `pts_off_to` | Points scored off the opponent's turnovers. ESPN files this under the team that turned it over ("Points Conceded"), so each team takes the opponent's figure | ESPN `turnoverPoints` of the opponent | higher |
| `bench_pts` | Points by players who did not start | Computed from the player box | higher |
| `largest_lead` | This team's biggest lead, 0 if it never led | ESPN `largestLead` "Largest Lead" | higher |
| `lead_changes` | Lead changes in the game, the same for both teams | ESPN `leadChanges` "Lead Change" | none |
| `num_periods` | Periods played, 4 plus overtimes | Schedule | none |
| `minutes` | Game minutes, 48 + 5 per overtime | Computed | none |
| `poss` | Possessions, both teams' estimates averaged | Computed | none |
| `ortg` | Offensive rating: 100 x `pts` / `poss` | Computed | higher |
| `drtg` | Defensive rating: 100 x `opp_pts` / `poss` | Computed | lower |
| `net` | Net rating: 100 x (`pts` - `opp_pts`) / `poss` | Computed | higher |
| `pace` | Possessions per 48 minutes: 48 x `poss` / `minutes` | Computed | none |
| `fg_pct` | FG %: FGM / FGA | Computed | higher |
| `fg3_pct` | 3-point %: 3PM / 3PA | Computed | higher |
| `ft_pct` | Free throw %: FTM / FTA | Computed | higher |
| `efg` | Effective FG %: (FGM + 0.5 x 3PM) / FGA | Computed | higher |
| `tov_pct` | Turnover %: TOV / (FGA + 0.44 x FTA + TOV) | Computed | lower |
| `orb_pct` | Offensive rebound %: OREB / (OREB + opp DREB) | Computed | higher |
| `ftr` | Free throw rate: FTM / FGA | Computed | higher |
| `ast_pct` | Share of made field goals that were assisted: AST / FGM. Not a player's assist % | Computed | none |
| `opp_efg` | Opponent effective FG % | Computed | lower |
| `opp_tov_pct` | Opponent turnover %: turnovers forced | Computed | higher |
| `drb_pct` | Defensive rebound %: DREB / (DREB + opp OREB) | Computed | higher |
| `opp_ftr` | Opponent free throw rate | Computed | lower |
| `updated_at` | When the row was last written | Database | none |

## player_games

One row per player per game, including players who did not play.

| Column | Definition | Source | Better |
| --- | --- | --- | --- |
| `game_id` | ESPN game id | ESPN | none |
| `player_id` | ESPN athlete id (a crc32 id for a patch-file player without one) | ESPN | none |
| `team_code` | His team | ESPN, mapped | none |
| `opp_code` | The other team | ESPN, mapped | none |
| `home_away` | `home` or `away` | ESPN | none |
| `game_date` | Game date in New York | ESPN | none |
| `name` | Name as printed in this box score | ESPN `displayName` | none |
| `position` | Position abbreviation | ESPN `position` | none |
| `starter` | Started the game | ESPN `starter` | none |
| `did_not_play` | ESPN marks him as not playing | ESPN `didNotPlay` | none |
| `reason` | ESPN's reason for not playing, as written | ESPN `reason` | none |
| `ejected` | Ejected | ESPN `ejected` | none |
| `box_order` | Starters, then bench by minutes (players at 0 minutes last), then players who did not play | Computed | none |
| `min` | Minutes, rounded to a whole number by ESPN. 0 means under 30 seconds, not "did not play" | ESPN `minutes` "MIN" | none |
| `pts` | Points | ESPN `points` "PTS" | higher |
| `fgm` | Field goals made | ESPN `fieldGoalsMade` "FG" | higher |
| `fga` | Field goals attempted | ESPN `fieldGoalsAttempted` "FG" | none |
| `tpm` | Threes made | ESPN `threePointFieldGoalsMade` "3PT" | higher |
| `tpa` | Threes attempted | ESPN `threePointFieldGoalsAttempted` "3PT" | none |
| `ftm` | Free throws made | ESPN `freeThrowsMade` "FT" | higher |
| `fta` | Free throws attempted | ESPN `freeThrowsAttempted` "FT" | none |
| `oreb` | Offensive rebounds | ESPN `offensiveRebounds` "OREB" | higher |
| `dreb` | Defensive rebounds | ESPN `defensiveRebounds` "DREB" | higher |
| `reb` | Rebounds | ESPN `rebounds` "REB" | higher |
| `ast` | Assists | ESPN `assists` "AST" | higher |
| `stl` | Steals | ESPN `steals` "STL" | higher |
| `blk` | Blocks | ESPN `blocks` "BLK" | higher |
| `tov` | Turnovers charged to him (team turnovers are not) | ESPN `turnovers` "TO" | lower |
| `pf` | Personal fouls | ESPN `fouls` "PF" | lower |
| `plus_minus` | Team points minus opponent points while he was on the floor | ESPN `plusMinus` "+/-" ("Teams net points while player is on the court") | higher |
| `ts_pct` | True shooting %: PTS / (2 x (FGA + 0.44 x FTA)). Empty without a shot | Computed | higher |
| `updated_at` | When the row was last written | Database | none |

## team_season

One row per team, rebuilt every run from the season's `team_games` before the run date. Per-game stats divide the season total by games played; rates and ratings divide season totals (so they weight every possession, not every game). Each stat with a rank has a `<stat>_rk` column: 1 is the best, ties share the better rank.

| Column | Definition | Source | Better |
| --- | --- | --- | --- |
| `season` | Season by its end year (2027 is 2026-27) | Run | none |
| `team_code` | Team | Computed | none |
| `as_of` | Run date; the row covers games before it | Run | none |
| `gp` | Games played | Computed | none |
| `w` | Wins | Computed | higher |
| `l` | Losses | Computed | lower |
| `home_rec` | Home record, W-L | Computed | none |
| `road_rec` | Road record, W-L | Computed | none |
| `streak` | Current streak, like W3 | Computed | none |
| `l5_rec` | Record in the last 5 games | Computed | none |
| `record_seed` | Conference seed by winning % (then wins, then code) | Computed | lower |
| `seed` | Official seed when supplied, else `record_seed` | Inputs or computed | lower |
| `seed_source` | `record` or `official` | Computed | none |
| `ortg` | Offensive rating over the season | Computed | higher |
| `drtg` | Defensive rating over the season | Computed | lower |
| `net` | Net rating over the season | Computed | higher |
| `l5_net` | Net rating over the last 5 games | Computed | higher |
| `pace` | Possessions per 48 minutes over the season | Computed | none, rank 1 = fastest |
| `ppg` | Points per game | Computed | higher |
| `opp_ppg` | Points allowed per game | Computed | lower |
| `diff` | Point differential per game | Computed | higher |
| `efg` | Effective FG % | Computed | higher |
| `tov_pct` | Turnover % | Computed | lower |
| `orb_pct` | Offensive rebound % | Computed | higher |
| `ftr` | Free throw rate, FTM / FGA | Computed | higher |
| `opp_efg` | Opponent effective FG % | Computed | lower |
| `opp_tov_pct` | Opponent turnover %: turnovers forced | Computed | higher |
| `drb_pct` | Defensive rebound % | Computed | higher |
| `opp_ftr` | Opponent free throw rate | Computed | lower |
| `fg_pct` | FG % | Computed | higher |
| `fg3_pct` | 3-point % | Computed | higher |
| `ft_pct` | Free throw % | Computed | higher |
| `fg3a_rate` | Share of field goal attempts from three: 3PA / FGA | Computed | none, rank 1 = most |
| `fg3m_pg` | Threes made per game | Computed | higher |
| `opp_fg_pct` | Opponent FG % | Computed | lower |
| `opp_fg3_pct` | Opponent 3-point % | Computed | lower |
| `opp_fg3m_pg` | Opponent threes made per game | Computed | lower |
| `rpg` | Rebounds per game | Computed | higher |
| `opp_rpg` | Opponent rebounds per game | Computed | lower |
| `apg` | Assists per game | Computed | higher |
| `spg` | Steals per game | Computed | higher |
| `bpg` | Blocks per game | Computed | higher |
| `tovpg` | Turnovers per game, team turnovers included | Computed | lower |
| `forced_tovpg` | Opponent turnovers per game | Computed | higher |
| `fb_pg` | Fast-break points per game | Computed | higher |
| `opp_fb_pg` | Fast-break points allowed per game | Computed | lower |
| `paint_pg` | Paint points per game | Computed | higher |
| `opp_paint_pg` | Paint points allowed per game | Computed | lower |
| `pts_off_to_pg` | Points scored off the opponent's turnovers per game | Computed | higher |
| `opp_pts_off_to_pg` | Points allowed off this team's turnovers per game | Computed | lower |
| `bench_ppg` | Bench points per game | Computed | higher |
| `opp_bench_ppg` | Opponent bench points per game | Computed | lower |
| `updated_at` | When the row was last written | Database | none |

## player_season

One row per player who has played, rebuilt every run from `player_games` before the run date. Every game with `did_not_play` false counts, including 0 minutes (see the findings). Per-game stats divide by games played; percentages divide season totals. No ranks.

| Column | Definition | Source | Better |
| --- | --- | --- | --- |
| `season` | Season by its end year | Run | none |
| `player_id` | ESPN athlete id | ESPN | none |
| `team_code` | Team in his latest game; after a trade his numbers still cover every team | Computed | none |
| `as_of` | Run date; the row covers games before it | Run | none |
| `name` | Name in his latest box score | ESPN | none |
| `position` | Position in his latest box score | ESPN | none |
| `gp` | Games played (`did_not_play` false, even at 0 minutes) | Computed | none |
| `gs` | Games started | Computed | none |
| `mpg` | Minutes per game | Computed | none |
| `ppg` | Points per game | Computed | higher |
| `rpg` | Rebounds per game | Computed | higher |
| `orpg` | Offensive rebounds per game | Computed | higher |
| `apg` | Assists per game | Computed | higher |
| `spg` | Steals per game | Computed | higher |
| `bpg` | Blocks per game | Computed | higher |
| `tovpg` | Turnovers per game | Computed | lower |
| `pfpg` | Personal fouls per game | Computed | lower |
| `fg_pct` | FG % | Computed | higher |
| `fg3m_pg` | Threes made per game | Computed | higher |
| `fg3_pct` | 3-point % | Computed | higher |
| `ft_pct` | Free throw % | Computed | higher |
| `ts_pct` | True shooting %: PTS / (2 x (FGA + 0.44 x FTA)) | Computed | higher |
| `pm_total` | Plus-minus summed over the season | Computed | higher |
| `pm_pg` | Plus-minus per game | Computed | higher |
| `hi_pts` | Most points in a game this season | Computed | higher |
| `team_mpg_rank` | 1 = most minutes per game on his team | Computed | none |
| `updated_at` | When the row was last written | Database | none |

## game_gaps

One row per game and stat: the road team's value against the home team's, scored against how big that gap usually is this season.

| Column | Definition | Source | Better |
| --- | --- | --- | --- |
| `game_id` | ESPN game id | ESPN | none |
| `key` | The stat, a `team_games` column (see the list below) | Computed | none |
| `sort_order` | Display order: by group, then the list below | Computed | none |
| `grp` | Group: Scoring, Shooting, Possession, Playmaking, Defense, Flow | Computed | none |
| `stat` | Label shown on the site | Computed | none |
| `away_code` | Road team | Computed | none |
| `home_code` | Home team | Computed | none |
| `away_val` | Road team's value, as in `team_games` | Computed | none |
| `home_val` | Home team's value, as in `team_games` | Computed | none |
| `away_txt` | Road value as printed (one decimal for rates, none for counts) | Computed | none |
| `home_txt` | Home value as printed | Computed | none |
| `gap` | Absolute difference, \|away - home\| | Computed | none |
| `gap_txt` | Gap as printed | Computed | none |
| `edge` | Team with the better value (for volume stats, the one with more); empty when even | Computed | none |
| `edge_txt` | Edge as printed: the team, "X more", or "Even" | Computed | none |
| `z` | `gap` / `sd` | Computed | none |
| `sd` | Standard deviation of road-minus-home differences for this stat over every game this season | Computed | none |
| `level` | "Major" when z is 1.5 or more, "Notable" from 1.0 | Computed | none |
| `volume` | True for attempt counts, which have no better side | Computed | none |

The stats compared, in display order within each group, with the edge direction used in code:

| Gap stat | Label | Better |
| --- | --- | --- |
| `pts` | Points | higher |
| `fg_pct` | Field goal % | higher |
| `efg` | Effective FG % | higher |
| `fg3_pct` | 3-point % | higher |
| `ft_pct` | Free throw % | higher |
| `fga` | Field goal attempts | none |
| `tpm` | 3-pointers made | higher |
| `tpa` | 3-point attempts | none |
| `fta` | Free throw attempts | higher |
| `oreb` | Offensive rebounds | higher |
| `dreb` | Defensive rebounds | higher |
| `reb` | Total rebounds | higher |
| `tov` | Turnovers | lower |
| `stl` | Steals | higher |
| `orb_pct` | Offensive rebound % | higher |
| `tov_pct` | Turnover % | lower |
| `ast` | Assists | higher |
| `blk` | Blocks | higher |
| `pf` | Fouls | lower |
| `fb` | Fast-break points | higher |
| `paint` | Points in the paint | higher |
| `pts_off_to` | Points off turnovers | higher |
| `bench_pts` | Bench points | higher |
| `ortg` | Offensive rating | higher |
| `largest_lead` | Largest lead | higher |

## Checks

`pipeline/nba_pipeline/audit.py` runs these on the whole season every day, after the engine's own checks. Messages start with "stats:". A source problem is a warning (the data loads, the message names the games); a rebuild that fails is an error (a bug on our side). On the fixture season (92 games, 2026-10-20 to 2026-11-01) every check passes.

ESPN's numbers against each other (warnings):

- Team points, field goals, threes, free throws, rebounds (offensive, defensive, total), assists, steals, blocks and fouls equal the sum of the players' lines.
- Team turnovers equal the players' turnovers plus team turnovers.
- Player plus-minus sums to 5 x the final margin, counting players ESPN shows at 0 minutes.
- Player minutes add up to 5 x the game's minutes, within half a minute a player (ESPN rounds each player to a whole minute; the fixture ranges from -2 to +3).
- Points = 2 x FGM + 3PM + FTM, rebounds = offensive + defensive, makes never exceed attempts.
- Paint points are even and at most 2 x two-point makes; fast-break, off-turnover and bench points never exceed the score.
- Assists never exceed made field goals, steals never exceed the opponent's turnovers, blocks never exceed the opponent's misses.
- Both teams list the same lead changes, and the winner led at some point.
- Pace is between 85 and 125 possessions per 48 minutes (the fixture runs 91 to 114), and the two teams' own possession estimates differ by 12 or less (2.2 on average, 8.4 at most).

Our math (errors):

- Every rate and rating in `team_games` rebuilds from its counts. Each side mirrors the other: a team's defensive rating is the opponent's offensive rating, pace and possessions match, and offensive rebound % plus the opponent's defensive rebound % is 100.
- Every stat in `team_season` rebuilds from that team's `team_games`; wins plus losses equal games played, and the league's wins equal its losses.
- Every rank puts the best value first, in the direction listed above.
- Every stat in `player_season` rebuilds from `player_games`.
- Every gap shows the two teams' `team_games` values, its edge follows the direction above, and z is gap / sd.

Checked once, against independent sources, in `pipeline/tests/test_stats.py` (no stored stat is flipped the way points off turnovers was):

- ESPN's own labels in the saved game summary match the Source column.
- Offensive rebounds belong to the shooting team: a team's misses track its offensive rebounds plus the opponent's defensive rebounds (r = 0.89), not the other pairing (r = -0.09).
- Paint points belong to the scoring team: they match two-point makes in the restricted area and the paint from the shot file (r = 0.997; the opponent's give 0.30).
- Fast-break points belong to the scoring team: they follow its own steals (r = 0.35, the opponent's 0.13) and the opponent's turnovers (0.25, its own 0.05).
- Points off turnovers: see `tests/test_points_off_turnovers.py` and docs/DECISIONS.md.
- Largest leads and lead changes are checked against the play-by-play every day (`pbp.py`).

## Findings

What the audit turned up on the fixture season. The first one is fixed; the rest are kept as they are.

1. **Players at 0 minutes counted as "did not play". Fixed.** ESPN rounds minutes, so a player on the floor for under 30 seconds shows 0. The engine used `minutes > 0` as "played", which left that game out of his games played, season totals and pre-game averages, and the box score listed him with the players who did not play. On the fixture season that is 8 player-games, with 1 assist, 1 field goal attempt and non-zero plus-minus in 3 of them. Team totals were not affected (they come from ESPN's team box). If one of these players had scored, the engine's "player points do not add up to the team score" check would have failed the run. Now `did_not_play` alone decides who played, and the box score shows these players on the bench with 0 minutes (docs/DECISIONS.md).
2. **Free throw rate is FTM / FGA,** not FTA / FGA. It is labeled that way on the site, but the numbers will not match Basketball-Reference's "FTr". This is the engine's choice and is kept.
3. **Free throw attempts have a better side in game gaps; field goal and three attempts do not.** Getting to the line is a good thing (free throws are the most efficient shot), so this is kept, but it is a judgment call.
4. **Team turnovers include team turnovers; player turnovers do not.** A team's turnovers can be 1 to 3 more than its players' (97 of 184 team-games on the fixture). Possessions and turnover % need the team figure, so this is right, but a box score total row should not be read as the sum of the player rows.
5. **Several ranked per-game stats depend on pace or roster shape more than quality**: rebounds, opponent rebounds, bench points, opponent bench points, threes made. Their better side is the obvious one, but a fast team ranks well in rebounds per game partly because there are more misses. Rebound % and the four factors are the fairer comparison.
6. **After a trade, `player_season.team_code` is the new team but the numbers cover both.** No trades yet on the fixture season.
