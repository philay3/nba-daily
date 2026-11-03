/** Stat definitions shared by the matchup breakdown, the team table and the studio. */

export type TeamStatKey =
  | "net" | "l5_net" | "pace" | "ortg" | "ppg" | "efg" | "tov_pct" | "orb_pct" | "ftr" | "fg3_pct" | "fg3a_rate"
  | "paint_pg" | "fb_pg" | "bench_ppg" | "apg" | "drtg" | "opp_ppg" | "opp_efg" | "opp_tov_pct" | "drb_pct"
  | "opp_ftr" | "opp_fg3_pct" | "opp_paint_pg" | "spg" | "bpg";

export type MatchupRow = {
  key: TeamStatKey;
  label: string;
  group: "Overall" | "Offense" | "Defense";
  signed?: boolean;
  /** false for style stats (pace, share of threes): no better side */
  edge?: boolean;
};

/** The ranked season-stat comparison from the old dashboard, in its order. */
export const MATCHUP_ROWS: MatchupRow[] = [
  { group: "Overall", key: "net", label: "Net rating", signed: true },
  { group: "Overall", key: "l5_net", label: "Net rating, last 5 games", signed: true },
  { group: "Overall", key: "pace", label: "Pace (possessions per 48)", edge: false },
  { group: "Offense", key: "ortg", label: "Offensive rating" },
  { group: "Offense", key: "ppg", label: "Points per game" },
  { group: "Offense", key: "efg", label: "Effective FG %" },
  { group: "Offense", key: "tov_pct", label: "Turnover % (lower is better)" },
  { group: "Offense", key: "orb_pct", label: "Offensive rebound %" },
  { group: "Offense", key: "ftr", label: "Free throw rate" },
  { group: "Offense", key: "fg3_pct", label: "3-point %" },
  { group: "Offense", key: "fg3a_rate", label: "Share of shots from three (%)", edge: false },
  { group: "Offense", key: "paint_pg", label: "Paint points per game" },
  { group: "Offense", key: "fb_pg", label: "Fast-break points per game" },
  { group: "Offense", key: "bench_ppg", label: "Bench points per game" },
  { group: "Offense", key: "apg", label: "Assists per game" },
  { group: "Defense", key: "drtg", label: "Defensive rating (lower is better)" },
  { group: "Defense", key: "opp_ppg", label: "Points allowed per game" },
  { group: "Defense", key: "opp_efg", label: "Opponent effective FG %" },
  { group: "Defense", key: "opp_tov_pct", label: "Forced turnover %" },
  { group: "Defense", key: "drb_pct", label: "Defensive rebound %" },
  { group: "Defense", key: "opp_ftr", label: "Opponent free throw rate" },
  { group: "Defense", key: "opp_fg3_pct", label: "Opponent 3-point %" },
  { group: "Defense", key: "opp_paint_pg", label: "Opponent paint points" },
  { group: "Defense", key: "spg", label: "Steals per game" },
  { group: "Defense", key: "bpg", label: "Blocks per game" },
];

export type Ranked = Record<string, number | string | null>;

export type Edge = { team: string | "Even"; by: number; big: boolean };

/** Better rank wins; an edge of 10 or more spots is a big edge (starred). */
export function edgeOf(away: string, home: string, a: Ranked | undefined, h: Ranked | undefined, key: string): Edge | null {
  if (!a || !h) return null;
  const ra = Number(a[`${key}_rk`]);
  const rh = Number(h[`${key}_rk`]);
  if (!Number.isFinite(ra) || !Number.isFinite(rh)) return null;
  const by = Math.abs(ra - rh);
  return { team: ra < rh ? away : rh < ra ? home : "Even", by, big: by >= 10 };
}

export const STATUS_ORDER: Record<string, number> = { Out: 0, Doubtful: 1, Questionable: 2, "Day-to-day": 3, Probable: 4 };

export function statusTone(status: string): "out" | "warn" | "ok" {
  if (status === "Out") return "out";
  if (status === "Probable") return "ok";
  return "warn";
}

/** Out or doubtful players count toward "missing scoring", as in the engine's digest. */
export const MISSING_STATUSES = new Set(["Out", "Doubtful"]);
