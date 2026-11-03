/** Plain JSON shapes for the studio (passed from server to the client editor). */
import type { ScatterTeam } from "@/components/charts/OffDefScatter";

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
  code: string;
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

export type StudioData = {
  day: string;
  yday: string;
  season: number | null;
  teams: Record<string, StudioTeam>;
  players: StudioPlayerLine[];
  matchups: StudioMatchup[];
  recaps: StudioRecap[];
  league: ScatterTeam[];
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
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export type StudioSelection = {
  template: TemplateKey;
  size: SizeKey;
  handle: string;
  player?: string; // StudioPlayerLine.key
  matchup?: string; // game code
  recap?: string; // game code
  highlight?: string[]; // team codes
};
