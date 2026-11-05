import { scaleBand, scaleLinear } from "d3";

import { CHART } from "@/lib/colors";
import { signed } from "@/lib/format";

/** Rounded data end, square at the baseline (horizontal bar). */
function hbar(x0: number, x1: number, y: number, h: number, r = 4): string {
  const right = x1 >= x0;
  const len = Math.abs(x1 - x0);
  const rr = Math.min(r, len, h / 2);
  if (len < 0.5) return "";
  if (right) {
    return `M${x0},${y}H${x1 - rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 - rr},${y + h}H${x0}Z`;
  }
  return `M${x0},${y}H${x1 + rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 + rr},${y + h}H${x0}Z`;
}

/** Rounded data end, square at the baseline (vertical column). */
function vbar(y0: number, y1: number, x: number, w: number, r = 4): string {
  const up = y1 <= y0;
  const len = Math.abs(y1 - y0);
  const rr = Math.min(r, len, w / 2);
  if (len < 0.5) return "";
  if (up) {
    return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`;
}

export type NetRow = { code: string; net: number; accent: string; name: string; w: number; l: number; net_rk: number | null };

/** Net rating by team, best to worst, diverging from zero. */
export function NetBars({ rows, width = 640, rowH = 22, font = 12 }: { rows: NetRow[]; width?: number; rowH?: number; font?: number }) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.net - a.net);
  const labW = font * 3.6;
  const valW = font * 3.4;
  const maxAbs = Math.max(1, ...sorted.map((r) => Math.abs(r.net)));
  const x = scaleLinear([-maxAbs, maxAbs], [labW + valW, width - valW]);
  const height = sorted.length * rowH + font * 2;
  const barH = Math.min(14, rowH - 6);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Net rating by team, best to worst" style={{ display: "block" }}>
      <line x1={x(0)} x2={x(0)} y1={0} y2={sorted.length * rowH} stroke={CHART.axis} strokeWidth={1} />
      {sorted.map((r, i) => {
        const y = i * rowH;
        const pos = r.net >= 0;
        return (
          <g key={r.code}>
            <title>{`${r.name} (${r.w}-${r.l}): net rating ${signed(r.net)}, ${r.net_rk ?? ""}`}</title>
            <rect x={0} y={y + (rowH - font) / 2} width={3} height={font} rx={1} fill={r.accent} />
            <text x={8} y={y + rowH / 2} dominantBaseline="middle" fontSize={font} fontWeight={600} fill={CHART.ink}>
              {r.code}
            </text>
            <path d={hbar(x(0), x(r.net), y + (rowH - barH) / 2, barH)} fill={pos ? CHART.plus : CHART.minus} />
            <text
              x={pos ? x(r.net) + 6 : x(r.net) - 6}
              y={y + rowH / 2}
              dominantBaseline="middle"
              textAnchor={pos ? "start" : "end"}
              fontSize={font}
              fill={CHART.ink2}
              className="num"
            >
              {signed(r.net)}
            </text>
            <rect x={0} y={y} width={width} height={rowH} fill="transparent" />
          </g>
        );
      })}
      <text x={x(0)} y={height - font * 0.3} textAnchor="middle" fontSize={font} fill={CHART.muted}>
        0
      </text>
    </svg>
  );
}

export type ColumnPoint = { key: string; label: string; value: number | null; title: string; strong?: boolean };

/**
 * One column per game. `diverging` colors by sign (plus-minus); otherwise one series color.
 * `avg` draws a reference line with its label. When any point is `strong`, the others are drawn faded.
 */
export function Columns({
  points,
  width = 640,
  height = 200,
  font = 11,
  diverging = false,
  color = CHART.plus,
  avg,
  avgLabel,
}: {
  points: ColumnPoint[];
  width?: number;
  height?: number;
  font?: number;
  diverging?: boolean;
  color?: string;
  avg?: number | null;
  avgLabel?: string;
}) {
  if (!points.length) return null;
  const vals = points.map((p) => p.value ?? 0);
  const labelRoom = avg !== null && avg !== undefined && avgLabel ? Math.min(width * 0.32, avgLabel.length * font * 0.56 + font) : font * 0.5;
  const m = { top: font * 1.6, right: labelRoom, bottom: font * 2.2, left: font * 3 };
  const lo = diverging ? Math.min(0, ...vals) : 0;
  const hi = Math.max(diverging ? 0 : 1, ...vals, avg ?? 0);
  const y = scaleLinear([lo, hi], [height - m.bottom, m.top]).nice();
  const xb = scaleBand(points.map((p) => p.key), [m.left, width - m.right]).padding(0.28);
  const bw = Math.min(24, xb.bandwidth());
  const ticks = y.ticks(4);
  const every = Math.max(1, Math.ceil(points.length / Math.floor((width - m.left) / (font * 4.2))));
  const focus = points.some((p) => p.strong);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={avgLabel ?? "Game by game"} style={{ display: "block" }}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
          <text x={m.left - font * 0.5} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={font} fill={CHART.muted} className="num">
            {diverging && v > 0 ? `+${v}` : v}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const v = p.value;
        const cx = (xb(p.key) ?? 0) + (xb.bandwidth() - bw) / 2;
        return (
          <g key={p.key}>
            {v !== null ? (
              <path d={vbar(y(0), y(v), cx, bw)} fill={diverging ? (v >= 0 ? CHART.plus : CHART.minus) : color} fillOpacity={focus && !p.strong ? 0.4 : 1} />
            ) : null}
            <rect x={xb(p.key) ?? 0} y={m.top} width={xb.step()} height={height - m.top - m.bottom} fill="transparent">
              <title>{p.title}</title>
            </rect>
            {i % every === 0 || p.strong ? (
              <text x={cx + bw / 2} y={height - font * 0.6} textAnchor="middle" fontSize={font} fill={p.strong ? CHART.ink : CHART.muted} fontWeight={p.strong ? 600 : undefined}>
                {p.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {avg !== null && avg !== undefined ? (
        <g>
          <line x1={m.left} x2={width - m.right} y1={y(avg)} y2={y(avg)} stroke={CHART.ink2} strokeWidth={1} strokeOpacity={0.7} />
          <text x={width - m.right + font * 0.5} y={y(avg)} dominantBaseline="middle" fontSize={font} fill={CHART.ink2}>
            {avgLabel}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

export { hbar, vbar };
