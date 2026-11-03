import { scaleLinear } from "d3";

import { CHART } from "@/lib/colors";
import { ordinal, signed } from "@/lib/format";

export type ScatterTeam = {
  code: string;
  name: string;
  conf: string;
  ortg: number;
  drtg: number;
  net: number | null;
  ortg_rk: number | null;
  drtg_rk: number | null;
  w: number;
  l: number;
  accent: string;
};

type Props = {
  teams: ScatterTeam[];
  width?: number;
  height?: number;
  font?: number;
  /** conference: East/West hues for every dot. highlight: listed teams in their color, the rest muted. */
  mode?: "conference" | "highlight";
  highlight?: string[];
  surface?: string;
  dot?: number;
};

/**
 * Offensive rating across, defensive rating up (fewer points allowed is higher), with league-average
 * reference lines. Top right is good on both ends. Labels are placed greedily so they never overlap.
 */
export function OffDefScatter({
  teams,
  width = 900,
  height = 560,
  font = 12,
  mode = "conference",
  highlight = [],
  surface = CHART.surface,
  dot = 6,
}: Props) {
  if (!teams.length) return null;
  const xs = teams.map((t) => t.ortg);
  const ys = teams.map((t) => t.drtg);
  const pad = 1.5;
  const m = { top: font * 2.2, right: font * 1.5, bottom: font * 3.6, left: font * 4.4 };
  const x = scaleLinear([Math.min(...xs) - pad, Math.max(...xs) + pad], [m.left, width - m.right]).nice();
  const y = scaleLinear([Math.max(...ys) + pad, Math.min(...ys) - pad], [height - m.bottom, m.top]).nice();
  const avgO = xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgD = ys.reduce((a, b) => a + b, 0) / ys.length;
  const hi = new Set(highlight);
  const colorOf = (t: ScatterTeam) =>
    mode === "highlight" ? (hi.has(t.code) ? t.accent : CHART.axis) : t.conf === "East" ? CHART.east : CHART.west;

  // greedy label placement: biggest |net| first, four candidate spots, skip if all collide
  type Box = { x1: number; x2: number; y1: number; y2: number };
  const placed: Box[] = teams.map((t) => {
    const cx = x(t.ortg);
    const cy = y(t.drtg);
    return { x1: cx - dot - 2, x2: cx + dot + 2, y1: cy - dot - 2, y2: cy + dot + 2 };
  });
  const overlaps = (b: Box) => placed.some((p) => !(b.x2 < p.x1 || b.x1 > p.x2 || b.y2 < p.y1 || b.y1 > p.y2));
  const labelFont = mode === "highlight" ? font : font * 0.95;
  const labels: { t: ScatterTeam; x: number; y: number; anchor: "start" | "end" | "middle"; strong: boolean }[] = [];
  const order = [...teams].sort((a, b) => {
    const ha = hi.has(a.code) ? 1 : 0;
    const hb = hi.has(b.code) ? 1 : 0;
    return hb - ha || Math.abs(b.net ?? 0) - Math.abs(a.net ?? 0);
  });
  for (const t of order) {
    const strong = mode !== "highlight" || hi.has(t.code);
    const fs = strong && mode === "highlight" ? labelFont * 1.35 : labelFont;
    // Team codes are bold capitals, wider than an average character: size the box generously
    // (plus a little padding) so labels never touch, even if that drops a crowded label.
    const w = t.code.length * fs * (strong && mode === "highlight" ? 0.8 : 0.72) + 4;
    const h = fs;
    const cx = x(t.ortg);
    const cy = y(t.drtg);
    const g = dot + 4;
    const options: [number, number, "start" | "end" | "middle"][] = [
      [cx + g, cy + h * 0.35, "start"],
      [cx - g, cy + h * 0.35, "end"],
      [cx, cy - g, "middle"],
      [cx, cy + g + h * 0.8, "middle"],
    ];
    // A highlighted team must always be labeled: try the diagonals too, then take the first spot
    // that fits on the chart even if it covers a muted dot.
    const must = strong && mode === "highlight";
    if (must) {
      options.push(
        [cx + g * 0.7, cy - g * 0.7, "start"],
        [cx - g * 0.7, cy - g * 0.7, "end"],
        [cx + g * 0.7, cy + g * 0.7 + h * 0.8, "start"],
        [cx - g * 0.7, cy + g * 0.7 + h * 0.8, "end"],
      );
    }
    const boxOf = ([lx, ly, anchor]: [number, number, "start" | "end" | "middle"]) => {
      const x1 = anchor === "start" ? lx : anchor === "end" ? lx - w : lx - w / 2;
      return { x1, x2: x1 + w, y1: ly - h, y2: ly + 2 };
    };
    const inside = (b: Box) => !(b.x1 < m.left || b.x2 > width - m.right || b.y1 < m.top || b.y2 > height - m.bottom);
    const covered = (b: Box) =>
      placed.reduce((s, p) => s + Math.max(0, Math.min(b.x2, p.x2) - Math.max(b.x1, p.x1)) * Math.max(0, Math.min(b.y2, p.y2) - Math.max(b.y1, p.y1)), 0);
    const fits = options.find((o) => inside(boxOf(o)) && !overlaps(boxOf(o)));
    // when nothing is free, a highlighted label takes the in-bounds spot that covers the least
    const pick =
      fits ??
      (must
        ? options.filter((o) => inside(boxOf(o))).sort((a, b) => covered(boxOf(a)) - covered(boxOf(b)))[0]
        : undefined);
    if (pick) {
      placed.push(boxOf(pick));
      labels.push({ t, x: pick[0], y: pick[1], anchor: pick[2], strong });
    }
  }

  const xt = x.ticks(width < 500 ? 4 : 7);
  const yt = y.ticks(6);
  const corner = font * 0.95;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Offensive rating against defensive rating for every team" style={{ display: "block" }}>
      {xt.map((v) => (
        <line key={`gx${v}`} x1={x(v)} x2={x(v)} y1={m.top} y2={height - m.bottom} stroke={CHART.grid} strokeWidth={1} />
      ))}
      {yt.map((v) => (
        <line key={`gy${v}`} x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} stroke={CHART.grid} strokeWidth={1} />
      ))}
      <line x1={x(avgO)} x2={x(avgO)} y1={m.top} y2={height - m.bottom} stroke={CHART.ink2} strokeOpacity={0.45} strokeWidth={1} />
      <line x1={m.left} x2={width - m.right} y1={y(avgD)} y2={y(avgD)} stroke={CHART.ink2} strokeOpacity={0.45} strokeWidth={1} />
      <g fontSize={font} fill={CHART.muted}>
        {xt.map((v) => (
          <text key={`tx${v}`} x={x(v)} y={height - m.bottom + font * 1.4} textAnchor="middle">
            {v}
          </text>
        ))}
        {yt.map((v) => (
          <text key={`ty${v}`} x={m.left - font * 0.6} y={y(v)} textAnchor="end" dominantBaseline="middle">
            {v}
          </text>
        ))}
        <text x={(m.left + width - m.right) / 2} y={height - font * 0.6} textAnchor="middle">
          Offensive rating (points scored per 100 possessions)
        </text>
        <text transform={`translate(${font * 1.1}, ${(m.top + height - m.bottom) / 2}) rotate(-90)`} textAnchor="middle">
          Defensive rating (allowed per 100, better is up)
        </text>
        <text x={x(avgO) + 4} y={m.top - font * 0.5} fontSize={font * 0.9}>
          League average
        </text>
      </g>
      <g fontSize={corner} fill={CHART.muted} fontWeight={600}>
        <text x={width - m.right - 4} y={m.top + corner * 1.2} textAnchor="end">
          Good on both ends
        </text>
        <text x={m.left + 6} y={height - m.bottom - corner * 0.6}>
          Struggling on both ends
        </text>
      </g>
      {teams
        .slice()
        .sort((a, b) => Number(hi.has(a.code)) - Number(hi.has(b.code)))
        .map((t) => (
          <g key={t.code}>
            <circle cx={x(t.ortg)} cy={y(t.drtg)} r={hi.has(t.code) && mode === "highlight" ? dot * 1.5 : dot} fill={colorOf(t)} stroke={surface} strokeWidth={2} />
            <circle cx={x(t.ortg)} cy={y(t.drtg)} r={Math.max(12, dot * 2)} fill="transparent">
              <title>
                {`${t.name} (${t.w}-${t.l}): offense ${t.ortg.toFixed(1)} (${ordinal(t.ortg_rk)}), defense ${t.drtg.toFixed(1)} (${ordinal(t.drtg_rk)}), net ${signed(t.net)}`}
              </title>
            </circle>
          </g>
        ))}
      {labels.map(({ t, x: lx, y: ly, anchor, strong }) => (
        <text
          key={`l${t.code}`}
          x={lx}
          y={ly}
          textAnchor={anchor}
          fontSize={strong && mode === "highlight" ? labelFont * 1.35 : labelFont}
          fontWeight={strong ? 700 : 500}
          fill={strong ? CHART.ink : CHART.muted}
        >
          {t.code}
        </text>
      ))}
    </svg>
  );
}
