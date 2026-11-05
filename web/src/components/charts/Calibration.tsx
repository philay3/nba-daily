import { scaleLinear, scaleSqrt } from "d3";

import { CHART } from "@/lib/colors";

export type CalBin = { lo: number; hi: number; games: number; mean_wp: number | null; win_pct: number | null };

type Props = { bins: CalBin[]; width?: number; height?: number; font?: number; color?: string };

/**
 * Calibration: the favorite's predicted win chance across, how often favorites in that bin won up. Points on the
 * diagonal mean the chances were right. Each point is sized by its number of games, which is printed beside it.
 */
export function CalibrationChart({ bins, width = 520, height = 420, font = 12, color = CHART.plus }: Props) {
  const pts = bins.filter((b) => b.games > 0 && b.mean_wp !== null && b.win_pct !== null);
  const m = { top: font * 1.2, right: font * 1.5, bottom: font * 3.6, left: font * 4 };
  const x = scaleLinear([50, 100], [m.left, width - m.right]);
  const lowest = Math.min(40, ...pts.map((p) => p.win_pct! - 5));
  const y = scaleLinear([Math.floor(lowest / 10) * 10, 100], [height - m.bottom, m.top]);
  const r = scaleSqrt([0, Math.max(1, ...pts.map((p) => p.games))], [0, font * 1.4]);
  const xt = [50, 60, 70, 80, 90, 100];
  const yt = y.ticks(6);
  const desc = `Predicted win chance against how often the favorite won, in ${pts.length} bins: ${pts
    .map((p) => `${p.lo} to ${p.hi}%: predicted ${p.mean_wp}%, won ${p.win_pct}% of ${p.games} games`)
    .join("; ")}.`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={desc} style={{ display: "block", overflow: "visible" }}>
      {yt.map((v) => (
        <g key={v}>
          <line x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} stroke={CHART.grid} />
          <text x={m.left - font * 0.5} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={font * 0.92} fill={CHART.muted} className="num">
            {v}%
          </text>
        </g>
      ))}
      {xt.map((v) => (
        <text key={v} x={x(v)} y={height - m.bottom + font * 1.4} textAnchor="middle" fontSize={font * 0.92} fill={CHART.muted} className="num">
          {v}%
        </text>
      ))}
      <text x={(m.left + width - m.right) / 2} y={height - font * 0.4} textAnchor="middle" fontSize={font} fill={CHART.ink2}>
        Model win chance for the favorite
      </text>
      <text transform={`translate(${font * 0.9} ${(m.top + height - m.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={font} fill={CHART.ink2}>
        Favorites who won
      </text>
      <line x1={x(50)} y1={y(50)} x2={x(100)} y2={y(100)} stroke={CHART.muted} strokeDasharray="4 5" />
      <text x={x(97)} y={y(97) - font * 0.6} textAnchor="end" fontSize={font * 0.92} fill={CHART.muted}>
        Right on
      </text>
      {pts.map((p) => (
        <g key={p.lo}>
          <line x1={x(p.mean_wp!)} x2={x(p.mean_wp!)} y1={y(p.mean_wp!)} y2={y(p.win_pct!)} stroke={color} strokeOpacity={0.5} strokeWidth={2} />
          <circle cx={x(p.mean_wp!)} cy={y(p.win_pct!)} r={Math.max(font * 0.35, r(p.games))} fill={color} fillOpacity={0.85} stroke={CHART.surface} strokeWidth={1.5}>
            <title>{`${p.lo} to ${p.hi}%: predicted ${p.mean_wp}%, favorites won ${p.win_pct}% (${p.games} games)`}</title>
          </circle>
          <text x={x(p.mean_wp!) + Math.max(font * 0.35, r(p.games)) + font * 0.4} y={y(p.win_pct!)} dominantBaseline="middle" fontSize={font * 0.92} fill={CHART.ink2} className="num">
            {p.games} games
          </text>
        </g>
      ))}
    </svg>
  );
}
