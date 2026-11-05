/**
 * Database schema: the single source of truth for every table.
 *
 * Keys are snake_case on purpose (same names in SQL, Python and the dashboard JSON).
 * After editing, run `npm run db:generate` and commit the new SQL in web/drizzle.
 *
 * Precision: computed stats are stored the way the original engine printed them
 * (one decimal; gap z-scores two decimals), so exports reproduce its JSON exactly.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const dbl = (name: string) => doublePrecision(name);
const int = (name: string) => integer(name);
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

/* ------------------------------------------------------------------ reference */

export const teams = pgTable("teams", {
  code: text("code").primaryKey(), // our code: GSW, NYK, NOP, SAS, UTA, WAS ...
  espn_id: int("espn_id"),
  espn_code: text("espn_code").notNull(), // ESPN's abbreviation: GS, NY, NO, SA, UTAH, WSH ...
  location: text("location").notNull(), // Golden State
  nickname: text("nickname").notNull(), // Warriors
  display_name: text("display_name").notNull(), // Golden State Warriors
  conference: text("conference").notNull(), // East | West
  primary_color: text("primary_color").notNull(), // #rrggbb
  secondary_color: text("secondary_color").notNull(),
  updated_at: updatedAt(),
});

export const players = pgTable(
  "players",
  {
    // ESPN athlete id; patch rows without an id use the engine's crc32 of "TEAM|Name" (needs bigint)
    id: bigint("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    short_name: text("short_name"),
    position: text("position").notNull().default(""),
    jersey: text("jersey"),
    team_code: text("team_code").references(() => teams.code), // latest team seen in a box score
    updated_at: updatedAt(),
  },
  (t) => [index("players_team_idx").on(t.team_code)],
);

/* ------------------------------------------------------------------ games and box scores */

export const games = pgTable(
  "games",
  {
    id: int("id").primaryKey(), // ESPN event id
    season: int("season").notNull(), // 2027 = the 2026-27 season
    season_type: int("season_type").notNull(), // 2 = regular season
    game_date: date("game_date", { mode: "string" }).notNull(), // America/New_York calendar date
    tip: timestamp("tip", { withTimezone: true, mode: "string" }),
    time_valid: boolean("time_valid").notNull().default(true), // false while ESPN lists the date but no tip time yet
    code: text("code").notNull(), // AWAY@HOME, e.g. TOR@LAL
    away_code: text("away_code").notNull().references(() => teams.code),
    home_code: text("home_code").notNull().references(() => teams.code),
    status: text("status").notNull(), // STATUS_FINAL, STATUS_SCHEDULED, STATUS_POSTPONED ...
    status_detail: text("status_detail"),
    away_score: int("away_score"),
    home_score: int("home_score"),
    winner_code: text("winner_code"),
    away_periods: integer("away_periods").array().notNull().default(sql`'{}'::integer[]`),
    home_periods: integer("home_periods").array().notNull().default(sql`'{}'::integer[]`),
    num_periods: int("num_periods"), // periods used for minutes and pace (4 + overtimes)
    ot: int("ot"), // overtime periods
    lead_changes: int("lead_changes"),
    tv: text("tv"), // label from the engine: national network name, "Monumental · League Pass", or "League Pass"
    broadcast_name: text("broadcast_name"),
    broadcast_market: text("broadcast_market"),
    espn_away_record: text("espn_away_record"), // records printed on ESPN's schedule
    espn_home_record: text("espn_home_record"),
    venue: text("venue"),
    city: text("city"),
    // days of rest before this game (0 = back-to-back), null for a team's first game. Up to tonight from the
    // games played; after tonight from the schedule (played or not, postponed games left out).
    away_rest: int("away_rest"),
    home_rest: int("home_rest"),
    away_record_before: text("away_record_before"), // W-L entering the game
    home_record_before: text("home_record_before"),
    upset: boolean("upset"), // winner had the worse record entering the game (2+ games played)
    box_source: text("box_source"), // mirror | raw | patch
    updated_at: updatedAt(),
  },
  (t) => [index("games_date_idx").on(t.game_date), index("games_season_idx").on(t.season)],
);

export const team_games = pgTable(
  "team_games",
  {
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    opp_code: text("opp_code")
      .notNull()
      .references(() => teams.code),
    home_away: text("home_away").notNull(), // home | away
    game_date: date("game_date", { mode: "string" }).notNull(),
    win: boolean("win").notNull(),
    pts: int("pts").notNull(),
    opp_pts: int("opp_pts").notNull(),
    fgm: int("fgm").notNull(),
    fga: int("fga").notNull(),
    tpm: int("tpm").notNull(),
    tpa: int("tpa").notNull(),
    ftm: int("ftm").notNull(),
    fta: int("fta").notNull(),
    oreb: int("oreb").notNull(),
    dreb: int("dreb").notNull(),
    reb: int("reb").notNull(),
    ast: int("ast").notNull(),
    stl: int("stl").notNull(),
    blk: int("blk").notNull(),
    tov: int("tov").notNull(), // total turnovers (player + team)
    team_tov: int("team_tov"),
    pf: int("pf").notNull(),
    tech_fouls: int("tech_fouls"),
    flagrant_fouls: int("flagrant_fouls"),
    fb: int("fb").notNull(), // fast-break points
    paint: int("paint").notNull(), // points in the paint
    pts_off_to: int("pts_off_to").notNull(), // points scored off the opponent's turnovers (the opponent's ESPN turnoverPoints)
    bench_pts: int("bench_pts").notNull(),
    largest_lead: int("largest_lead").notNull(),
    lead_changes: int("lead_changes").notNull(),
    num_periods: int("num_periods").notNull(),
    minutes: int("minutes").notNull(), // 48 + 5 per overtime
    poss: dbl("poss"), // (FGA - OREB + TOV + 0.44 FTA), averaged for both teams
    ortg: dbl("ortg"),
    drtg: dbl("drtg"),
    net: dbl("net"),
    pace: dbl("pace"),
    fg_pct: dbl("fg_pct"),
    fg3_pct: dbl("fg3_pct"),
    ft_pct: dbl("ft_pct"),
    efg: dbl("efg"),
    tov_pct: dbl("tov_pct"),
    orb_pct: dbl("orb_pct"),
    ftr: dbl("ftr"),
    ast_pct: dbl("ast_pct"),
    opp_efg: dbl("opp_efg"),
    opp_tov_pct: dbl("opp_tov_pct"),
    drb_pct: dbl("drb_pct"),
    opp_ftr: dbl("opp_ftr"),
    updated_at: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.game_id, t.team_code] }), index("team_games_team_idx").on(t.team_code, t.game_date)],
);

export const player_games = pgTable(
  "player_games",
  {
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    player_id: bigint("player_id", { mode: "number" })
      .notNull()
      .references(() => players.id),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    opp_code: text("opp_code")
      .notNull()
      .references(() => teams.code),
    home_away: text("home_away").notNull(),
    game_date: date("game_date", { mode: "string" }).notNull(),
    name: text("name").notNull(), // as printed in this box score
    position: text("position").notNull().default(""),
    starter: boolean("starter").notNull(),
    did_not_play: boolean("did_not_play").notNull(),
    reason: text("reason"), // ESPN's DNP reason (raw); only meaningful when the player did not play
    ejected: boolean("ejected"),
    box_order: int("box_order").notNull(), // starters, then bench by minutes, then did-not-play
    min: dbl("min"),
    pts: int("pts"),
    fgm: int("fgm"),
    fga: int("fga"),
    tpm: int("tpm"),
    tpa: int("tpa"),
    ftm: int("ftm"),
    fta: int("fta"),
    oreb: int("oreb"),
    dreb: int("dreb"),
    reb: int("reb"),
    ast: int("ast"),
    stl: int("stl"),
    blk: int("blk"),
    tov: int("tov"),
    pf: int("pf"),
    plus_minus: int("plus_minus"),
    ts_pct: dbl("ts_pct"),
    updated_at: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.game_id, t.player_id] }),
    index("player_games_player_idx").on(t.player_id, t.game_date),
    index("player_games_team_idx").on(t.team_code, t.game_date),
  ],
);

/* ------------------------------------------------------------------ computed, rebuilt every run */

export const team_season = pgTable(
  "team_season",
  {
    season: int("season").notNull(),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    as_of: date("as_of", { mode: "string" }).notNull(), // run date; stats cover games before it
    gp: int("gp").notNull(),
    w: int("w").notNull(),
    l: int("l").notNull(),
    home_rec: text("home_rec").notNull(),
    road_rec: text("road_rec").notNull(),
    streak: text("streak").notNull(), // W3, L2, or ""
    l5_rec: text("l5_rec").notNull(),
    record_seed: int("record_seed"), // conference seed by record
    seed: int("seed"), // official seed when supplied, else record_seed
    seed_source: text("seed_source"), // record | official
    ortg: dbl("ortg"),
    drtg: dbl("drtg"),
    net: dbl("net"),
    l5_net: dbl("l5_net"),
    pace: dbl("pace"),
    ppg: dbl("ppg"),
    opp_ppg: dbl("opp_ppg"),
    diff: dbl("diff"),
    efg: dbl("efg"),
    tov_pct: dbl("tov_pct"),
    orb_pct: dbl("orb_pct"),
    ftr: dbl("ftr"),
    opp_efg: dbl("opp_efg"),
    opp_tov_pct: dbl("opp_tov_pct"),
    drb_pct: dbl("drb_pct"),
    opp_ftr: dbl("opp_ftr"),
    fg_pct: dbl("fg_pct"),
    fg3_pct: dbl("fg3_pct"),
    ft_pct: dbl("ft_pct"),
    fg3a_rate: dbl("fg3a_rate"),
    fg3m_pg: dbl("fg3m_pg"),
    opp_fg_pct: dbl("opp_fg_pct"),
    opp_fg3_pct: dbl("opp_fg3_pct"),
    opp_fg3m_pg: dbl("opp_fg3m_pg"),
    rpg: dbl("rpg"),
    opp_rpg: dbl("opp_rpg"),
    apg: dbl("apg"),
    spg: dbl("spg"),
    bpg: dbl("bpg"),
    tovpg: dbl("tovpg"),
    forced_tovpg: dbl("forced_tovpg"),
    fb_pg: dbl("fb_pg"),
    opp_fb_pg: dbl("opp_fb_pg"),
    paint_pg: dbl("paint_pg"),
    opp_paint_pg: dbl("opp_paint_pg"),
    pts_off_to_pg: dbl("pts_off_to_pg"), // points scored off the opponent's turnovers
    opp_pts_off_to_pg: dbl("opp_pts_off_to_pg"), // points allowed off this team's turnovers
    bench_ppg: dbl("bench_ppg"),
    opp_bench_ppg: dbl("opp_bench_ppg"),
    // league ranks, 1 = best (pace 1 = fastest)
    ortg_rk: int("ortg_rk"),
    net_rk: int("net_rk"),
    l5_net_rk: int("l5_net_rk"),
    ppg_rk: int("ppg_rk"),
    diff_rk: int("diff_rk"),
    efg_rk: int("efg_rk"),
    orb_pct_rk: int("orb_pct_rk"),
    ftr_rk: int("ftr_rk"),
    opp_tov_pct_rk: int("opp_tov_pct_rk"),
    drb_pct_rk: int("drb_pct_rk"),
    fg_pct_rk: int("fg_pct_rk"),
    fg3_pct_rk: int("fg3_pct_rk"),
    ft_pct_rk: int("ft_pct_rk"),
    rpg_rk: int("rpg_rk"),
    apg_rk: int("apg_rk"),
    spg_rk: int("spg_rk"),
    bpg_rk: int("bpg_rk"),
    forced_tovpg_rk: int("forced_tovpg_rk"),
    fb_pg_rk: int("fb_pg_rk"),
    paint_pg_rk: int("paint_pg_rk"),
    pts_off_to_pg_rk: int("pts_off_to_pg_rk"),
    bench_ppg_rk: int("bench_ppg_rk"),
    fg3m_pg_rk: int("fg3m_pg_rk"),
    pace_rk: int("pace_rk"),
    fg3a_rate_rk: int("fg3a_rate_rk"),
    drtg_rk: int("drtg_rk"),
    opp_ppg_rk: int("opp_ppg_rk"),
    tov_pct_rk: int("tov_pct_rk"),
    opp_efg_rk: int("opp_efg_rk"),
    opp_ftr_rk: int("opp_ftr_rk"),
    opp_fg_pct_rk: int("opp_fg_pct_rk"),
    opp_fg3_pct_rk: int("opp_fg3_pct_rk"),
    opp_rpg_rk: int("opp_rpg_rk"),
    tovpg_rk: int("tovpg_rk"),
    opp_fb_pg_rk: int("opp_fb_pg_rk"),
    opp_paint_pg_rk: int("opp_paint_pg_rk"),
    opp_pts_off_to_pg_rk: int("opp_pts_off_to_pg_rk"),
    opp_bench_ppg_rk: int("opp_bench_ppg_rk"),
    opp_fg3m_pg_rk: int("opp_fg3m_pg_rk"),
    updated_at: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.season, t.team_code] })],
);

export const player_season = pgTable(
  "player_season",
  {
    season: int("season").notNull(),
    player_id: bigint("player_id", { mode: "number" })
      .notNull()
      .references(() => players.id),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code), // team in his latest game
    as_of: date("as_of", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    position: text("position").notNull().default(""),
    gp: int("gp").notNull(),
    gs: int("gs").notNull(),
    mpg: dbl("mpg"),
    ppg: dbl("ppg"),
    rpg: dbl("rpg"),
    orpg: dbl("orpg"),
    apg: dbl("apg"),
    spg: dbl("spg"),
    bpg: dbl("bpg"),
    tovpg: dbl("tovpg"),
    pfpg: dbl("pfpg"),
    fg_pct: dbl("fg_pct"),
    fg3m_pg: dbl("fg3m_pg"),
    fg3_pct: dbl("fg3_pct"),
    ft_pct: dbl("ft_pct"),
    ts_pct: dbl("ts_pct"),
    pm_total: int("pm_total"),
    pm_pg: dbl("pm_pg"),
    hi_pts: int("hi_pts"),
    team_mpg_rank: int("team_mpg_rank").notNull(), // 1 = most minutes per game on his team
    updated_at: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.season, t.player_id] }), index("player_season_team_idx").on(t.season, t.team_code)],
);

/** Team-vs-team gap for every stat of every game, scored against the season's usual gap. */
export const game_gaps = pgTable(
  "game_gaps",
  {
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // pts, efg, tov_pct ...
    sort_order: int("sort_order").notNull(),
    grp: text("grp").notNull(), // Scoring | Shooting | Possession | Playmaking | Defense | Flow
    stat: text("stat").notNull(), // label, e.g. "Effective FG %"
    away_code: text("away_code").notNull(),
    home_code: text("home_code").notNull(),
    away_val: dbl("away_val").notNull(),
    home_val: dbl("home_val").notNull(),
    away_txt: text("away_txt").notNull(),
    home_txt: text("home_txt").notNull(),
    gap: dbl("gap").notNull(), // |away - home|
    gap_txt: text("gap_txt").notNull(),
    edge: text("edge").notNull(), // team code with the better number ("" when even)
    edge_txt: text("edge_txt").notNull(),
    z: dbl("z").notNull(), // |gap| / std of road-minus-home gaps this season
    sd: dbl("sd"),
    level: text("level").notNull(), // Major (z >= 1.5) | Notable (z >= 1.0) | ""
    volume: boolean("volume").notNull(), // attempts: no better side
  },
  (t) => [primaryKey({ columns: [t.game_id, t.key] })],
);

/** Each player's line against his averages before that game date, with the engine's flags. */
export const player_game_deltas = pgTable(
  "player_game_deltas",
  {
    game_id: int("game_id").notNull(),
    player_id: bigint("player_id", { mode: "number" }).notNull(),
    team_code: text("team_code").notNull(),
    game_date: date("game_date", { mode: "string" }).notNull(),
    gp_before: int("gp_before").notNull(),
    avg_min: dbl("avg_min"),
    avg_pts: dbl("avg_pts"),
    avg_reb: dbl("avg_reb"),
    avg_ast: dbl("avg_ast"),
    avg_pm: dbl("avg_pm"),
    d_pts: dbl("d_pts"),
    d_reb: dbl("d_reb"),
    d_ast: dbl("d_ast"),
    d_min: dbl("d_min"),
    flags: text("flags").notNull().default(""), // joined with " · ", e.g. "PTS +12 vs avg · Double-double"
  },
  (t) => [
    primaryKey({ columns: [t.game_id, t.player_id] }),
    foreignKey({
      name: "player_game_deltas_player_games_fk",
      columns: [t.game_id, t.player_id],
      foreignColumns: [player_games.game_id, player_games.player_id],
    }).onDelete("cascade"),
    index("player_game_deltas_player_idx").on(t.player_id),
  ],
);

/* ------------------------------------------------------------------ shots */

/**
 * One row per field goal attempt, from hoopR's shot file (ESPN play-by-play). No free throws, and no missed
 * end-of-quarter heaves, which the box score does not count as attempts. Coordinates are ESPN's, in whole feet,
 * measured toward the basket the team attacks (docs/DATA.md). Rewritten per game when that game's shots change.
 */
export const shots = pgTable(
  "shots",
  {
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    seq: smallint("seq").notNull(), // order within the game, 1 = first attempt
    season: int("season").notNull(),
    game_date: date("game_date", { mode: "string" }).notNull(),
    period: smallint("period").notNull(),
    clock: text("clock").notNull(), // as a broadcast shows it: 11:43, or 58.3 in the last minute
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    opp_code: text("opp_code")
      .notNull()
      .references(() => teams.code),
    player_id: bigint("player_id", { mode: "number" })
      .notNull()
      .references(() => players.id),
    assist_id: bigint("assist_id", { mode: "number" }), // the passer on an assisted make
    shot_type: text("shot_type").notNull(), // ESPN's play type: Driving Layup Shot, Pullup Jump Shot ...
    made: boolean("made").notNull(),
    points: smallint("points").notNull(), // 2 or 3 on a make, 0 on a miss
    three: boolean("three").notNull(), // a three-point attempt (makes by their points, misses by the line)
    x: smallint("x").notNull(), // feet left or right of the rim, -25 to 25
    y: smallint("y").notNull(), // feet out from the rim toward half court; the baseline is at -5, half court at 41.75
    distance: dbl("distance").notNull(), // feet from the rim
    zone: text("zone").notNull(), // restricted_area | paint | midrange | corner_3 | above_break_3 | backcourt
    assisted: boolean("assisted").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.game_id, t.seq] }),
    index("shots_player_idx").on(t.season, t.player_id),
    index("shots_team_idx").on(t.season, t.team_code),
    index("shots_opp_idx").on(t.season, t.opp_code),
  ],
);

/** Per game: how many shots are stored and a hash of them, so a run rewrites only the games whose shots changed. */
export const shot_games = pgTable(
  "shot_games",
  {
    game_id: int("game_id")
      .primaryKey()
      .references(() => games.id, { onDelete: "cascade" }),
    season: int("season").notNull(),
    shots: int("shots").notNull(),
    fingerprint: text("fingerprint").notNull(),
    updated_at: updatedAt(),
  },
  (t) => [index("shot_games_season_idx").on(t.season)],
);

// zone profiles share one set of numbers; zone is one of the six zones above, or "all"
const zoneNumbers = () => ({
  fga: int("fga").notNull(),
  fgm: int("fgm").notNull(),
  pts: int("pts").notNull(),
  ast: int("ast").notNull(), // assisted makes
  fg_pct: dbl("fg_pct"),
  pps: dbl("pps"), // points per shot, two decimals
  share: dbl("share"), // % of this subject's attempts taken from the zone
  ast_pct: dbl("ast_pct"), // % of makes that were assisted
});
const againstLeague = () => ({
  lg_fg_pct: dbl("lg_fg_pct"), // league numbers for the same zone, this season through the run date
  lg_pps: dbl("lg_pps"),
  lg_share: dbl("lg_share"),
  fg_pct_diff: dbl("fg_pct_diff"), // fg_pct - lg_fg_pct, both as printed
});

/** Every shot in the league by zone, this season through the run date. */
export const league_shot_zones = pgTable(
  "league_shot_zones",
  {
    season: int("season").notNull(),
    zone: text("zone").notNull(),
    as_of: date("as_of", { mode: "string" }).notNull(),
    ...zoneNumbers(),
  },
  (t) => [primaryKey({ columns: [t.season, t.zone] })],
);

/** Each team's shots by zone (offense) and its opponents' shots against it (defense). */
export const team_shot_zones = pgTable(
  "team_shot_zones",
  {
    season: int("season").notNull(),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    side: text("side").notNull(), // offense | defense
    zone: text("zone").notNull(),
    as_of: date("as_of", { mode: "string" }).notNull(),
    ...zoneNumbers(),
    ...againstLeague(),
  },
  (t) => [primaryKey({ columns: [t.season, t.team_code, t.side, t.zone] })],
);

export const player_shot_zones = pgTable(
  "player_shot_zones",
  {
    season: int("season").notNull(),
    player_id: bigint("player_id", { mode: "number" })
      .notNull()
      .references(() => players.id),
    zone: text("zone").notNull(),
    team_code: text("team_code").references(() => teams.code), // team in his latest game
    as_of: date("as_of", { mode: "string" }).notNull(),
    ...zoneNumbers(),
    ...againstLeague(),
  },
  (t) => [primaryKey({ columns: [t.season, t.player_id, t.zone] })],
);

/** Each team's shots by zone in one game, against the league this season. */
export const game_shot_zones = pgTable(
  "game_shot_zones",
  {
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    zone: text("zone").notNull(),
    ...zoneNumbers(),
    ...againstLeague(),
  },
  (t) => [primaryKey({ columns: [t.game_id, t.team_code, t.zone] })],
);

/* ------------------------------------------------------------------ play-by-play, computed (no raw plays are stored) */

/**
 * The score after every scoring play (the worm chart), with lead and clutch summaries.
 * Times are elapsed game seconds: 0 at tip-off, 2880 at the end of regulation, +300 per overtime.
 */
export const game_flow = pgTable("game_flow", {
  game_id: int("game_id")
    .primaryKey()
    .references(() => games.id, { onDelete: "cascade" }),
  num_periods: int("num_periods").notNull(),
  t: doublePrecision("t").array().notNull(), // elapsed seconds at each scoring play
  away: integer("away").array().notNull(), // road score after each scoring play
  home: integer("home").array().notNull(), // home score after each scoring play
  lead_changes: int("lead_changes").notNull(),
  times_tied: int("times_tied").notNull(), // after a scoring play, not counting 0-0
  away_largest_lead: int("away_largest_lead").notNull(),
  home_largest_lead: int("home_largest_lead").notNull(),
  away_lead_secs: dbl("away_lead_secs"), // time the road team led
  home_lead_secs: dbl("home_lead_secs"),
  tied_secs: dbl("tied_secs"),
  clutch_secs: dbl("clutch_secs"), // time in clutch: last 5 minutes of the 4th or overtime, margin within 5
  stints: int("stints").notNull(), // stretches with the same ten players
  lineup_repairs: int("lineup_repairs").notNull(), // team-periods where ESPN's substitution rows needed a fix
  minutes_off: int("minutes_off").notNull(), // players whose rebuilt minutes differ from the box score by more than 1
});

/** Unanswered scoring runs of 8 points or more, and each team's biggest run of the game. */
export const game_runs = pgTable(
  "game_runs",
  {
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    seq: int("seq").notNull(), // order in the game
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    pts: int("pts").notNull(), // the run: pts to 0
    plays: int("plays").notNull(), // scoring plays in the run
    start_t: dbl("start_t").notNull(), // elapsed seconds at the first and last scoring play of the run
    end_t: dbl("end_t").notNull(),
    start_period: int("start_period").notNull(),
    start_clock: text("start_clock").notNull(), // game clock, "7:45" or "24.6"
    end_period: int("end_period").notNull(),
    end_clock: text("end_clock").notNull(),
    away_before: int("away_before").notNull(), // score when the run began and ended
    home_before: int("home_before").notNull(),
    away_after: int("away_after").notNull(),
    home_after: int("home_after").notNull(),
    biggest: boolean("biggest").notNull(), // this team's biggest run of the game
  },
  (t) => [primaryKey({ columns: [t.game_id, t.seq] })],
);

/** Five-man units in one game. A lineup id is the five ESPN player ids, sorted, joined with "-". */
export const lineup_games = pgTable(
  "lineup_games",
  {
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    lineup_id: text("lineup_id").notNull(),
    player_ids: bigint("player_ids", { mode: "number" }).array().notNull(),
    secs: dbl("secs").notNull(),
    poss: dbl("poss").notNull(), // (FGA - OREB + TOV + 0.44 FTA), averaged for both teams, while this unit played
    pts: int("pts").notNull(),
    opp_pts: int("opp_pts").notNull(),
  },
  (t) => [primaryKey({ columns: [t.game_id, t.team_code, t.lineup_id] }), index("lineup_games_team_idx").on(t.team_code)],
);

/** Five-man units over the season so far, rebuilt every run. */
export const lineup_season = pgTable(
  "lineup_season",
  {
    season: int("season").notNull(),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    lineup_id: text("lineup_id").notNull(),
    player_ids: bigint("player_ids", { mode: "number" }).array().notNull(),
    as_of: date("as_of", { mode: "string" }).notNull(),
    games: int("games").notNull(),
    secs: dbl("secs").notNull(),
    poss: dbl("poss").notNull(),
    pts: int("pts").notNull(),
    opp_pts: int("opp_pts").notNull(),
    ortg: dbl("ortg"), // points per 100 possessions
    drtg: dbl("drtg"),
    net: dbl("net"),
    updated_at: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.season, t.team_code, t.lineup_id] })],
);

/**
 * Team ratings with a player on and off the floor. "Off" is his team's minutes without him in the games he played.
 * pm is the on-floor scoring margin (the box score's plus-minus, rebuilt from the play-by-play).
 */
export const player_on_off = pgTable(
  "player_on_off",
  {
    season: int("season").notNull(),
    player_id: bigint("player_id", { mode: "number" })
      .notNull()
      .references(() => players.id),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    as_of: date("as_of", { mode: "string" }).notNull(),
    games: int("games").notNull(),
    on_secs: dbl("on_secs").notNull(),
    on_poss: dbl("on_poss").notNull(),
    on_pts: int("on_pts").notNull(),
    on_opp_pts: int("on_opp_pts").notNull(),
    on_ortg: dbl("on_ortg"),
    on_drtg: dbl("on_drtg"),
    on_net: dbl("on_net"),
    off_secs: dbl("off_secs").notNull(),
    off_poss: dbl("off_poss").notNull(),
    off_pts: int("off_pts").notNull(),
    off_opp_pts: int("off_opp_pts").notNull(),
    off_ortg: dbl("off_ortg"),
    off_drtg: dbl("off_drtg"),
    off_net: dbl("off_net"),
    on_off: dbl("on_off"), // on_net - off_net
    pm: int("pm").notNull(),
    updated_at: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.season, t.player_id, t.team_code] }), index("player_on_off_team_idx").on(t.season, t.team_code)],
);

/** Clutch time (last 5 minutes of the 4th quarter or overtime, margin within 5), team totals. */
export const team_clutch = pgTable(
  "team_clutch",
  {
    season: int("season").notNull(),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    as_of: date("as_of", { mode: "string" }).notNull(),
    games: int("games").notNull(), // games with clutch time
    w: int("w").notNull(), // record in those games
    l: int("l").notNull(),
    secs: dbl("secs").notNull(),
    poss: dbl("poss").notNull(),
    pts: int("pts").notNull(),
    opp_pts: int("opp_pts").notNull(),
    ortg: dbl("ortg"),
    drtg: dbl("drtg"),
    net: dbl("net"),
    pm: int("pm").notNull(), // pts - opp_pts
    fgm: int("fgm").notNull(),
    fga: int("fga").notNull(),
    fg_pct: dbl("fg_pct"),
    tpm: int("tpm").notNull(),
    tpa: int("tpa").notNull(),
    ftm: int("ftm").notNull(),
    fta: int("fta").notNull(),
    updated_at: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.season, t.team_code] })],
);

/** Clutch time per player: his own scoring, and the team's margin and ratings while he was on the floor. */
export const player_clutch = pgTable(
  "player_clutch",
  {
    season: int("season").notNull(),
    player_id: bigint("player_id", { mode: "number" })
      .notNull()
      .references(() => players.id),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    as_of: date("as_of", { mode: "string" }).notNull(),
    games: int("games").notNull(), // games with clutch minutes on the floor
    secs: dbl("secs").notNull(),
    pts: int("pts").notNull(),
    fgm: int("fgm").notNull(),
    fga: int("fga").notNull(),
    fg_pct: dbl("fg_pct"),
    tpm: int("tpm").notNull(),
    tpa: int("tpa").notNull(),
    ftm: int("ftm").notNull(),
    fta: int("fta").notNull(),
    pm: int("pm").notNull(), // on-floor margin in clutch time
    poss: dbl("poss").notNull(),
    ortg: dbl("ortg"),
    drtg: dbl("drtg"),
    net: dbl("net"),
    updated_at: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.season, t.player_id, t.team_code] }), index("player_clutch_team_idx").on(t.season, t.team_code)],
);

/* ------------------------------------------------------------------ power ratings and the game model */

/**
 * Opponent-adjusted ratings per 100 possessions, one row per team for every date of the season: the ridge fit on
 * the games played before that date (so the ratings a game was predicted with). Rebuilt for the season every run.
 */
export const power_ratings = pgTable(
  "power_ratings",
  {
    season: int("season").notNull(),
    as_of: date("as_of", { mode: "string" }).notNull(), // fit on games before this date
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    games: int("games").notNull(), // this team's games in the fit
    adj_ortg: dbl("adj_ortg"), // points scored per 100 possessions against an average defense, on a neutral floor
    adj_drtg: dbl("adj_drtg"), // points allowed per 100 against an average offense
    adj_net: dbl("adj_net"), // adj_ortg - adj_drtg
    ortg_rk: int("ortg_rk"), // 1 = best (highest)
    drtg_rk: int("drtg_rk"), // 1 = best (lowest)
    net_rk: int("net_rk"),
    ortg: dbl("ortg"), // the same games without the adjustment
    drtg: dbl("drtg"),
    net: dbl("net"),
    pace: dbl("pace"), // possessions per 48, pulled toward the league's (what projections use)
  },
  (t) => [primaryKey({ columns: [t.season, t.as_of, t.team_code] }), index("power_ratings_team_idx").on(t.season, t.team_code)],
);

/** League numbers behind each date's fit: average rating, home court and the spread of results the model uses. */
export const model_days = pgTable(
  "model_days",
  {
    season: int("season").notNull(),
    as_of: date("as_of", { mode: "string" }).notNull(),
    games: int("games").notNull(), // games in the fit
    league_ortg: dbl("league_ortg"), // points per 100 possessions
    home_court: dbl("home_court"), // points at the league's pace
    sigma: dbl("sigma"), // spread of results around the predicted margin, points
    sigma_games: int("sigma_games").notNull(), // this season's games behind sigma (it starts at 12 points)
    pace: dbl("pace"),
  },
  (t) => [primaryKey({ columns: [t.season, t.as_of] })],
);

/**
 * The model's prediction for every finished game (as of its date: games before it only) and for every game in
 * the next 3 days (as of the run date), next to ESPN's line. Margins are home minus road.
 */
export const model_games = pgTable(
  "model_games",
  {
    game_id: int("game_id")
      .primaryKey()
      .references(() => games.id, { onDelete: "cascade" }),
    season: int("season").notNull(),
    game_date: date("game_date", { mode: "string" }).notNull(),
    as_of: date("as_of", { mode: "string" }).notNull(), // the ratings used: fit on games before this date
    fit_games: int("fit_games").notNull(),
    away_code: text("away_code")
      .notNull()
      .references(() => teams.code),
    home_code: text("home_code")
      .notNull()
      .references(() => teams.code),
    away_rest: int("away_rest"), // days of rest from the schedule, null for a first game
    home_rest: int("home_rest"),
    poss: dbl("poss"), // expected possessions
    home_court: dbl("home_court"), // points of the margin from home court
    rest_adj: dbl("rest_adj"), // points of the margin from back-to-backs (+ helps the home team)
    pred_margin: dbl("pred_margin"), // predicted home margin
    home_wp: dbl("home_wp"), // home win chance, 0-100
    sigma: dbl("sigma"),
    line_margin: dbl("line_margin"), // ESPN's line as the expected home margin (+ = home favored)
    line_source: text("line_source"), // pbp (pregame spread in the play-by-play) | odds (this run's odds)
    actual_margin: int("actual_margin"), // null until played
    pick: text("pick"), // home | away: the side the model likes against the line
    ats: text("ats"), // W | L | P for the pick, null without a pick or a result
  },
  (t) => [index("model_games_date_idx").on(t.season, t.game_date)],
);

/** Backtest of this season's finished games against ESPN's pregame line. Rebuilt every run. */
export const model_backtest = pgTable("model_backtest", {
  season: int("season").primaryKey(),
  as_of: date("as_of", { mode: "string" }).notNull(),
  games: int("games").notNull(), // finished games predicted
  line_games: int("line_games").notNull(), // of those, games with an ESPN line
  model_mae_all: dbl("model_mae_all"), // mean absolute error of the margin, all games
  model_mae: dbl("model_mae"), // on games with a line
  line_mae: dbl("line_mae"),
  ats_w: int("ats_w").notNull(), // the model's record against the line
  ats_l: int("ats_l").notNull(),
  ats_p: int("ats_p").notNull(),
  su_games: int("su_games").notNull(), // games where the model picked a winner
  su_right: int("su_right").notNull(),
  line_su_games: int("line_su_games").notNull(), // games where the line had a favorite
  line_su_right: int("line_su_right").notNull(),
  model_su_on_line_games: int("model_su_on_line_games").notNull(), // the model's winners right on those games
  brier: dbl("brier"), // mean squared error of the win chance (0-1 scale)
  home_court: dbl("home_court"), // as of the run date
  sigma: dbl("sigma"),
  updated_at: updatedAt(),
});

/** Calibration of the win chance: games binned by the favorite's chance, and how often the favorite won. */
export const model_calibration = pgTable(
  "model_calibration",
  {
    season: int("season").notNull(),
    lo: int("lo").notNull(), // bin, favorite's win chance in percent: lo <= chance < hi
    hi: int("hi").notNull(),
    games: int("games").notNull(),
    wins: int("wins").notNull(), // favorite won
    mean_wp: dbl("mean_wp"),
    win_pct: dbl("win_pct"),
  },
  (t) => [primaryKey({ columns: [t.season, t.lo] })],
);

/* ------------------------------------------------------------------ story finder, rebuilt every run */

/**
 * Each player's baselines from every game he played before the run date: season and last 10 games.
 * One row per stat (pts, reb, ast, tpm, plus_minus, ts_pct). True shooting counts games with 5+ shooting attempts.
 */
export const player_baselines = pgTable(
  "player_baselines",
  {
    season: int("season").notNull(),
    player_id: bigint("player_id", { mode: "number" })
      .notNull()
      .references(() => players.id),
    stat: text("stat").notNull(),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code), // team in his latest game
    as_of: date("as_of", { mode: "string" }).notNull(),
    gp: int("gp").notNull(), // games in the season baseline
    mean: dbl("mean"),
    sd: dbl("sd"), // sample standard deviation, null with fewer than 2 games
    l10_gp: int("l10_gp").notNull(),
    l10_mean: dbl("l10_mean"),
    l10_sd: dbl("l10_sd"),
  },
  (t) => [primaryKey({ columns: [t.season, t.player_id, t.stat] })],
);

/**
 * The top 20 story ideas of each game night, ranked by score (rarity x prominence). Rebuilt for the whole season
 * every run; a night's numbers use only games before it (docs/DATA.md, "Story finder").
 */
export const stories = pgTable(
  "stories",
  {
    story_date: date("story_date", { mode: "string" }).notNull(), // the game night (America/New_York date)
    rank: int("rank").notNull(), // 1 = best story of the night
    story_id: text("story_id").notNull(), // kind:subtype:player or team:game
    season: int("season").notNull(),
    kind: text("kind").notNull(), // outlier | streak | first | rare | team
    subtype: text("subtype").notNull(), // pts_high, pts20, 30_10_10, hot ...
    player_id: bigint("player_id", { mode: "number" }).references(() => players.id), // null for team stories
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    opp_code: text("opp_code").notNull(),
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    headline: text("headline").notNull(),
    detail: text("detail").notNull(),
    value: dbl("value"), // the night's number (or streak length, or a team's recent net rating)
    baseline: dbl("baseline"), // the average it is compared with
    sd: dbl("sd"), // the spread used for z (floored, see DATA.md)
    z: dbl("z"),
    games: int("games"), // sample behind the baseline or rate
    rarity: dbl("rarity").notNull(), // a z-score, or the z-score of a probability, capped at 5
    prominence: dbl("prominence").notNull(), // 0 to 1: minutes and usage
    score: dbl("score").notNull(), // rarity x (0.5 + prominence)
    evidence: jsonb("evidence").notNull(), // the numbers behind the story
  },
  (t) => [
    primaryKey({ columns: [t.story_date, t.rank] }),
    index("stories_season_idx").on(t.season),
    index("stories_player_idx").on(t.player_id),
  ],
);

/* ------------------------------------------------------------------ daily snapshots */

export const injuries = pgTable(
  "injuries",
  {
    snapshot_date: date("snapshot_date", { mode: "string" }).notNull(),
    team_code: text("team_code")
      .notNull()
      .references(() => teams.code),
    player_name: text("player_name").notNull(), // as ESPN writes it (box-score spelling when they differ)
    player_id: bigint("player_id", { mode: "number" }), // matched by team + exact name, null when he has no games
    game_id: int("game_id"), // his team's game that night
    game_code: text("game_code"),
    position: text("position").notNull().default(""),
    status: text("status").notNull(), // Out | Doubtful | Questionable | Probable | Day-to-day
    injury: text("injury").notNull().default(""),
    note: text("note").notNull().default(""),
    return_date: date("return_date", { mode: "string" }),
    sort_order: int("sort_order").notNull(),
    source: text("source").notNull(), // espn | file
    fetched_at: timestamp("fetched_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.snapshot_date, t.team_code, t.player_name] })],
);

export const odds = pgTable(
  "odds",
  {
    snapshot_date: date("snapshot_date", { mode: "string" }).notNull(),
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    game_code: text("game_code").notNull(),
    provider: text("provider"),
    line: text("line"), // "CLE -4.5" or "EVEN", our team codes
    spread_abs: dbl("spread_abs"),
    total: dbl("total"),
    away_ml: int("away_ml"),
    home_ml: int("home_ml"),
    away_wp: dbl("away_wp"), // win odds 0-100
    home_wp: dbl("home_wp"),
    wp_source: text("wp_source"), // input | espn_predictor | moneyline
    source: text("source").notNull(), // espn | file
    fetched_at: timestamp("fetched_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.snapshot_date, t.game_id] })],
);

/**
 * The look-ahead for the next 3 days (tonight, tomorrow, the day after), rebuilt by every run for its date.
 * Records are through the run's date; the injury columns use that run's injury report.
 */
export const game_previews = pgTable(
  "game_previews",
  {
    snapshot_date: date("snapshot_date", { mode: "string" }).notNull(), // the run's date
    game_id: int("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    game_code: text("game_code").notNull(),
    game_date: date("game_date", { mode: "string" }).notNull(),
    days_ahead: int("days_ahead").notNull(), // 0 = tonight, 1 = tomorrow, 2 = the day after
    away_code: text("away_code")
      .notNull()
      .references(() => teams.code),
    home_code: text("home_code")
      .notNull()
      .references(() => teams.code),
    away_w: int("away_w").notNull(), // record through the run's date (games before it)
    away_l: int("away_l").notNull(),
    home_w: int("home_w").notNull(),
    home_l: int("home_l").notNull(),
    away_rest: int("away_rest"), // days of rest from the schedule, null for a first game
    home_rest: int("home_rest"),
    away_b2b: boolean("away_b2b").notNull(), // played the day before (second night of a back-to-back)
    home_b2b: boolean("home_b2b").notNull(),
    away_b2b_next: boolean("away_b2b_next").notNull(), // plays again the next day (first night of a back-to-back)
    home_b2b_next: boolean("home_b2b_next").notNull(),
    injury_report: date("injury_report", { mode: "string" }), // date of the injury report used, null when none covers this game
    away_out: int("away_out"), // players listed Out or Doubtful, null without a report
    home_out: int("home_out"),
    away_missing_ppg: dbl("away_missing_ppg"), // their season points per game (team + exact name match)
    home_missing_ppg: dbl("home_missing_ppg"),
  },
  (t) => [primaryKey({ columns: [t.snapshot_date, t.game_id] }), index("game_previews_date_idx").on(t.game_date)],
);

/** Picks, tags, notes and brief rows for a date. */
export const editorial = pgTable(
  "editorial",
  {
    date: date("date", { mode: "string" }).notNull(),
    kind: text("kind").notNull(), // game | result | date | headline | surprise
    ref: text("ref").notNull(), // game code for game/result rows, position in the brief otherwise
    seq: int("seq").notNull().default(0), // output order within the kind (brief rows)
    sort_order: int("sort_order").notNull().default(0), // the brief's own "order" field
    watch: int("watch"), // games to watch: 1-6
    tag: text("tag").notNull().default(""),
    title: text("title").notNull().default(""),
    text: text("text").notNull().default(""),
    source: text("source").notNull(), // file | engine | claude
    updated_at: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.date, t.kind, t.ref] })],
);

export const pipeline_runs = pgTable(
  "pipeline_runs",
  {
    id: serial("id").primaryKey(),
    run_date: date("run_date", { mode: "string" }).notNull(),
    season: int("season").notNull(),
    command: text("command").notNull(), // run | seed
    status: text("status").notNull(), // running | ok | error
    started_at: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    finished_at: timestamp("finished_at", { withTimezone: true, mode: "string" }),
    args: jsonb("args"),
    counts: jsonb("counts"),
    notes: jsonb("notes"),
    warnings: jsonb("warnings"),
    errors: jsonb("errors"),
    error: text("error"),
  },
  (t) => [index("pipeline_runs_date_idx").on(t.run_date)],
);
