import { Fragment } from "react";

import { ShotChart, ShotLegend, type ChartShot, type ZoneShade } from "@/components/charts/ShotChart";
import { ShotViews, type ShotView } from "@/components/shots/ShotViews";
import { CHART } from "@/lib/colors";
import { f1, f2, isNum, signed } from "@/lib/format";
import { ZONE_LABEL, ZONES, type ZoneKey } from "@/lib/shots";

/** The columns every zone profile table has (team, player and team-game rows alike). */
export type ZoneRow = {
  zone: string;
  fga: number;
  fgm: number;
  fg_pct: number | null;
  pps: number | null;
  share: number | null;
  lg_fg_pct: number | null;
  lg_pps: number | null;
  lg_share: number | null;
  fg_pct_diff: number | null;
};

/** Zones in court order; the backcourt row only when there were attempts from there. */
export function zoneRows(rows: ZoneRow[]): { zones: ZoneRow[]; all: ZoneRow | null } {
  const by = new Map(rows.map((r) => [r.zone, r]));
  const zones = ZONES.map((z) => by.get(z)).filter((r): r is ZoneRow => Boolean(r) && (r!.zone !== "backcourt" || r!.fga > 0));
  return { zones, all: by.get("all") ?? null };
}

/** FG% minus the league's: the number, and a short bar (blue above the league, orange below). */
function Diff({ value }: { value: number | null }) {
  if (!isNum(value)) return <span className="text-muted">{"–"}</span>;
  const w = Math.min(50, (Math.abs(value) / 15) * 50);
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="num">{signed(value)}</span>
      <span aria-hidden className="relative block h-2 w-7 shrink-0">
        <span className="absolute inset-y-[-2px] left-1/2 w-px" style={{ background: CHART.axis }} />
        <span className="absolute inset-y-0 rounded-[2px]" style={{ width: `${w}%`, left: value >= 0 ? "50%" : `${50 - w}%`, background: value >= 0 ? CHART.plus : CHART.minus }} />
      </span>
    </span>
  );
}

export function ZoneTable({ rows, caption }: { rows: ZoneRow[]; caption: string }) {
  const { zones, all } = zoneRows(rows);
  if (!zones.length) return null;
  const cells = (r: ZoneRow, strong = false) => (
    <>
      <td className={`r num ${strong ? "font-semibold" : ""}`}>
        {r.fgm}-{r.fga}
      </td>
      <td className="r num font-semibold">{f1(r.fg_pct)}</td>
      <td className="r num text-ink-2">{f1(r.lg_fg_pct)}</td>
      <td className="r">
        <Diff value={r.fg_pct_diff} />
      </td>
      <td className="r num">{f2(r.pps)}</td>
      <td className="r num text-ink-2">{f2(r.lg_pps)}</td>
      <td className="r num">{f1(r.share)}</td>
      <td className="r num text-ink-2">{f1(r.lg_share)}</td>
    </>
  );
  return (
    <div className="table-wrap">
      <table className="data-table [&_td]:px-[7px] [&_th]:px-[7px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th className="sticky-col">Zone</th>
            <th className="r">Made</th>
            <th className="r">FG%</th>
            <th className="r" title="League FG% from this zone">League</th>
            <th className="r" title="FG% minus the league's, in points">+/-</th>
            <th className="r leading-tight">
              Points
              <br />
              per shot
            </th>
            <th className="r" title="League points per shot from this zone">League</th>
            <th className="r" title="Share of attempts from this zone">Share</th>
            <th className="r" title="League share of attempts from this zone">League</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((r) => (
            <tr key={r.zone} className={r.zone === "backcourt" ? "text-muted" : ""}>
              <td className="sticky-col">{ZONE_LABEL[r.zone as ZoneKey] ?? r.zone}</td>
              {cells(r)}
            </tr>
          ))}
          {all ? (
            <tr className="group-break">
              <td className="sticky-col font-semibold">{ZONE_LABEL.all}</td>
              {cells(all, true)}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** How the charted shots compare with the box score's attempts, in plain words. */
export function coverageNote(shots: number, fga: number | null | undefined): string {
  if (!fga && !shots) return "No shots yet.";
  if (fga === null || fga === undefined) return `${shots} shots.`;
  if (shots === fga) return `All ${fga} attempts in the box score.`;
  if (shots < fga) return `${shots} of the box score's ${fga} attempts. ESPN's play-by-play has ${fga - shots} fewer.`;
  return `${shots} shots. ESPN's play-by-play has ${shots - fga} more than the box score's ${fga} attempts.`;
}

/** Two subjects (both teams of a game, or a team's offense and defense) by zone, beside the league. */
export function ZoneCompare({ sides, caption }: { sides: { label: string; rows: ZoneRow[] }[]; caption: string }) {
  const maps = sides.map((x) => new Map(x.rows.map((r) => [r.zone, r])));
  const zones: ZoneKey[] = [...ZONES.filter((z) => z !== "backcourt" || maps.some((m) => (m.get(z)?.fga ?? 0) > 0)), "all"];
  const lg = (z: string) => maps.map((m) => m.get(z)).find(Boolean) ?? null;
  const first = "border-l border-line";
  return (
    <div className="panel table-wrap">
      <table className="data-table [&_td]:px-[7px] [&_th]:px-[7px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th rowSpan={2} className="sticky-col align-bottom">
              Zone
            </th>
            {sides.map((x) => (
              <th key={x.label} colSpan={5} className={`${first} text-ink-2`}>
                {x.label}
              </th>
            ))}
            <th colSpan={3} className={`${first} text-ink-2`}>
              League
            </th>
          </tr>
          <tr>
            {sides.map((x) => (
              <Fragment key={x.label}>
                <th className={`r ${first}`}>Made</th>
                <th className="r">FG%</th>
                <th className="r" title="FG% minus the league's, in points">
                  +/-
                </th>
                <th className="r leading-tight">
                  Points
                  <br />
                  per shot
                </th>
                <th className="r" title="Share of attempts from this zone">
                  Share
                </th>
              </Fragment>
            ))}
            <th className={`r ${first}`}>FG%</th>
            <th className="r leading-tight">
              Points
              <br />
              per shot
            </th>
            <th className="r">Share</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => {
            const l = lg(z);
            return (
              <tr key={z} className={`${z === "all" ? "group-break font-semibold" : ""} ${z === "backcourt" ? "text-muted" : ""}`}>
                <td className="sticky-col">{ZONE_LABEL[z]}</td>
                {maps.map((m, i) => {
                  const r = m.get(z);
                  return (
                    <Fragment key={i}>
                      <td className={`r num ${first}`}>{r ? `${r.fgm}-${r.fga}` : "–"}</td>
                      <td className="r num font-semibold">{f1(r?.fg_pct)}</td>
                      <td className="r">
                        <Diff value={r?.fg_pct_diff ?? null} />
                      </td>
                      <td className="r num">{f2(r?.pps)}</td>
                      <td className="r num">{z === "all" ? "" : f1(r?.share)}</td>
                    </Fragment>
                  );
                })}
                <td className={`r num text-ink-2 ${first}`}>{f1(l?.lg_fg_pct)}</td>
                <td className="r num text-ink-2">{f2(l?.lg_pps)}</td>
                <td className="r num text-ink-2">{z === "all" ? "" : f1(l?.lg_share)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Zone rows keyed by zone, for the hex colors. */
export function shades(rows: ZoneRow[]): Record<string, ZoneShade> {
  return Object.fromEntries(rows.map((r) => [r.zone, r]));
}

type PanelProps = {
  label: string;
  shots: ChartShot[];
  zones: ZoneRow[];
  madeColor: string;
  initial?: ShotView;
  note?: string;
  head?: React.ReactNode;
  /** the zone table under the chart (off when the page shows a comparison table instead) */
  table?: boolean;
  /** chart beside the table on wide screens */
  wide?: boolean;
};

/** One subject's shots: the chart with both views, its legend, a coverage note and the zone table. */
export function ShotPanel({ label, shots, zones, madeColor, initial = "dots", note, head, table = true, wide = false }: PanelProps) {
  const chart = (view: ShotView) => (
    <div className="grid gap-2">
      <ShotChart view={view} shots={shots} zones={shades(zones)} madeColor={madeColor} label={`${label}: ${view === "dots" ? "makes and misses" : "attempts by spot, colored by the zone's FG% against the league"}`} />
      <ShotLegend view={view} madeColor={madeColor} />
    </div>
  );
  return (
    <div className="panel grid gap-4 p-4 sm:p-5">
      {head}
      <div className={wide && table ? "grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start" : "grid gap-4"}>
        <div className="grid gap-2">
          <ShotViews label={label} initial={initial} dots={chart("dots")} hex={chart("hex")} />
          {note ? <p className="note">{note}</p> : null}
        </div>
        {table ? zones.length ? <ZoneTable rows={zones} caption={`${label} by zone`} /> : <p className="text-[14px] text-muted">No shots yet.</p> : null}
      </div>
    </div>
  );
}
