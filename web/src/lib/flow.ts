/**
 * Game clock helpers for play-by-play times. Times are elapsed game seconds: 0 at tip-off,
 * 2880 at the end of regulation, 300 more per overtime (the same convention as the pipeline).
 */

export const periodLength = (p: number) => (p <= 4 ? 720 : 300);
export const periodStart = (p: number) => (p <= 4 ? 720 * (p - 1) : 2880 + 300 * (p - 5));
export const gameSeconds = (periods: number) => periodStart(periods) + periodLength(periods);

/** "Q1".."Q4", "OT", "2OT" */
export function periodLabel(p: number): string {
  return p <= 4 ? `Q${p}` : p === 5 ? "OT" : `${p - 4}OT`;
}

/** The period a moment belongs to; a basket at the buzzer belongs to the period it ends. */
export function periodAt(t: number, periods: number): number {
  for (let p = 1; p <= periods; p++) if (t <= periodStart(p) + periodLength(p)) return p;
  return periods;
}

/** Game clock: "7:45", or "24.6" in the last minute, like the broadcast clock. */
export function clockText(left: number): string {
  if (left >= 60) {
    const s = Math.round(left);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  return left.toFixed(1);
}

/** "Q3 4:12" for an elapsed time. */
export function momentText(t: number, periods: number): string {
  const p = periodAt(t, periods);
  return `${periodLabel(p)} ${clockText(periodStart(p) + periodLength(p) - t)}`;
}

/** A length of time as "31:20" (minutes and seconds). */
export function duration(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || !Number.isFinite(secs)) return "–";
  const s = Math.round(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Minutes with one decimal, from seconds. */
export function minutesOf(secs: number | null | undefined): string {
  return secs === null || secs === undefined ? "–" : (secs / 60).toFixed(1);
}
