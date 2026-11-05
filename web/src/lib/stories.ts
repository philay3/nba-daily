/**
 * Story finder helpers shared by the Stories page and the studio's Story card. No imports, so `npm test` runs it
 * directly. The stories themselves are built by the pipeline (pipeline/nba_pipeline/stories.py).
 */

export const STORY_KINDS = {
  outlier: "Outlier",
  streak: "Streak",
  first: "First this season",
  rare: "Rare line",
  team: "Team swing",
} as const;

export type StoryKind = keyof typeof STORY_KINDS;

export const isStoryKind = (k: unknown): k is StoryKind => typeof k === "string" && k in STORY_KINDS;

/** The numbers behind a story, as the pipeline writes them. Every field is optional: each kind fills its own. */
export type StoryEvidence = {
  stat?: string;
  label?: string;
  value?: number;
  floor?: number;
  season?: { n: number; mean: number | null; sd: number | null; z?: number | null };
  l10?: { n: number; mean: number | null; sd: number | null; z: number | null };
  event?: string;
  length?: number;
  season_count?: number;
  season_games?: number;
  rate?: number;
  league_rate?: number;
  league_count?: number;
  league_games?: number;
  threshold?: number;
  games_before?: number;
  best_before?: number;
  p?: number;
  window?: number;
  last?: { games: number; w: number; l: number; net: number | null };
  rest?: { games: number; w: number; l: number; net: number | null };
  sd_game?: number;
  z?: number;
  games?: { date: string; game_id: number; opp: string; pts?: number; reb?: number; ast?: number; tpm?: number; win?: boolean; opp_pts?: number; net?: number }[];
  line?: Record<string, number | null>;
  also?: { kind: string; subtype: string; headline: string; z: number | null; rarity: number }[];
};

export type StoryLike = { kind: string; subtype: string; evidence: unknown };

export function evidenceOf(s: StoryLike): StoryEvidence {
  return (s.evidence && typeof s.evidence === "object" ? s.evidence : {}) as StoryEvidence;
}

/** Plain label for each stat the finder reads. */
export const STAT_LABEL: Record<string, string> = {
  pts: "Points",
  reb: "Rebounds",
  ast: "Assists",
  tpm: "Threes",
  plus_minus: "Plus-minus",
  ts_pct: "True shooting %",
};

/** Which per-game stat best shows a player story on a chart. */
export function chartStat(s: StoryLike): keyof typeof STAT_LABEL {
  const ev = evidenceOf(s);
  if (ev.stat && ev.stat in STAT_LABEL) return ev.stat;
  const sub = s.subtype;
  if (sub.startsWith("tpm")) return "tpm";
  if (sub.startsWith("reb") || sub === "20_20") return "reb";
  if (sub.startsWith("ast")) return "ast";
  return "pts";
}

/** One short line with the key number of a story: "+3.4 SD vs 5 games", "5 games in a row", ... */
export function keyFigure(s: StoryLike & { z: number | null; value: number | null; games: number | null }): string {
  const ev = evidenceOf(s);
  if (s.kind === "outlier" && s.z !== null) return `${s.z > 0 ? "+" : "−"}${Math.abs(s.z).toFixed(1)} SD vs ${s.games ?? 0} games`;
  if (s.kind === "streak") return `${s.value ?? ev.length ?? 0} games in a row`;
  if (s.kind === "first") return `After ${ev.games_before ?? s.games ?? 0} games without one`;
  if (s.kind === "rare") return ev.league_count ? `${ev.league_count} before in ${(ev.league_games ?? 0).toLocaleString("en-US")} player games` : `First in ${(ev.league_games ?? 0).toLocaleString("en-US")} player games`;
  if (s.kind === "team" && ev.last && ev.rest) return `Net ${signed1(ev.last.net)} vs ${signed1(ev.rest.net)} before`;
  return "";
}

function signed1(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const t = Math.abs(v).toFixed(digits);
  return Number(t) === 0 ? t : `${v > 0 ? "+" : "−"}${t}`;
}

const one = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(1));

/** A stat value as printed: plus-minus signed, true shooting with one decimal, counts as whole numbers. */
export function statText(stat: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return stat === "plus_minus" ? signed1(v, 0) : stat === "ts_pct" ? one(v) : String(v);
}

export type StoryRow = StoryLike & { value: number | null; baseline: number | null; z: number | null; games: number | null; game_id: number; story_date: string };

/** Three label-value pairs that carry the story's numbers. */
export function storyFigures(s: StoryRow): [string, string][] {
  const ev = evidenceOf(s);
  const stat = ev.stat ?? chartStat(s);
  if (s.kind === "outlier")
    return [
      ["That night", statText(stat, s.value)],
      [`Average before (${s.games} games)`, stat === "plus_minus" ? signed1(s.baseline) : one(s.baseline)],
      ["Above or below", `${signed1(s.z)} SD`],
    ];
  if (s.kind === "team" && ev.last && ev.rest)
    return [
      [`Last ${ev.last.games}`, `${ev.last.w}-${ev.last.l}`],
      ["Net rating", signed1(ev.last.net)],
      [`The ${ev.rest.games} before`, `${ev.rest.w}-${ev.rest.l}, ${signed1(ev.rest.net)}`],
    ];
  if (s.kind === "streak")
    return [
      ["Streak", `${s.value ?? 0} games`],
      ["This season", `${ev.season_count ?? 0} of ${ev.season_games ?? 0}`],
      ["League rate", `${Math.round(100 * (ev.league_rate ?? 0))}%`],
    ];
  if (ev.line)
    return [
      ["Line", `${ev.line.pts ?? 0}-${ev.line.reb ?? 0}-${ev.line.ast ?? 0}`],
      ["Threes", `${ev.line.tpm ?? 0}-${ev.line.tpa ?? 0}`],
      ["Minutes", one(ev.line.min)],
    ];
  return [];
}

export type LogGame = { game_id: number; game_date: string; opp_code: string; home_away: string; fga: number | null; fta: number | null } & Partial<
  Record<"pts" | "reb" | "ast" | "tpm" | "plus_minus" | "ts_pct", number | null>
>;

export type StoryChart = {
  label: string;
  stat: string;
  diverging: boolean;
  avg: number | null;
  avgLabel: string | undefined;
  points: { key: string; date: string; opp: string; home: boolean; value: number | null; strong: boolean }[];
};

/**
 * The evidence chart: a player's stat by game this season through the story's night (that night, or the streak,
 * drawn strong), or a team's net rating by game with the last stretch strong. Null with fewer than 2 games.
 */
export function storyChart(s: StoryRow & { player_id: number | null }, log: LogGame[]): StoryChart | null {
  const ev = evidenceOf(s);
  if (s.player_id === null) {
    const games = ev.games ?? [];
    if (games.length < 2 || !ev.window) return null;
    const last = new Set(games.slice(-ev.window).map((g) => g.game_id));
    return {
      label: `Net rating by game, the last ${ev.window} drawn strong`,
      stat: "net",
      diverging: true,
      avg: null,
      avgLabel: undefined,
      points: games.map((g) => ({ key: String(g.game_id), date: g.date, opp: g.opp, home: false, value: g.net ?? null, strong: last.has(g.game_id) })),
    };
  }
  const stat = chartStat(s);
  const games = log.filter((g) => g.game_date <= s.story_date);
  if (games.length < 2) return null;
  const val = (g: LogGame): number | null => {
    if (stat === "ts_pct") return (g.fga ?? 0) + 0.44 * (g.fta ?? 0) >= 5 ? (g.ts_pct ?? null) : null;
    return g[stat as "pts"] ?? null;
  };
  const vals = games.filter((g) => g.game_date < s.story_date).map(val).filter((v): v is number => v !== null);
  const avg = s.kind === "outlier" ? s.baseline : vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const streak = new Set(s.kind === "streak" ? (ev.games ?? []).map((g) => g.game_id) : []);
  return {
    label: `${STAT_LABEL[stat]} by game this season, through that night`,
    stat,
    diverging: stat === "plus_minus",
    avg,
    avgLabel: avg === null ? undefined : `Avg before ${stat === "plus_minus" ? signed1(avg) : one(avg)}`,
    points: games.map((g) => ({ key: String(g.game_id), date: g.game_date, opp: g.opp_code, home: g.home_away === "home", value: val(g), strong: g.game_id === s.game_id || streak.has(g.game_id) })),
  };
}

export type StoryFilters = { kind: StoryKind | null; team: string | null; player: number | null; scope: "night" | "season" };

/** URL query -> filters (unknown values are dropped). A player or team filter alone widens to the season. */
export function storyFilters(sp: { type?: string; team?: string; player?: string; scope?: string }): StoryFilters {
  const team = sp.team && /^[A-Z]{2,4}$/.test(sp.team.toUpperCase()) ? sp.team.toUpperCase() : null;
  const pid = sp.player && /^\d+$/.test(sp.player) ? Number(sp.player) : null;
  const scope = sp.scope === "season" || sp.scope === "night" ? sp.scope : team || pid ? "season" : "night";
  return { kind: isStoryKind(sp.type) ? sp.type : null, team, player: pid, scope };
}

/** Filters -> URL query, leaving out defaults. */
export function storyQuery(date: string | undefined, f: StoryFilters, patch: Partial<StoryFilters> = {}): string {
  const n = { ...f, ...patch };
  const q = new URLSearchParams();
  if (date) q.set("date", date);
  if (n.kind) q.set("type", n.kind);
  if (n.team) q.set("team", n.team);
  if (n.player !== null) q.set("player", String(n.player));
  const widened = Boolean(n.team || n.player !== null);
  if (n.scope !== (widened ? "season" : "night")) q.set("scope", n.scope);
  return q.toString();
}

/** Studio key for a story: night and rank. */
export const storyKey = (s: { story_date: string; rank: number }) => `${s.story_date}-${s.rank}`;
