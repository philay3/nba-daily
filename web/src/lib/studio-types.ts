/** Plain JSON shapes for the studio (passed from server to the client editor). */
import type { ScatterTeam } from "@/components/charts/OffDefScatter";
import type { StoryChart } from "@/lib/stories";

export type StudioTeam = {
  code: string;
  name: string;
  nickname: string;
  conference: string;
  primary: string;
  secondary: string;
  accent: string;
};

export type StudioPlayerLine = {
  key: string;
  game_id: number;
  player_id: number;
  name: string;
  team: string;
  opp: string;
  home: boolean;
  date: string;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  pm: number | null;
  ts_pct: number | null;
  gp_before: number;
  avg_pts: number | null;
  avg_reb: number | null;
  avg_ast: number | null;
  d_pts: number | null;
  d_reb: number | null;
  d_ast: number | null;
  flags: string[];
  team_score: number;
  opp_score: number;
  won: boolean;
  season: { gp: number; ppg: number | null; rpg: number | null; apg: number | null; ts_pct: number | null; pm_pg: number | null } | null;
  trend: { date: string; pts: number; pm: number | null }[];
};

export type MatchupSide = {
  w: number;
  l: number;
  net: number | null;
  net_rk: number | null;
  ortg: number | null;
  ortg_rk: number | null;
  drtg: number | null;
  drtg_rk: number | null;
  pace: number | null;
  pace_rk: number | null;
  l5_net: number | null;
  l5_net_rk: number | null;
  efg: number | null;
  efg_rk: number | null;
  opp_efg: number | null;
  opp_efg_rk: number | null;
  rest: number | null;
  missing_ppg: number;
  missing: { name: string; ppg: number | null; status: string }[];
};

export type StudioMatchup = {
  key: string; // game id: unique across the 3 days, where a game code can repeat
  code: string;
  days_ahead: number; // 0 = the studio date, 1 = the next day, 2 = the day after
  report: string | null; // date of the injury report behind the missing numbers, null when none covers the game
  game_id: number;
  date: string;
  time_et: string;
  tv: string;
  away: string;
  home: string;
  line: string | null;
  total: number | null;
  away_wp: number | null;
  home_wp: number | null;
  watch: number | null;
  tag: string;
  sides: Record<string, MatchupSide>;
};

export type StudioRecap = {
  game_id: number;
  code: string;
  date: string;
  away: string;
  home: string;
  away_score: number;
  home_score: number;
  winner: string;
  ot: number;
  away_periods: number[];
  home_periods: number[];
  lead_changes: number;
  away_max_lead: number;
  home_max_lead: number;
  note: string;
  gaps: { stat: string; away_txt: string; home_txt: string; level: string; edge: string; z: number }[];
  leaders: { name: string; team: string; pts: number; reb: number; ast: number; pm: number | null }[];
};

/** One player's or one team's shots in a game last night, with the zones against the season and the league. */
export type StudioShotChart = {
  key: string; // "p-<game>-<player>" or "t-<game>-<team>"
  kind: "player" | "team";
  game_id: number;
  date: string;
  name: string; // player name, or the team's full name
  team: string;
  opp: string;
  home: boolean;
  won: boolean;
  team_score: number;
  opp_score: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  pts: number;
  shots: { x: number; y: number; made: boolean; zone: string }[];
  zones: { zone: string; fgm: number; fga: number; fg_pct: number | null; season_fg_pct: number | null; lg_fg_pct: number | null }[];
};

export type StudioFlowRun = {
  side: "away" | "home";
  team: string;
  pts: number;
  start_t: number;
  end_t: number;
  from: string; // "Q1 9:21"
  to: string;
  score_from: string; // "6-3", road team first
  score_to: string;
};

export type StudioFlow = {
  game_id: number;
  code: string;
  date: string;
  away: string;
  home: string;
  away_score: number;
  home_score: number;
  winner: string;
  ot: number;
  periods: number;
  t: number[]; // elapsed seconds at each scoring play
  away_pts: number[]; // scores after each scoring play
  home_pts: number[];
  lead_changes: number;
  times_tied: number;
  away_largest_lead: number;
  home_largest_lead: number;
  away_lead_secs: number | null;
  home_lead_secs: number | null;
  runs: StudioFlowRun[];
};

export type ModelSide = {
  w: number;
  l: number;
  adj_net: number | null;
  net_rk: number | null;
  adj_ortg: number | null;
  ortg_rk: number | null;
  adj_drtg: number | null;
  drtg_rk: number | null;
  b2b: boolean; // second night of a back-to-back
};

/** The model's line next to ESPN's for one game: the next 3 days, or last night's with the result. */
export type StudioModel = {
  key: string; // game id
  code: string;
  game_id: number;
  date: string;
  time_et: string;
  tv: string;
  away: string;
  home: string;
  played: boolean;
  as_of: string; // ratings date
  fit_games: number;
  pred_margin: number | null; // home minus road
  home_wp: number | null;
  sigma: number | null;
  home_court: number | null;
  rest_adj: number | null;
  line_margin: number | null;
  espn_away_wp: number | null;
  espn_home_wp: number | null;
  actual_margin: number | null;
  ats: string | null;
  pick: string | null;
  sides: Record<string, ModelSide>;
  season: { games: number; line_games: number; model_mae: number | null; line_mae: number | null; ats_w: number; ats_l: number; ats_p: number } | null;
};

/** One story idea from last night, with the numbers and the chart behind it. */
export type StudioStory = {
  key: string; // "<night>-<rank>"
  rank: number;
  date: string; // the game night
  kind: string;
  kind_label: string;
  headline: string;
  detail: string;
  name: string; // player name, or the team's full name
  team: string;
  opp: string;
  figures: [string, string][];
  chart: StoryChart | null;
  also: string[];
  key_figure: string;
};

export type StudioData = {
  day: string;
  yday: string;
  season: number | null;
  teams: Record<string, StudioTeam>;
  players: StudioPlayerLine[];
  matchups: StudioMatchup[];
  recaps: StudioRecap[];
  flows: StudioFlow[];
  league: ScatterTeam[];
  shotCharts: StudioShotChart[];
  models: StudioModel[];
  stories: StudioStory[];
};

export const SIZES = {
  feed: { w: 1080, h: 1350, label: "Feed 1080 x 1350" },
  story: { w: 1080, h: 1920, label: "Story 1080 x 1920" },
  youtube: { w: 1920, h: 1080, label: "YouTube 1920 x 1080" },
} as const;

export type SizeKey = keyof typeof SIZES;

export const TEMPLATES = {
  player: "Player game card",
  matchup: "Matchup preview",
  league: "League offense vs defense",
  recap: "Game recap",
  shots: "Shot chart",
  flow: "Game flow",
  model: "Model vs Vegas",
  story: "Story card",
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export type StudioSelection = {
  template: TemplateKey;
  size: SizeKey;
  handle: string;
  player?: string; // StudioPlayerLine.key
  matchup?: string; // game id (a game code also works)
  recap?: string; // game code
  shot?: string; // StudioShotChart.key
  flow?: string; // game code
  model?: string; // game id
  story?: string; // StudioStory.key
  highlight?: string[]; // team codes
};
