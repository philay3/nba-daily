/**
 * Model vs ESPN's line: text helpers shared by pages and studio frames. No imports, so `npm test` runs it as is.
 * Margins are home minus road. A line of "BOS -3.5" means BOS is favored by 3.5.
 */

export type ModelLike = {
  home_code: string;
  away_code: string;
  pred_margin: number | null;
  home_wp: number | null;
  line_margin: number | null;
  actual_margin: number | null;
  pick: string | null;
  ats: string | null;
};

const MINUS = "−";

/** A home margin as a line: "BOS -3.5", or "EVEN" when it rounds to 0. */
export function lineText(home: string, away: string, margin: number | null | undefined, digits = 1): string {
  if (margin === null || margin === undefined || !Number.isFinite(margin)) return "–";
  const abs = Math.abs(margin).toFixed(digits);
  if (Number(abs) === 0) return "EVEN";
  return `${margin > 0 ? home : away} -${abs}`;
}

/** The team the model likes against the line, and by how many points: "BOS by 2.1". */
export function edgeText(m: ModelLike): string | null {
  if (m.pred_margin === null || m.line_margin === null) return null;
  const d = m.pred_margin - m.line_margin;
  const abs = Math.abs(d).toFixed(1);
  if (Number(abs) === 0) return "No edge";
  return `${d > 0 ? m.home_code : m.away_code} by ${abs}`;
}

/** The pick's side as a team code. */
export function pickTeam(m: ModelLike): string | null {
  return m.pick === "home" ? m.home_code : m.pick === "away" ? m.away_code : null;
}

/** "Won", "Lost", "Push", or null. */
export function atsWord(ats: string | null | undefined): string | null {
  return ats === "W" ? "Won" : ats === "L" ? "Lost" : ats === "P" ? "Push" : null;
}

/** Win chances for both sides, road first, from the stored home chance. */
export function winChances(m: Pick<ModelLike, "home_wp">): { away: number; home: number } | null {
  if (m.home_wp === null || !Number.isFinite(m.home_wp)) return null;
  return { away: Math.round((100 - m.home_wp) * 10) / 10, home: m.home_wp };
}

/** A W-L-P record: "46-40-2". */
export function recordText(w: number, l: number, p: number): string {
  return p ? `${w}-${l}-${p}` : `${w}-${l}`;
}

/** Share of decided picks won, pushes left out: "53.5%". */
export function atsPct(w: number, l: number): string {
  return w + l ? `${((100 * w) / (w + l)).toFixed(1)}%` : "–";
}

/** Signed points with a real minus: "+2.1", "−0.4". */
export function pts(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const s = Math.abs(v).toFixed(1);
  if (Number(s) === 0) return "0.0";
  return (v > 0 ? "+" : MINUS) + s;
}
