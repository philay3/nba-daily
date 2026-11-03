import Link from "next/link";

import { CHART, teamAccent } from "@/lib/colors";
import { isNum, signed, signedInt } from "@/lib/format";
import { statusTone } from "@/lib/metrics";

export type TeamLike = { code: string; primary_color: string; secondary_color: string; nickname?: string; display_name?: string };

export function accentOf(team: TeamLike | undefined | null): string {
  return team ? teamAccent(team.primary_color, team.secondary_color) : CHART.muted;
}

/** Team code with its color stripe. Text stays in ink; the stripe carries the identity. */
export function TeamMark({
  team,
  code,
  link = true,
  size = "sm",
  label,
}: {
  team?: TeamLike | null;
  code: string;
  link?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const bar = size === "lg" ? "h-7 w-1.5" : size === "md" ? "h-5 w-1" : "h-3.5 w-[3px]";
  const inner = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`${bar} shrink-0 rounded-[1px]`} style={{ background: accentOf(team) }} />
      <span className={size === "lg" ? "display text-[28px]" : "font-semibold"}>{label ?? code}</span>
    </span>
  );
  if (!link) return inner;
  return (
    <Link href={`/teams/${code}`} className="no-underline hover:underline">
      {inner}
    </Link>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (!status) return null;
  const tone = statusTone(status);
  const color = tone === "out" ? "var(--color-out)" : tone === "ok" ? "var(--color-ok)" : "var(--color-warn)";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      {status}
    </span>
  );
}

/** Signed value with a small diverging bar (blue = plus, orange = minus). */
export function PmBar({ value, maxAbs, digits = 0 }: { value: number | null | undefined; maxAbs: number; digits?: number }) {
  if (!isNum(value)) return <span className="text-muted">{"–"}</span>;
  const w = Math.min(50, (Math.abs(value) / Math.max(1, maxAbs)) * 50);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="num">{digits ? signed(value, digits) : signedInt(value)}</span>
      <span aria-hidden className="relative block h-2 w-11 shrink-0">
        <span className="absolute inset-y-[-2px] left-1/2 w-px" style={{ background: CHART.axis }} />
        <span
          className="absolute inset-y-0 rounded-[2px]"
          style={{
            width: `${w}%`,
            left: value >= 0 ? "50%" : `${50 - w}%`,
            background: value >= 0 ? CHART.plus : CHART.minus,
          }}
        />
      </span>
    </span>
  );
}

/** Up or down marker for a stat well above or below the player's average before the game. */
export function DeltaMark({ delta, threshold }: { delta: number | null | undefined; threshold: number }) {
  if (!isNum(delta) || Math.abs(delta) < threshold) return null;
  const up = delta > 0;
  return (
    <span
      className="ml-1 text-[10px] align-[1px]"
      style={{ color: up ? CHART.plus : CHART.minus }}
      title={`${signed(delta)} vs his average before this game`}
    >
      {up ? "▲" : "▼"}
      <span className="sr-only">{up ? "above" : "below"} average</span>
    </span>
  );
}

/** Win odds as one split bar; the favorite's side in its team accent, the other side muted. */
export function WinSplit({
  away,
  home,
  awayWp,
  homeWp,
  awayTeam,
  homeTeam,
}: {
  away: string;
  home: string;
  awayWp: number;
  homeWp: number;
  awayTeam?: TeamLike | null;
  homeTeam?: TeamLike | null;
}) {
  const awayFav = awayWp >= homeWp;
  return (
    <div className="grid gap-1.5" title={`Win odds: ${away} ${awayWp}%, ${home} ${homeWp}%`}>
      <div className="flex justify-between text-[12px] num text-ink-2">
        <span>
          {away} {awayWp.toFixed(1)}%
        </span>
        <span>
          {home} {homeWp.toFixed(1)}%
        </span>
      </div>
      <div className="flex h-2 gap-[2px]" aria-hidden>
        <span className="block rounded-l-[4px]" style={{ flexGrow: awayWp, background: awayFav ? accentOf(awayTeam) : CHART.axis }} />
        <span className="block rounded-r-[4px]" style={{ flexGrow: homeWp, background: awayFav ? CHART.axis : accentOf(homeTeam) }} />
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel px-5 py-6">
      <p className="font-semibold">{title}</p>
      {children ? <div className="note mt-1 max-w-[64ch]">{children}</div> : null}
    </div>
  );
}

export function SectionHead({ title, children, id }: { title: string; children?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-4 grid gap-1.5" id={id}>
      <h2 className="section-title">{title}</h2>
      {children ? <p className="note max-w-[72ch]">{children}</p> : null}
    </div>
  );
}

export function NoDatabase() {
  return (
    <div className="py-16">
      <Empty title="The database is not connected">
        Set DATABASE_URL in the .env file at the repo root, then run <code>python3 -m nba_pipeline migrate</code> and{" "}
        <code>python3 -m nba_pipeline seed</code>. The README has the full setup.
      </Empty>
    </div>
  );
}
