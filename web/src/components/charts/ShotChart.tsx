import { CHART, HEX_COLORS } from "@/lib/colors";
import { COURT, hexbin, hexPath, hexScale, type ShotLike, ZONE_LABEL, type ZoneKey, zoneClass } from "@/lib/shots";

export type ChartShot = ShotLike & { title?: string };

/** The subject's numbers for one zone: they color every hex whose shots mostly came from it. */
export type ZoneShade = { fga: number; fg_pct: number | null; lg_fg_pct: number | null; fg_pct_diff: number | null };

type Props = {
  shots: ChartShot[];
  /** dots: every make and miss. hex: hexagons sized by attempts, colored by the zone's FG% against the league. */
  view: "dots" | "hex";
  width?: number;
  /** the subject's zone rows, for the hex colors */
  zones?: Partial<Record<string, ZoneShade>>;
  madeColor?: string;
  missColor?: string;
  lineColor?: string;
  surface?: string;
  /** feet from the baseline to draw; 47 is the whole half court */
  depth?: number;
  hexRadius?: number;
  label: string;
};

const BASE = COURT.baseline;

/**
 * A half court in feet with the basket at the top, drawn to NBA dimensions, and the shots on it. Pure SVG, so the
 * same component renders on the pages and in studio frames. Shots past the drawn depth (heaves) are left off.
 */
export function ShotChart({
  shots,
  view,
  width = 500,
  zones = {},
  madeColor = CHART.plus,
  missColor = CHART.muted,
  lineColor = CHART.axis,
  surface = CHART.surface,
  depth = 47,
  hexRadius = 1.6,
  label,
}: Props) {
  const lw = Math.max(1, width / 420); // court line width
  const m = lw; // keep the outer lines inside the box
  const s = (width - 2 * m) / (2 * COURT.halfWidth); // px per foot
  const height = Math.round(2 * m + depth * s);
  const X = (x: number) => m + (x + COURT.halfWidth) * s;
  const Y = (y: number) => m + (y - BASE) * s;
  const R = (ft: number) => ft * s;
  const inView = shots.filter((p) => p.y - BASE <= depth && Math.abs(p.x) <= COURT.halfWidth);
  const id = `court-${Math.round(width)}-${depth}`;

  const lines = [
    // baseline and sidelines (the half-court line only when the whole half court is drawn)
    `M${X(-25)},${Y(BASE + depth)}V${Y(BASE)}H${X(25)}V${Y(BASE + depth)}`,
    // lane up to the free throw line, and the outer half of the free throw circle
    `M${X(-COURT.laneHalf)},${Y(BASE)}V${Y(COURT.freeThrow)}H${X(COURT.laneHalf)}V${Y(BASE)}`,
    `M${X(-COURT.circle)},${Y(COURT.freeThrow)}A${R(COURT.circle)},${R(COURT.circle)} 0 0 0 ${X(COURT.circle)},${Y(COURT.freeThrow)}`,
    // three-point line: straight in the corners, then the arc
    `M${X(-COURT.cornerX)},${Y(BASE)}V${Y(COURT.cornerTop)}A${R(COURT.arc)},${R(COURT.arc)} 0 0 0 ${X(COURT.cornerX)},${Y(COURT.cornerTop)}V${Y(BASE)}`,
    // restricted area
    `M${X(-COURT.restricted)},${Y(COURT.backboard)}V${Y(0)}A${R(COURT.restricted)},${R(COURT.restricted)} 0 0 0 ${X(COURT.restricted)},${Y(0)}V${Y(COURT.backboard)}`,
  ];
  if (depth >= COURT.halfCourt - BASE) {
    lines.push(`M${X(-25)},${Y(COURT.halfCourt)}H${X(25)}`);
    lines.push(`M${X(-COURT.circle)},${Y(COURT.halfCourt)}A${R(COURT.circle)},${R(COURT.circle)} 0 0 1 ${X(COURT.circle)},${Y(COURT.halfCourt)}`);
  }

  const dot = Math.max(4, s * 0.42); // r >= 4 px: marks stay at least 8 px across
  const many = inView.length > 400; // past this, one path per kind and no per-shot tooltips
  let marks: React.ReactNode;
  if (view === "hex") {
    const hexes = hexbin(inView, hexRadius);
    const size = hexScale(hexes);
    marks = hexes
      .sort((a, b) => a.n - b.n)
      .map((h) => {
        const z = zones[h.zone];
        const cls = z ? zoneClass(z.fg_pct_diff, z.fga) : 0;
        const label = ZONE_LABEL[h.zone as ZoneKey] ?? h.zone;
        const tip =
          `${h.made} of ${h.n} made here. ` +
          (z && z.fg_pct !== null && z.lg_fg_pct !== null
            ? `${label}: ${z.fg_pct.toFixed(1)}% against the league's ${z.lg_fg_pct.toFixed(1)}%.${z.fga < 5 ? " Too few shots from this zone to color." : ""}`
            : label);
        return (
          <path key={`${h.cx},${h.cy}`} d={hexPath(R(hexRadius) * size(h.n))} transform={`translate(${X(h.cx).toFixed(1)},${Y(h.cy).toFixed(1)})`} fill={HEX_COLORS[cls + 2]} stroke={surface} strokeWidth={Math.max(1, lw)}>
            <title>{tip}</title>
          </path>
        );
      });
  } else {
    const made = inView.filter((p) => p.made);
    const missed = inView.filter((p) => !p.made);
    const arm = dot * 0.72;
    const cross = (p: ChartShot) => {
      const cx = X(p.x);
      const cy = Y(p.y);
      return `M${(cx - arm).toFixed(1)},${(cy - arm).toFixed(1)}L${(cx + arm).toFixed(1)},${(cy + arm).toFixed(1)}M${(cx - arm).toFixed(1)},${(cy + arm).toFixed(1)}L${(cx + arm).toFixed(1)},${(cy - arm).toFixed(1)}`;
    };
    const circle = (p: ChartShot) => {
      const cx = X(p.x);
      const cy = Y(p.y);
      return `M${(cx - dot).toFixed(1)},${cy.toFixed(1)}a${dot.toFixed(1)},${dot.toFixed(1)} 0 1 0 ${(2 * dot).toFixed(1)},0a${dot.toFixed(1)},${dot.toFixed(1)} 0 1 0 ${(-2 * dot).toFixed(1)},0`;
    };
    marks = many ? (
      <>
        <path d={missed.map(cross).join("")} stroke={missColor} strokeWidth={Math.max(1.5, dot * 0.36)} strokeLinecap="round" fill="none" opacity={0.85} />
        <path d={made.map(circle).join("")} fill={madeColor} stroke={surface} strokeWidth={1.5} />
      </>
    ) : (
      <>
        {missed.map((p, i) => (
          <g key={`x${i}`}>
            <path d={cross(p)} stroke={missColor} strokeWidth={Math.max(1.5, dot * 0.36)} strokeLinecap="round" fill="none" />
            {p.title ? (
              <circle cx={X(p.x)} cy={Y(p.y)} r={Math.max(dot, 8)} fill="transparent">
                <title>{p.title}</title>
              </circle>
            ) : null}
          </g>
        ))}
        {made.map((p, i) => (
          <circle key={`o${i}`} cx={X(p.x)} cy={Y(p.y)} r={dot} fill={madeColor} stroke={surface} strokeWidth={1.5}>
            {p.title ? <title>{p.title}</title> : null}
          </circle>
        ))}
      </>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={label} style={{ display: "block" }}>
      <defs>
        <clipPath id={id}>
          <rect x={m} y={m} width={width - 2 * m} height={height - 2 * m} />
        </clipPath>
      </defs>
      <g fill="none" stroke={lineColor} strokeWidth={lw}>
        {lines.map((d, i) => (
          <path key={i} d={d} />
        ))}
        <path d={`M${X(-COURT.backboardHalf)},${Y(COURT.backboard)}H${X(COURT.backboardHalf)}`} strokeWidth={lw * 2} />
        <circle cx={X(0)} cy={Y(0)} r={R(COURT.rim)} stroke={CHART.muted} />
      </g>
      <g clipPath={`url(#${id})`}>{marks}</g>
    </svg>
  );
}

/** Legend for either view, as HTML beside the chart. */
export function ShotLegend({ view, madeColor = CHART.plus }: { view: "dots" | "hex"; madeColor?: string }) {
  if (view === "dots") {
    return (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="5" fill={madeColor} />
          </svg>
          Made
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <path d="M2,2L10,10M2,10L10,2" stroke={CHART.muted} strokeWidth="2" strokeLinecap="round" />
          </svg>
          Missed
        </span>
      </div>
    );
  }
  const steps = ["9+ below", "3 to 9 below", "Within 3", "3 to 9 above", "9+ above"];
  return (
    <div className="grid gap-1.5 text-[12px] text-ink-2">
      <span>Color: FG% from that zone against the league average, in points</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {steps.map((label, i) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <svg width="12" height="13" viewBox="-6.5 -7 13 14" aria-hidden>
              <path d={hexPath(6.5)} fill={HEX_COLORS[i]} />
            </svg>
            {label}
          </span>
        ))}
      </div>
      <span className="text-muted">Bigger hexes have more shots. Gray also means fewer than 5 shots from the zone.</span>
    </div>
  );
}
