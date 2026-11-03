/**
 * Shot chart math shared by the pages and the studio: zone names, court dimensions, zone counts and hex bins.
 * Pure and self-contained (no imports), so `npm test` runs its tests with plain `node --test`.
 *
 * Coordinates are feet from the rim, as stored in the shots table: x across the court (-25 to 25), y out toward
 * half court (the baseline is 5.25 ft behind the rim, half court 41.75 ft out). See docs/DATA.md.
 */

export const ZONES = ["restricted_area", "paint", "midrange", "corner_3", "above_break_3", "backcourt"] as const;
export type Zone = (typeof ZONES)[number];
export type ZoneKey = Zone | "all";

export const ZONE_LABEL: Record<ZoneKey, string> = {
  restricted_area: "Restricted area",
  paint: "Paint",
  midrange: "Midrange",
  corner_3: "Corner 3",
  above_break_3: "Above the break 3",
  backcourt: "Backcourt",
  all: "All shots",
};

/** NBA court markings in feet, rim at (0, 0). */
export const COURT = {
  halfWidth: 25,
  baseline: -5.25,
  halfCourt: 41.75,
  backboard: -1.25,
  backboardHalf: 3,
  rim: 0.75,
  restricted: 4,
  laneHalf: 8,
  freeThrow: 13.75,
  circle: 6, // free throw circle and center circle
  cornerX: 22,
  arc: 23.75,
  cornerTop: Math.sqrt(23.75 ** 2 - 22 ** 2), // 8.95: where the straight corner line meets the arc
} as const;

export type ShotLike = { x: number; y: number; made: boolean; zone: string };
export type Counts = { fga: number; fgm: number };

/** Made and attempted by zone (and for all shots), for a set of shots. */
export function zoneCounts(shots: ShotLike[]): Record<ZoneKey, Counts> {
  const out = Object.fromEntries([...ZONES, "all"].map((z) => [z, { fga: 0, fgm: 0 }])) as Record<ZoneKey, Counts>;
  for (const s of shots) {
    const z = (ZONES as readonly string[]).includes(s.zone) ? (s.zone as Zone) : null;
    for (const key of z ? [z, "all" as const] : ["all" as const]) {
      out[key].fga += 1;
      out[key].fgm += s.made ? 1 : 0;
    }
  }
  return out;
}

/** Q1 to Q4, then OT, 2OT ... */
export function periodLabel(p: number): string {
  return p <= 4 ? `Q${p}` : p === 5 ? "OT" : `${p - 4}OT`;
}

export type ShotText = { made: boolean; distance: number; shot_type: string; points: number; period: number; clock: string };

/** Tooltip for one shot: "Jalen Brunson made an 18 ft pullup jump shot (2), Q3 4:12". */
export function shotTitle(s: ShotText, who?: string | null): string {
  const ft = Math.round(s.distance);
  const article = /^(8|11|18)$|^8\d$/.test(String(ft)) ? "an" : "a";
  const kind = s.shot_type ? s.shot_type.toLowerCase() : "shot";
  return `${who ? `${who} ` : ""}${s.made ? "made" : "missed"} ${article} ${ft} ft ${kind}${s.made ? ` (${s.points})` : ""}, ${periodLabel(s.period)} ${s.clock}`;
}

/* ------------------------------------------------------------------ hex bins */

export type Hex = {
  /** hex center in feet */
  cx: number;
  cy: number;
  n: number;
  made: number;
  /** the zone most of its shots came from (ties go to the zone nearer the rim); its color comes from that zone */
  zone: string;
};

/**
 * Pointy-top hexagons of the given radius (feet), laid out like d3-hexbin: each shot goes to the hex whose
 * center is nearest.
 */
export function hexbin(shots: ShotLike[], radius: number): Hex[] {
  const dx = radius * 2 * Math.sin(Math.PI / 3);
  const dy = radius * 1.5;
  const bins = new Map<string, { i: number; j: number; n: number; made: number; zones: Map<string, number> }>();
  for (const s of shots) {
    const py = s.y / dy;
    let j = Math.round(py);
    const px = s.x / dx - (j & 1) / 2;
    let i = Math.round(px);
    const py1 = py - j;
    if (Math.abs(py1) * 3 > 1) {
      // near a row boundary: the hex in the next row may be closer
      const px1 = px - i;
      const i2 = i + (px < i ? -1 : 1) / 2;
      const j2 = j + (py < j ? -1 : 1);
      const px2 = px - i2;
      const py2 = py - j2;
      if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) {
        i = i2 + ((j & 1) ? 1 : -1) / 2;
        j = j2;
      }
    }
    const key = `${i}|${j}`;
    const b = bins.get(key) ?? { i, j, n: 0, made: 0, zones: new Map<string, number>() };
    b.n += 1;
    b.made += s.made ? 1 : 0;
    b.zones.set(s.zone, (b.zones.get(s.zone) ?? 0) + 1);
    bins.set(key, b);
  }
  const order = (z: string) => {
    const k = (ZONES as readonly string[]).indexOf(z);
    return k < 0 ? ZONES.length : k;
  };
  return [...bins.values()].map((b) => ({
    cx: (b.i + (b.j & 1) / 2) * dx,
    cy: b.j * dy,
    n: b.n,
    made: b.made,
    zone: [...b.zones.entries()].sort((x, y) => y[1] - x[1] || order(x[0]) - order(y[0]))[0][0],
  }));
}

/**
 * Color class from a zone's FG% minus the league's: -2 is 9+ points below, -1 3 to 9 below, 0 within 3 (or fewer
 * than `minShots` attempts from the zone, too few to say), 1 3 to 9 above, 2 9+ above.
 */
export function zoneClass(diff: number | null | undefined, fga: number, minShots = 5): -2 | -1 | 0 | 1 | 2 {
  if (diff === null || diff === undefined || fga < minShots) return 0;
  if (diff >= 9) return 2;
  if (diff >= 3) return 1;
  if (diff > -3) return 0;
  if (diff > -9) return -1;
  return -2;
}

/** Hex size as a share of the full radius: area grows with attempts, full size from a busy hex up. */
export function hexScale(hexes: Pick<Hex, "n">[]): (n: number) => number {
  const counts = hexes.map((h) => h.n).sort((a, b) => a - b);
  const ref = Math.max(3, counts[Math.floor(counts.length * 0.85)] ?? 3);
  return (n) => Math.min(1, Math.max(0.3, Math.sqrt(n / ref)));
}

/** SVG path of a pointy-top hexagon centered on (0, 0). */
export function hexPath(r: number): string {
  const pts = [0, 1, 2, 3, 4, 5].map((k) => {
    const a = (k * Math.PI) / 3;
    return `${(Math.sin(a) * r).toFixed(2)},${(-Math.cos(a) * r).toFixed(2)}`;
  });
  return `M${pts.join("L")}Z`;
}
