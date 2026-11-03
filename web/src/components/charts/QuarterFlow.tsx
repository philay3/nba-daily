import { area, line, scaleLinear } from "d3";

import { CHART } from "@/lib/colors";

export type FlowPoint = { q: number; label: string; away: number; home: number; margin: number };

export function flowPoints(awayPeriods: number[], homePeriods: number[]): FlowPoint[] {
  const pts: FlowPoint[] = [{ q: 0, label: "Start", away: 0, home: 0, margin: 0 }];
  let a = 0;
  let h = 0;
  awayPeriods.forEach((pa, i) => {
    a += pa;
    h += homePeriods[i] ?? 0;
    pts.push({ q: i + 1, label: i < 4 ? `Q${i + 1}` : i === 4 ? "OT" : `${i - 3}OT`, away: a, home: h, margin: a - h });
  });
  return pts;
}

type Props = {
  away: string;
  home: string;
  awayPeriods: number[];
  homePeriods: number[];
  awayColor: string;
  homeColor: string;
  width?: number;
  height?: number;
  font?: number;
  surface?: string;
  title?: string;
};

/**
 * Score margin after each period. Above the center line the road team leads, below it the home team;
 * each side's area is washed in that team's color. Every point has a native tooltip.
 */
export function QuarterFlow({
  away,
  home,
  awayPeriods,
  homePeriods,
  awayColor,
  homeColor,
  width = 360,
  height = 120,
  font = 11,
  surface = CHART.surface,
  title,
}: Props) {
  const pts = flowPoints(awayPeriods, homePeriods);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const left = Math.round(font * 3.4);
  const endLabel = last.margin === 0 ? "Tied" : `${last.margin > 0 ? away : home} +${Math.abs(last.margin)}`;
  const right = Math.round(endLabel.length * font * 0.62 + font);
  const top = Math.round(font * 0.8);
  const bottom = Math.round(font * 2);
  const maxAbs = Math.max(5, ...pts.map((p) => Math.abs(p.margin)));
  const x = scaleLinear([0, pts.length - 1], [left, width - right]);
  const y = scaleLinear([-maxAbs, maxAbs], [height - bottom, top]).nice();
  const y0 = y(0);
  const path = line<FlowPoint>()
    .x((p) => x(p.q))
    .y((p) => y(p.margin))(pts) ?? "";
  const fill = area<FlowPoint>()
    .x((p) => x(p.q))
    .y0(y0)
    .y1((p) => y(p.margin))(pts) ?? "";
  const id = `flow-${away}-${home}-${awayPeriods.join("")}-${homePeriods.join("")}`.replace(/[^a-zA-Z0-9-]/g, "");
  const lead = (m: number) => (m > 0 ? awayColor : m < 0 ? homeColor : CHART.muted);
  const desc = pts
    .slice(1)
    .map((p) => `${p.label}: ${away} ${p.away}, ${home} ${p.home}`)
    .join("; ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title ?? `Score margin after each quarter, ${away} at ${home}. ${desc}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <clipPath id={`${id}-up`}>
          <rect x={0} y={0} width={width} height={y0} />
        </clipPath>
        <clipPath id={`${id}-down`}>
          <rect x={0} y={y0} width={width} height={height - y0} />
        </clipPath>
      </defs>
      <path d={fill} fill={awayColor} opacity={0.16} clipPath={`url(#${id}-up)`} />
      <path d={fill} fill={homeColor} opacity={0.16} clipPath={`url(#${id}-down)`} />
      <line x1={left} x2={width - right} y1={y0} y2={y0} stroke={CHART.axis} strokeWidth={1} />
      {/* side keys: who leads above and below the line */}
      <g fontSize={font} fill={CHART.ink2} fontWeight={600}>
        <rect x={0} y={top + 1} width={3} height={font} rx={1} fill={awayColor} />
        <text x={7} y={top + font * 0.9}>{away}</text>
        <rect x={0} y={height - bottom - font - 1} width={3} height={font} rx={1} fill={homeColor} />
        <text x={7} y={height - bottom - font * 0.15}>{home}</text>
      </g>
      <path d={path} fill="none" stroke={CHART.ink2} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => (
        <g key={p.q}>
          <circle cx={x(p.q)} cy={y(p.margin)} r={Math.max(4, font * 0.38)} fill={lead(p.margin)} stroke={surface} strokeWidth={2} />
          <circle cx={x(p.q)} cy={y(p.margin)} r={12} fill="transparent">
            <title>
              {p.q === 0
                ? "Tip-off"
                : `After ${p.label}: ${away} ${p.away}, ${home} ${p.home} (${p.margin === 0 ? "tied" : `${p.margin > 0 ? away : home} by ${Math.abs(p.margin)}`})`}
            </title>
          </circle>
          {p.q > 0 ? (
            <text x={x(p.q)} y={height - font * 0.35} textAnchor="middle" fontSize={font} fill={CHART.muted}>
              {p.label}
            </text>
          ) : null}
        </g>
      ))}
      <text x={x(last.q) + font * 0.8} y={y(last.margin)} dominantBaseline="middle" fontSize={font} fontWeight={700} fill={CHART.ink}>
        {endLabel}
      </text>
    </svg>
  );
}
