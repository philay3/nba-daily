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
    away_rest: int("away_rest"), // days of rest before this game (0 = back-to-back), null when unknown
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
    pts_off_to: int("pts_off_to").notNull(), // points off turnovers
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
    pts_off_to_pg: dbl("pts_off_to_pg"),
    opp_pts_off_to_pg: dbl("opp_pts_off_to_pg"),
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
