/** Number and date formatting shared by pages, charts and studio frames. */

export const TZ = "America/New_York";
const MINUS = "−";

type N = number | null | undefined;

export const isNum = (v: N): v is number => typeof v === "number" && Number.isFinite(v);

/** One decimal, or an en dash when missing. */
export function f1(v: N): string {
  return isNum(v) ? v.toFixed(1) : "–";
}

export function f0(v: N): string {
  return isNum(v) ? Math.round(v).toString() : "–";
}

/** Signed with a real minus sign: +4.5, −2.0, 0.0 */
export function signed(v: N, digits = 1): string {
  if (!isNum(v)) return "–";
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return digits ? (0).toFixed(digits) : "0";
  return (v > 0 ? "+" : MINUS) + s;
}

export function signedInt(v: N): string {
  return signed(v, 0);
}

export function ordinal(n: N): string {
  if (!isNum(n)) return "";
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function pctText(v: N): string {
  return isNum(v) ? `${v.toFixed(1)}%` : "–";
}

/** ".857" style winning percentage */
export function winPct(w: number, l: number): string {
  if (w + l === 0) return ".000";
  const p = w / (w + l);
  return p >= 1 ? "1.000" : p.toFixed(3).replace(/^0/, "");
}

export function record(w: N, l: N): string {
  return isNum(w) && isNum(l) ? `${w}-${l}` : "";
}

/* ------------------------------------------------------------------ dates (ISO yyyy-mm-dd, New York) */

export function todayET(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** "Monday, Nov 2" */
export function longDate(iso: string): string {
  const d = utc(iso);
  const wd = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${wd}, ${md}`;
}

/** "Mon, Nov 2" */
export function shortDay(iso: string): string {
  const d = utc(iso);
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${wd}, ${md}`;
}

/** "Nov 2" */
export function monthDay(iso: string): string {
  return utc(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Postgres timestamptz text ("2026-11-03 00:00:00+00") or ISO -> Date */
export function parseTs(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  let s = v.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) s += ":00";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "7:00 PM" in New York */
export function timeET(tip: string | Date | null | undefined): string {
  const d = parseTs(tip);
  if (!d) return "TBD";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function seasonLabel(season: number | null | undefined): string {
  if (!season) return "";
  return `${season - 1}-${String(season).slice(2)}`;
}

/** A game's tip time in New York, or "TBD" while ESPN has the date but not the time. */
export function tipTime(g: { tip: string | Date | null | undefined; time_valid?: boolean | null }): string {
  return g.time_valid === false ? "TBD" : timeET(g.tip);
}

/** "Tonight", "Tomorrow", or the weekday, measured from `today`. */
export function dayWord(day: string, today: string): string {
  if (day === today) return "Tonight";
  if (day === addDays(today, 1)) return "Tomorrow";
  return utc(day).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}
