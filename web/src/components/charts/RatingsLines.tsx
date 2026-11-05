import { line, scaleLinear, scaleUtc } from "d3";

import { CHART } from "@/lib/colors";
import { monthDay, signed } from "@/lib/format";

export type RatingSeries = { code: string; color: string; highlight: boolean; points: { d: string; v: number }[] };

type Props = {
  series: RatingSeries[];
  width?: number;
  height?: number;
  font?: number;
  surface?: string;
  label?: string;
};

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

/**
 * Adjusted net rating by date, one line per team. Highlighted teams are drawn in their color with a label at the
 * end; the rest stay as quiet gray context. The 0 line is the league average.
 */
export function RatingsLines({ series, width = 900, height = 420, font = 12, surface = CHART.surface, label = "Adjusted net rating" }: Props) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return null;
  const dates = all.map((p) => day(p.d).getTime());
  const vals = all.map((p) => p.v);
  const hi = series.filter((s) => s.highlight);
  const labelW = Math.max(3, ...hi.map((s) => s.code.length + 6)) * font * 0.6;
  const m = { top: font * 1.2, right: labelW + font, bottom: font * 2.4, left: font * 3.2 };
  const x = scaleUtc([new Date(Math.min(...dates)), new Date(Math.max(...dates))], [m.left, width - m.right]);
  const ext = Math.max(4, ...vals.map(Math.abs));
  const y = scaleLinear([-ext, ext], [height - m.bottom, m.top]).nice();
  const path = line<{ d: string; v: number }>()
    .x((p) => x(day(p.d)))
    .y((p) => y(p.v));
  const xticks = x.ticks(Math.max(2, Math.floor((width - m.left - m.right) / (font * 7))));
  const yticks = y.ticks(6);

  // end labels for highlighted teams: sorted by value, pushed apart so they never overlap
  const gap = font * 1.15;
  const ends = hi
    .filter((s) => s.points.length)
    .map((s) => {
      const p = s.points[s.points.length - 1];
      return { s, v: p.v, y: y(p.v), x: x(day(p.d)) };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + gap);
  const overflow = ends.length ? ends[ends.length - 1].y - (height - m.bottom) : 0;
  if (overflow > 0) for (const e of ends) e.y -= overflow;
  for (let i = ends.length - 2; i >= 0; i--) ends[i].y = Math.min(ends[i].y, ends[i + 1].y - gap);

  const desc = `${label} by date for ${series.length} teams${hi.length ? `, highlighting ${hi.map((s) => s.code).join(", ")}` : ""}. Zero is the league average.`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={desc} style={{ display: "block", overflow: "visible" }}>
      {yticks.map((v) => (
        <g key={v}>
          <line x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
          <text x={m.left - font * 0.5} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={font * 0.92} fill={CHART.muted} className="num">
            {v === 0 ? "0" : signed(v, 0)}
          </text>
        </g>
      ))}
      {xticks.map((d) => (
        <text key={d.toISOString()} x={x(d)} y={height - font * 0.6} textAnchor="middle" fontSize={font * 0.92} fill={CHART.muted}>
          {monthDay(d.toISOString().slice(0, 10))}
        </text>
      ))}
      {series
        .filter((s) => !s.highlight)
        .map((s) => (
          <path key={s.code} d={path(s.points) ?? ""} fill="none" stroke={CHART.axis} strokeWidth={Math.max(1, font * 0.09)} strokeLinejoin="round">
            <title>{`${s.code}: ${signed(s.points[s.points.length - 1]?.v)}`}</title>
          </path>
        ))}
      {hi.map((s) => (
        <g key={s.code}>
          <path d={path(s.points) ?? ""} fill="none" stroke={s.color} strokeWidth={Math.max(2, font * 0.2)} strokeLinejoin="round" strokeLinecap="round" />
          {s.points.map((p) => (
            <circle key={p.d} cx={x(day(p.d))} cy={y(p.v)} r={Math.max(5, font * 0.45)} fill="transparent">
              <title>{`${s.code}, ${monthDay(p.d)}: ${signed(p.v)}`}</title>
            </circle>
          ))}
        </g>
      ))}
      {ends.map((e) => (
        <g key={e.s.code}>
          <circle cx={e.x} cy={y(e.v)} r={Math.max(3.5, font * 0.32)} fill={e.s.color} stroke={surface} strokeWidth={2} />
          <text x={e.x + font * 0.8} y={e.y} dominantBaseline="middle" fontSize={font} fontWeight={700} fill={CHART.ink} className="num">
            {e.s.code} {signed(e.v)}
          </text>
        </g>
      ))}
    </svg>
  );
}
