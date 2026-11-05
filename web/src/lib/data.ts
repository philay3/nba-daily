import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, lte, max, ne, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { MISSING_STATUSES } from "@/lib/metrics";
import type { StoryFilters } from "@/lib/stories";
import { addDays, daysBetween, isIsoDate, todayET } from "@/lib/format";

export type Team = typeof t.teams.$inferSelect;
export type Game = typeof t.games.$inferSelect;
export type TeamGame = typeof t.team_games.$inferSelect;
export type PlayerGame = typeof t.player_games.$inferSelect;
export type Delta = typeof t.player_game_deltas.$inferSelect;
export type TeamSeason = typeof t.team_season.$inferSelect;
export type PlayerSeason = typeof t.player_season.$inferSelect;
export type Gap = typeof t.game_gaps.$inferSelect;
export type Injury = typeof t.injuries.$inferSelect;
export type Odds = typeof t.odds.$inferSelect;
export type Preview = typeof t.game_previews.$inferSelect;
export type Editorial = typeof t.editorial.$inferSelect;
export type Run = typeof t.pipeline_runs.$inferSelect;
export type LeagueZone = typeof t.league_shot_zones.$inferSelect;
export type TeamZone = typeof t.team_shot_zones.$inferSelect;
export type PlayerZone = typeof t.player_shot_zones.$inferSelect;
export type GameZone = typeof t.game_shot_zones.$inferSelect;
export type GameFlow = typeof t.game_flow.$inferSelect;
export type ScoringRun = typeof t.game_runs.$inferSelect;
export type LineupSeason = typeof t.lineup_season.$inferSelect;
export type OnOff = typeof t.player_on_off.$inferSelect;
export type TeamClutch = typeof t.team_clutch.$inferSelect;
export type PlayerClutch = typeof t.player_clutch.$inferSelect;
export type PlayerName = { id: number; name: string; short_name: string | null };
export type PowerRating = typeof t.power_ratings.$inferSelect;
export type ModelDay = typeof t.model_days.$inferSelect;
export type ModelGame = typeof t.model_games.$inferSelect;
export type ModelBacktest = typeof t.model_backtest.$inferSelect;
export type ModelCalibration = typeof t.model_calibration.$inferSelect;
export type Story = typeof t.stories.$inferSelect;

export type BoxLine = PlayerGame & { delta: Delta | null };

/* ------------------------------------------------------------------ basics */

export async function getTeams(): Promise<Map<string, Team>> {
  const rows = await getDb().select().from(t.teams);
  return new Map(rows.map((r) => [r.code, r]));
}

export async function latestRun(): Promise<Run | null> {
  const [row] = await getDb()
    .select()
    .from(t.pipeline_runs)
    .where(ne(t.pipeline_runs.status, "running"))
    .orderBy(desc(t.pipeline_runs.run_date), desc(t.pipeline_runs.id))
    .limit(1);
  return row ?? null;
}

export async function runFor(day: string): Promise<Run | null> {
  const [row] = await getDb()
    .select()
    .from(t.pipeline_runs)
    .where(and(eq(t.pipeline_runs.run_date, day), ne(t.pipeline_runs.status, "running")))
    .orderBy(desc(t.pipeline_runs.id))
    .limit(1);
  return row ?? null;
}

/**
 * Which day a page shows: ?date= when valid; otherwise today in New York, unless the database
 * is more than 3 days behind (seeded demo data, off-season), then its latest run date.
 */
export async function resolveDay(param?: string | string[]): Promise<{ day: string; latest: string | null; today: string; pinned: boolean }> {
  const today = todayET();
  const run = await latestRun();
  const latest = run?.run_date ?? null;
  const p = Array.isArray(param) ? param[0] : param;
  if (isIsoDate(p)) return { day: p, latest, today, pinned: true };
  if (latest && daysBetween(latest, today) > 3) return { day: latest, latest, today, pinned: false };
  return { day: today, latest, today, pinned: false };
}

/** Season of the games on or around a day; falls back to the newest season with stats. */
export async function seasonFor(day: string): Promise<number | null> {
  const db = getDb();
  const [near] = await db
    .select({ season: t.games.season })
    .from(t.games)
    .where(and(gte(t.games.game_date, addDays(day, -45)), lte(t.games.game_date, addDays(day, 45))))
    .orderBy(sql`abs(${t.games.game_date} - ${day}::date)`)
    .limit(1);
  if (near) return near.season;
  const [row] = await db.select({ season: max(t.team_season.season) }).from(t.team_season);
  return row?.season ?? null;
}

export async function getTeamSeason(season: number): Promise<TeamSeason[]> {
  return getDb().select().from(t.team_season).where(eq(t.team_season.season, season));
}

export async function getPlayerSeason(season: number, teams?: string[]): Promise<PlayerSeason[]> {
  const where = teams?.length
    ? and(eq(t.player_season.season, season), inArray(t.player_season.team_code, teams))
    : eq(t.player_season.season, season);
  return getDb().select().from(t.player_season).where(where);
}

export async function getGamesOn(day: string): Promise<Game[]> {
  return getDb().select().from(t.games).where(eq(t.games.game_date, day)).orderBy(asc(t.games.tip), asc(t.games.code));
}

export async function getOdds(day: string): Promise<Odds[]> {
  return getDb().select().from(t.odds).where(eq(t.odds.snapshot_date, day));
}

/** The newest line for each game (runs fetch lines for the next 3 days, so a game can have several snapshots). */
export async function latestOdds(gameIds: number[]): Promise<Map<number, Odds>> {
  if (!gameIds.length) return new Map();
  const rows = await getDb()
    .selectDistinctOn([t.odds.game_id])
    .from(t.odds)
    .where(inArray(t.odds.game_id, gameIds))
    .orderBy(asc(t.odds.game_id), desc(t.odds.snapshot_date));
  return new Map(rows.map((o) => [o.game_id, o]));
}

export async function getPreviews(snapshot: string, gameIds: number[]): Promise<Preview[]> {
  if (!gameIds.length) return [];
  return getDb()
    .select()
    .from(t.game_previews)
    .where(and(eq(t.game_previews.snapshot_date, snapshot), inArray(t.game_previews.game_id, gameIds)));
}

/** First and last game date of a season (the range the date picker allows). */
export async function seasonRange(season: number | null): Promise<{ first: string; last: string } | null> {
  if (!season) return null;
  const [row] = await getDb()
    .select({ first: sql<string>`min(${t.games.game_date})`, last: sql<string>`max(${t.games.game_date})` })
    .from(t.games)
    .where(eq(t.games.season, season));
  return row?.first && row?.last ? { first: row.first, last: row.last } : null;
}

export async function getGamesBetween(from: string, to: string): Promise<Game[]> {
  return getDb()
    .select()
    .from(t.games)
    .where(and(gte(t.games.game_date, from), lte(t.games.game_date, to)))
    .orderBy(asc(t.games.game_date), asc(t.games.tip), asc(t.games.code));
}

export async function getEditorial(day: string): Promise<Editorial[]> {
  return getDb().select().from(t.editorial).where(eq(t.editorial.date, day)).orderBy(asc(t.editorial.seq));
}

export async function getInjuries(day: string): Promise<Injury[]> {
  return getDb().select().from(t.injuries).where(eq(t.injuries.snapshot_date, day)).orderBy(asc(t.injuries.sort_order));
}

export async function getTeamGames(gameIds: number[]): Promise<TeamGame[]> {
  if (!gameIds.length) return [];
  return getDb().select().from(t.team_games).where(inArray(t.team_games.game_id, gameIds));
}

export async function getBoxLines(gameIds: number[]): Promise<BoxLine[]> {
  if (!gameIds.length) return [];
  const rows = await getDb()
    .select({ pg: t.player_games, d: t.player_game_deltas })
    .from(t.player_games)
    .leftJoin(
      t.player_game_deltas,
      and(eq(t.player_game_deltas.game_id, t.player_games.game_id), eq(t.player_game_deltas.player_id, t.player_games.player_id)),
    )
    .where(inArray(t.player_games.game_id, gameIds))
    .orderBy(asc(t.player_games.game_id), asc(t.player_games.team_code), asc(t.player_games.box_order));
  return rows.map((r) => ({ ...r.pg, delta: r.d }));
}

/** Names for player ids (lineups list ids only). */
export async function getPlayerNames(ids: number[]): Promise<Map<number, PlayerName>> {
  if (!ids.length) return new Map();
  const rows = await getDb()
    .select({ id: t.players.id, name: t.players.name, short_name: t.players.short_name })
    .from(t.players)
    .where(inArray(t.players.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getGaps(gameIds: number[]): Promise<Gap[]> {
  if (!gameIds.length) return [];
  return getDb().select().from(t.game_gaps).where(inArray(t.game_gaps.game_id, gameIds)).orderBy(asc(t.game_gaps.sort_order));
}

/* ------------------------------------------------------------------ power ratings and the model */

export async function getModelGames(gameIds: number[]): Promise<Map<number, ModelGame>> {
  if (!gameIds.length) return new Map();
  const rows = await getDb().select().from(t.model_games).where(inArray(t.model_games.game_id, gameIds));
  return new Map(rows.map((r) => [r.game_id, r]));
}

export async function getRatingsOn(season: number, asOf: string, teams?: string[]): Promise<PowerRating[]> {
  const where = teams?.length
    ? and(eq(t.power_ratings.season, season), eq(t.power_ratings.as_of, asOf), inArray(t.power_ratings.team_code, teams))
    : and(eq(t.power_ratings.season, season), eq(t.power_ratings.as_of, asOf));
  return getDb().select().from(t.power_ratings).where(where).orderBy(asc(t.power_ratings.net_rk), asc(t.power_ratings.team_code));
}

/** The newest ratings date of a season on or before `day` (the ratings as of that morning). */
async function ratingsDate(season: number, day: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ d: max(t.model_days.as_of) })
    .from(t.model_days)
    .where(and(eq(t.model_days.season, season), lte(t.model_days.as_of, day)));
  if (row?.d) return row.d;
  // a day before the first ratings: show the first ones
  const [first] = await getDb().select({ d: sql<string>`min(${t.model_days.as_of})` }).from(t.model_days).where(eq(t.model_days.season, season));
  return first?.d ?? null;
}

export type RatingPoint = { as_of: string; team_code: string; adj_net: number | null; net_rk: number | null };

export async function getRatingsPage(day: string) {
  const season = await seasonFor(day);
  const teams = await getTeams();
  const asOf = season ? await ratingsDate(season, day) : null;
  if (!season || !asOf) return { season, teams, asOf, rows: [] as PowerRating[], history: [] as RatingPoint[], weekAgo: new Map<string, PowerRating>(), weekAgoDate: null as string | null, day: null as ModelDay | null };
  const db = getDb();
  const [rows, history, days] = await Promise.all([
    getRatingsOn(season, asOf),
    db
      .select({ as_of: t.power_ratings.as_of, team_code: t.power_ratings.team_code, adj_net: t.power_ratings.adj_net, net_rk: t.power_ratings.net_rk })
      .from(t.power_ratings)
      .where(and(eq(t.power_ratings.season, season), lte(t.power_ratings.as_of, asOf)))
      .orderBy(asc(t.power_ratings.as_of)),
    db
      .select()
      .from(t.model_days)
      .where(and(eq(t.model_days.season, season), lte(t.model_days.as_of, asOf)))
      .orderBy(asc(t.model_days.as_of)),
  ]);
  // a week back: the newest ratings date at least 7 days before this one
  const back = [...days].reverse().find((d) => daysBetween(d.as_of, asOf) >= 7);
  const weekRows = back ? await getRatingsOn(season, back.as_of) : [];
  return {
    season,
    teams,
    asOf,
    rows,
    history,
    weekAgo: new Map(weekRows.map((r) => [r.team_code, r])),
    weekAgoDate: (back?.as_of ?? null) as string | null,
    day: days[days.length - 1] ?? null,
  };
}

export async function getModelPage(day: string) {
  const season = await seasonFor(day);
  const teams = await getTeams();
  if (!season) return null;
  const db = getDb();
  const [bt, cal, days, games] = await Promise.all([
    db.select().from(t.model_backtest).where(eq(t.model_backtest.season, season)).limit(1),
    db.select().from(t.model_calibration).where(eq(t.model_calibration.season, season)).orderBy(asc(t.model_calibration.lo)),
    db.select().from(t.model_days).where(eq(t.model_days.season, season)).orderBy(asc(t.model_days.as_of)),
    db
      .select()
      .from(t.model_games)
      .where(eq(t.model_games.season, season))
      .orderBy(desc(t.model_games.game_date), asc(t.model_games.game_id)),
  ]);
  return {
    season,
    teams,
    backtest: bt[0] ?? null,
    calibration: cal,
    days,
    finals: games.filter((g) => g.actual_margin !== null),
    upcoming: games.filter((g) => g.actual_margin === null).reverse(),
  };
}

/* ------------------------------------------------------------------ shots */

const shotPoint = { x: t.shots.x, y: t.shots.y, made: t.shots.made, zone: t.shots.zone, game_date: t.shots.game_date };

/** Shots from games before the profile's run date, so the chart and the zone table always cover the same games. */
const before = <T extends { game_date: string }>(rows: T[], asOf: string | undefined) => (asOf ? rows.filter((r) => r.game_date < asOf) : rows);

/* ------------------------------------------------------------------ derived */

/** ESPN rounds minutes, so 0 means under 30 seconds on the floor: did_not_play alone decides. */
export const played = (b: Pick<PlayerGame, "did_not_play">) => !b.did_not_play;

export type MissingRow = { team: string; ppg: number; mpg: number; out: number };

/** Season scoring of players listed Out or Doubtful, by team (injury rows matched by team + exact name). */
export function missingScoring(injuries: Injury[], players: PlayerSeason[]): Map<string, MissingRow> {
  const idx = new Map(players.map((p) => [`${p.team_code}|${p.name}`, p]));
  const out = new Map<string, MissingRow>();
  for (const i of injuries) {
    if (!MISSING_STATUSES.has(i.status)) continue;
    const row = out.get(i.team_code) ?? { team: i.team_code, ppg: 0, mpg: 0, out: 0 };
    row.out += 1;
    const p = idx.get(`${i.team_code}|${i.player_name}`);
    if (p) {
      row.ppg += p.ppg ?? 0;
      row.mpg += p.mpg ?? 0;
    }
    out.set(i.team_code, row);
  }
  for (const r of out.values()) {
    r.ppg = Math.round(r.ppg * 10) / 10;
    r.mpg = Math.round(r.mpg * 10) / 10;
  }
  return out;
}

export function playerIndex(players: PlayerSeason[]): Map<string, PlayerSeason> {
  return new Map(players.map((p) => [`${p.team_code}|${p.name}`, p]));
}

/* ------------------------------------------------------------------ pages */

/** Days with the full matchup breakdown (tonight, tomorrow, the day after), and the length of the week view. */
export const LOOKAHEAD_DAYS = 3;
export const WEEK_DAYS = 7;

export type TonightGame = Game & { odds: Odds | null; pick: Editorial | null; preview: Preview | null; model: ModelGame | null };
export type Result = Game & { away_tg: TeamGame | null; home_tg: TeamGame | null; note: string };

/**
 * How a date is shown, measured from the newest pipeline run (the data's "today"):
 * past      before it: that day's final scores
 * preview   its date and the 2 days after: the full matchup breakdown from that run's look-ahead
 * schedule  later: the schedule, records, TV and a line if one is posted
 */
export type DayMode = "past" | "preview" | "schedule";

export function dayMode(day: string, latest: string | null): DayMode {
  if (!latest) return "schedule";
  if (day < latest) return "past";
  return daysBetween(latest, day) < LOOKAHEAD_DAYS ? "preview" : "schedule";
}

function joinResults(games: Game[], teamGames: TeamGame[], notes: Map<string, string>): Result[] {
  const tg = new Map(teamGames.map((r) => [`${r.game_id}|${r.team_code}`, r]));
  return games
    .filter((g) => tg.has(`${g.id}|${g.away_code}`) && tg.has(`${g.id}|${g.home_code}`))
    .map((g) => ({
      ...g,
      away_tg: tg.get(`${g.id}|${g.away_code}`) ?? null,
      home_tg: tg.get(`${g.id}|${g.home_code}`) ?? null,
      note: notes.get(g.code) ?? "",
    }));
}

/** Season scoring missing by team, from the run's look-ahead. Teams the injury report does not cover are left out. */
function missingFromPreviews(previews: Preview[]): Map<string, MissingRow> {
  const out = new Map<string, MissingRow>();
  for (const p of previews) {
    if (!p.injury_report) continue;
    out.set(p.away_code, { team: p.away_code, ppg: p.away_missing_ppg ?? 0, mpg: 0, out: p.away_out ?? 0 });
    out.set(p.home_code, { team: p.home_code, ppg: p.home_missing_ppg ?? 0, mpg: 0, out: p.home_out ?? 0 });
  }
  return out;
}

export async function getToday(day: string) {
  const yday = addDays(day, -1);
  const latestRunRow = await latestRun();
  const latest = latestRunRow?.run_date ?? null;
  const mode = dayMode(day, latest);
  // the run whose snapshots this day uses: the newest run for the look-ahead, else the run of that date
  const snap = mode === "preview" ? latest! : day;
  const [teams, gamesRaw, lastRaw, editorial, injuries, run, season, nextDayNotes] = await Promise.all([
    getTeams(),
    getGamesOn(day),
    mode === "past" || day === latest ? getGamesOn(yday) : Promise.resolve([] as Game[]),
    getEditorial(day),
    mode === "preview" ? getInjuries(snap) : Promise.resolve([] as Injury[]),
    mode === "preview" ? Promise.resolve(latestRunRow) : runFor(day),
    seasonFor(day),
    // notes on a day's results are written the next morning
    mode === "past" ? getEditorial(addDays(day, 1)) : Promise.resolve([] as Editorial[]),
  ]);
  const ids = gamesRaw.map((g) => g.id);
  const [teamSeason, players, range, oddsBy, previews, models] = await Promise.all([
    season ? getTeamSeason(season) : Promise.resolve([] as TeamSeason[]),
    season ? getPlayerSeason(season) : Promise.resolve([] as PlayerSeason[]),
    seasonRange(season),
    latestOdds(ids),
    mode === "preview" ? getPreviews(snap, ids) : Promise.resolve([] as Preview[]),
    getModelGames(ids),
  ]);
  // past days show their own games' box scores; the look-ahead's first day shows last night's
  const boxIds = mode === "past" ? ids : lastRaw.map((g) => g.id);
  const [teamGames, box] = await Promise.all([getTeamGames(boxIds), getBoxLines(boxIds)]);

  const picks = new Map(editorial.filter((e) => e.kind === "game").map((e) => [e.ref, e]));
  const notes = new Map(editorial.filter((e) => e.kind === "result").map((e) => [e.ref, e.text]));
  const dayNotes = new Map(nextDayNotes.filter((e) => e.kind === "result").map((e) => [e.ref, e.text]));
  const previewBy = new Map(previews.map((p) => [p.game_id, p]));
  const tonight: TonightGame[] = gamesRaw.map((g) => ({
    ...g,
    odds: oddsBy.get(g.id) ?? null,
    pick: picks.get(g.code) ?? null,
    preview: previewBy.get(g.id) ?? null,
    model: models.get(g.id) ?? null,
  }));
  const results = mode === "past" ? joinResults(gamesRaw, teamGames, dayNotes) : joinResults(lastRaw, teamGames, notes);
  const brief = editorial.filter((e) => e.kind === "date" || e.kind === "headline" || e.kind === "surprise");
  // the look-ahead's numbers when this run built them; older runs fall back to adding up the injury rows here
  const missing = previews.length ? missingFromPreviews(previews) : missingScoring(injuries, players);
  return {
    day,
    yday,
    mode,
    latest,
    snapshot: mode === "preview" ? snap : null,
    season,
    range,
    teams,
    tonight,
    lastNight: lastRaw,
    results,
    box,
    teamSeason: new Map(teamSeason.map((r) => [r.team_code, r])),
    players,
    injuries,
    brief,
    run,
    missing,
  };
}

export type WeekDay = { day: string; games: TonightGame[]; detailed: boolean };

/** The 7 days from `from`, grouped by date, each game with its newest line. */
export async function getWeek(from: string, latest: string | null): Promise<WeekDay[]> {
  const to = addDays(from, WEEK_DAYS - 1);
  const games = await getGamesBetween(from, to);
  const odds = await latestOdds(games.map((g) => g.id));
  return Array.from({ length: WEEK_DAYS }, (_, i) => {
    const day = addDays(from, i);
    return {
      day,
      detailed: dayMode(day, latest) === "preview",
      games: games.filter((g) => g.game_date === day).map((g) => ({ ...g, odds: odds.get(g.id) ?? null, pick: null, preview: null, model: null })),
    };
  });
}

export type TodayData = Awaited<ReturnType<typeof getToday>>;

export async function getGamePage(id: number) {
  const db = getDb();
  const [game] = await db.select().from(t.games).where(eq(t.games.id, id)).limit(1);
  if (!game) return null;
  const [teams, teamGames, box, gaps, notes, odds, injuries, teamSeason, shots, zones, flow, runs, models] = await Promise.all([
    getTeams(),
    getTeamGames([id]),
    getBoxLines([id]),
    getGaps([id]),
    db
      .select()
      .from(t.editorial)
      .where(and(eq(t.editorial.kind, "result"), eq(t.editorial.ref, game.code), gte(t.editorial.date, game.game_date)))
      .orderBy(asc(t.editorial.date))
      .limit(1),
    db.select().from(t.odds).where(eq(t.odds.game_id, id)).orderBy(desc(t.odds.snapshot_date)).limit(1),
    getInjuries(game.game_date),
    getTeamSeason(game.season),
    db
      .select({ ...shotPoint, team_code: t.shots.team_code, period: t.shots.period, clock: t.shots.clock, distance: t.shots.distance, shot_type: t.shots.shot_type, points: t.shots.points, name: t.players.name })
      .from(t.shots)
      .leftJoin(t.players, eq(t.players.id, t.shots.player_id))
      .where(eq(t.shots.game_id, id))
      .orderBy(asc(t.shots.seq)),
    db.select().from(t.game_shot_zones).where(eq(t.game_shot_zones.game_id, id)),
    db.select().from(t.game_flow).where(eq(t.game_flow.game_id, id)).limit(1),
    db.select().from(t.game_runs).where(eq(t.game_runs.game_id, id)).orderBy(asc(t.game_runs.seq)),
    getModelGames([id]),
  ]);
  const model = models.get(id) ?? null;
  const ratings = model ? await getRatingsOn(model.season, model.as_of, [game.away_code, game.home_code]) : [];
  const side = (code: string) => teamGames.find((r) => r.team_code === code) ?? null;
  return {
    game,
    teams,
    away: side(game.away_code),
    home: side(game.home_code),
    box,
    gaps,
    note: notes[0]?.text ?? "",
    odds: odds[0] ?? null,
    injuries: injuries.filter((i) => i.team_code === game.away_code || i.team_code === game.home_code),
    teamSeason: new Map(teamSeason.map((r) => [r.team_code, r])),
    shots,
    zones,
    flow: flow[0] ?? null,
    runs,
    model,
    ratings: new Map(ratings.map((r) => [r.team_code, r])),
  };
}

export async function getTeamsPage(day: string) {
  const season = await seasonFor(day);
  const [teams, rows] = await Promise.all([getTeams(), season ? getTeamSeason(season) : Promise.resolve([])]);
  return { season, teams, rows };
}

export async function getTeamPage(code: string, day: string) {
  const db = getDb();
  const teams = await getTeams();
  const team = teams.get(code);
  if (!team) return null;
  const season = await seasonFor(day);
  if (!season)
    return {
      team,
      teams,
      season,
      row: null,
      log: [],
      roster: [],
      upcoming: [],
      teamSeason: new Map<string, TeamSeason>(),
      shots: { offense: [], defense: [] },
      zones: [] as TeamZone[],
      lineups: [] as LineupSeason[],
      onOff: [] as OnOff[],
      clutch: null as TeamClutch | null,
      playerClutch: [] as PlayerClutch[],
      names: new Map<number, PlayerName>(),
    };
  const [teamSeason, log, roster, upcoming, offense, defense, zones, lineups, onOff, clutch, playerClutch] = await Promise.all([
    getTeamSeason(season),
    db
      .select({ tg: t.team_games, g: t.games })
      .from(t.team_games)
      .innerJoin(t.games, eq(t.games.id, t.team_games.game_id))
      .where(and(eq(t.team_games.team_code, code), eq(t.games.season, season)))
      .orderBy(asc(t.team_games.game_date)),
    getPlayerSeason(season, [code]),
    db
      .select()
      .from(t.games)
      .where(
        and(
          eq(t.games.season, season),
          gte(t.games.game_date, day),
          sql`(${t.games.away_code} = ${code} OR ${t.games.home_code} = ${code})`,
          ne(t.games.status, "STATUS_FINAL"),
        ),
      )
      .orderBy(asc(t.games.tip))
      .limit(5),
    db.select(shotPoint).from(t.shots).where(and(eq(t.shots.season, season), eq(t.shots.team_code, code))),
    db.select(shotPoint).from(t.shots).where(and(eq(t.shots.season, season), eq(t.shots.opp_code, code))),
    db.select().from(t.team_shot_zones).where(and(eq(t.team_shot_zones.season, season), eq(t.team_shot_zones.team_code, code))),
    db
      .select()
      .from(t.lineup_season)
      .where(and(eq(t.lineup_season.season, season), eq(t.lineup_season.team_code, code)))
      .orderBy(desc(t.lineup_season.poss)),
    db
      .select()
      .from(t.player_on_off)
      .where(and(eq(t.player_on_off.season, season), eq(t.player_on_off.team_code, code)))
      .orderBy(desc(t.player_on_off.on_secs)),
    db
      .select()
      .from(t.team_clutch)
      .where(and(eq(t.team_clutch.season, season), eq(t.team_clutch.team_code, code)))
      .limit(1),
    db
      .select()
      .from(t.player_clutch)
      .where(and(eq(t.player_clutch.season, season), eq(t.player_clutch.team_code, code)))
      .orderBy(desc(t.player_clutch.pts), desc(t.player_clutch.secs)),
  ]);
  const ts = new Map(teamSeason.map((r) => [r.team_code, r]));
  const asOf = zones[0]?.as_of;
  const ids = new Set<number>([...lineups.flatMap((l) => l.player_ids), ...onOff.map((r) => r.player_id), ...playerClutch.map((r) => r.player_id)]);
  const names = await getPlayerNames([...ids]);
  return {
    team,
    teams,
    season,
    row: ts.get(code) ?? null,
    teamSeason: ts,
    log,
    roster,
    upcoming,
    shots: { offense: before(offense, asOf), defense: before(defense, asOf) },
    zones,
    lineups,
    onOff,
    clutch: clutch[0] ?? null,
    playerClutch,
    names,
  };
}

export async function getPlayersPage(day: string) {
  const season = await seasonFor(day);
  const [teams, rows] = await Promise.all([getTeams(), season ? getPlayerSeason(season) : Promise.resolve([])]);
  return { season, teams, rows };
}

export async function getPlayerPage(id: number, day: string) {
  const db = getDb();
  const [player] = await db.select().from(t.players).where(eq(t.players.id, id)).limit(1);
  if (!player) return null;
  const season = await seasonFor(day);
  const [teams, seasonRow, log, shots, zones, onOff, clutch] = await Promise.all([
    getTeams(),
    season
      ? db.select().from(t.player_season).where(and(eq(t.player_season.season, season), eq(t.player_season.player_id, id))).limit(1)
      : Promise.resolve([]),
    db
      .select({ pg: t.player_games, d: t.player_game_deltas, g: t.games })
      .from(t.player_games)
      .innerJoin(t.games, eq(t.games.id, t.player_games.game_id))
      .leftJoin(
        t.player_game_deltas,
        and(eq(t.player_game_deltas.game_id, t.player_games.game_id), eq(t.player_game_deltas.player_id, t.player_games.player_id)),
      )
      .where(and(eq(t.player_games.player_id, id), season ? eq(t.games.season, season) : sql`true`))
      .orderBy(asc(t.player_games.game_date)),
    season
      ? db
          .select({ ...shotPoint, opp_code: t.shots.opp_code, period: t.shots.period, clock: t.shots.clock, distance: t.shots.distance, shot_type: t.shots.shot_type, points: t.shots.points })
          .from(t.shots)
          .where(and(eq(t.shots.season, season), eq(t.shots.player_id, id)))
          .orderBy(asc(t.shots.game_date), asc(t.shots.game_id), asc(t.shots.seq))
      : Promise.resolve([]),
    season
      ? db.select().from(t.player_shot_zones).where(and(eq(t.player_shot_zones.season, season), eq(t.player_shot_zones.player_id, id)))
      : Promise.resolve([] as PlayerZone[]),
    season
      ? db
          .select()
          .from(t.player_on_off)
          .where(and(eq(t.player_on_off.season, season), eq(t.player_on_off.player_id, id)))
          .orderBy(desc(t.player_on_off.on_secs))
      : Promise.resolve([] as OnOff[]),
    season
      ? db
          .select()
          .from(t.player_clutch)
          .where(and(eq(t.player_clutch.season, season), eq(t.player_clutch.player_id, id)))
          .orderBy(desc(t.player_clutch.secs))
      : Promise.resolve([] as PlayerClutch[]),
  ]);
  const clutchTeams = [...new Set(clutch.map((r) => r.team_code))];
  const teamClutch =
    season && clutchTeams.length
      ? await db
          .select()
          .from(t.team_clutch)
          .where(and(eq(t.team_clutch.season, season), inArray(t.team_clutch.team_code, clutchTeams)))
      : [];
  return {
    player,
    teams,
    season,
    row: seasonRow[0] ?? null,
    log,
    onOff,
    clutch,
    teamClutch: new Map(teamClutch.map((r) => [r.team_code, r])),
    shots: before(shots, zones[0]?.as_of),
    zones,
  };
}

export async function getStandings(day: string) {
  const season = await seasonFor(day);
  const [teams, rows] = await Promise.all([getTeams(), season ? getTeamSeason(season) : Promise.resolve([])]);
  return { season, teams, rows };
}

export async function getInjuriesPage(day: string) {
  const [teams, games, injuries, season] = await Promise.all([getTeams(), getGamesOn(day), getInjuries(day), seasonFor(day)]);
  const players = season ? await getPlayerSeason(season) : [];
  return { teams, games, injuries, players, season };
}

/** Last date before `day` that has finished games (for "previous night" links). */
export async function previousGameDay(day: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ d: max(t.games.game_date) })
    .from(t.games)
    .where(and(lt(t.games.game_date, day), eq(t.games.status, "STATUS_FINAL")));
  return row?.d ?? null;
}

/* ------------------------------------------------------------------ stories */

export type StoryLogRow = { player_id: number; game_id: number; game_date: string; opp_code: string; home_away: string; pts: number | null; reb: number | null; ast: number | null; tpm: number | null; plus_minus: number | null; ts_pct: number | null; fga: number | null; fta: number | null };

/** Game nights that have stories this season, newest first. */
export async function storyNights(season: number): Promise<string[]> {
  const rows = await getDb().selectDistinct({ d: t.stories.story_date }).from(t.stories).where(eq(t.stories.season, season)).orderBy(desc(t.stories.story_date));
  return rows.map((r) => r.d);
}

/** Played games of these players this season up to a date, for the charts behind each story. */
export async function storyLogs(season: number, ids: number[], through: string): Promise<Map<number, StoryLogRow[]>> {
  if (!ids.length) return new Map();
  const rows = await getDb()
    .select({
      player_id: t.player_games.player_id,
      game_id: t.player_games.game_id,
      game_date: t.player_games.game_date,
      opp_code: t.player_games.opp_code,
      home_away: t.player_games.home_away,
      pts: t.player_games.pts,
      reb: t.player_games.reb,
      ast: t.player_games.ast,
      tpm: t.player_games.tpm,
      plus_minus: t.player_games.plus_minus,
      ts_pct: t.player_games.ts_pct,
      fga: t.player_games.fga,
      fta: t.player_games.fta,
    })
    .from(t.player_games)
    .innerJoin(t.games, eq(t.games.id, t.player_games.game_id))
    .where(
      and(
        inArray(t.player_games.player_id, ids),
        eq(t.games.season, season),
        lte(t.player_games.game_date, through),
        eq(t.player_games.did_not_play, false),
      ),
    )
    .orderBy(asc(t.player_games.game_date), asc(t.player_games.game_id));
  const out = new Map<number, StoryLogRow[]>();
  for (const r of rows) {
    const list = out.get(r.player_id) ?? [];
    list.push(r);
    out.set(r.player_id, list);
  }
  return out;
}

/**
 * The Stories page: one night's top 20 (the newest night before `day`), or the whole season when filtered by
 * player or team, with the filters' choices and each player's games for the evidence charts.
 */
export async function getStoriesPage(day: string, f: StoryFilters) {
  const season = await seasonFor(day);
  const teams = await getTeams();
  if (!season) return { season, teams, nights: [] as string[], night: null, stories: [] as Story[], players: [] as PlayerName[], names: new Map<number, PlayerName>(), logs: new Map<number, StoryLogRow[]>() };
  const db = getDb();
  const nights = await storyNights(season);
  const night = nights.find((d) => d < day) ?? null;
  const where = [eq(t.stories.season, season)];
  if (f.scope === "night") where.push(night ? eq(t.stories.story_date, night) : sql`false`);
  else where.push(lt(t.stories.story_date, day));
  if (f.kind) where.push(eq(t.stories.kind, f.kind));
  if (f.team) where.push(eq(t.stories.team_code, f.team));
  if (f.player !== null) where.push(eq(t.stories.player_id, f.player));
  const [stories, pickable] = await Promise.all([
    db
      .select()
      .from(t.stories)
      .where(and(...where))
      .orderBy(desc(t.stories.story_date), asc(t.stories.rank))
      .limit(f.scope === "night" ? 20 : 200),
    db
      .selectDistinct({ id: t.players.id, name: t.players.name, short_name: t.players.short_name })
      .from(t.stories)
      .innerJoin(t.players, eq(t.players.id, t.stories.player_id))
      .where(and(eq(t.stories.season, season), lt(t.stories.story_date, day))),
  ]);
  const ids = [...new Set(stories.map((s) => s.player_id).filter((x): x is number => x !== null))];
  const through = stories.reduce((m, s) => (s.story_date > m ? s.story_date : m), "");
  const logs = await storyLogs(season, ids, through || day);
  const players = [...pickable].sort((a, b) => a.name.localeCompare(b.name));
  return { season, teams, nights, night, stories, players, names: new Map(players.map((p) => [p.id, p])), logs };
}
