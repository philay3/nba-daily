import { area, curveStepAfter, line, scaleLinear } from "d3";

import { CHART } from "@/lib/colors";
import { gameSeconds, momentText, periodLabel, periodStart } from "@/lib/flow";

export type FlowRun = { side: "away" | "home"; team: string; pts: number; start_t: number; end_t: number };

type Point = { t: number; m: number; a: number; h: number };

type Props = {
  away: string;
  home: string;
  /** elapsed seconds and both scores after every scoring play */
  t: number[];
  awayScores: number[];
  homeScores: number[];
  periods: number;
  awayColor: string;
  homeColor: string;
  /** scoring runs to mark along the top; the biggest get a label */
  runs?: FlowRun[];
  labelRuns?: number;
  width?: number;
  height?: number;
  font?: number;
  surface?: string;
  title?: string;
};

/**
 * The "worm": score margin after every scoring play, as a step line. Above the center line the road team leads,
 * below it the home team; each side's area is washed in that team's color. Scoring runs sit on a track above the
 * chart. Every basket has a native tooltip with the clock and the score.
 */
export function GameFlowChart({
  away,
  home,
  t,
  awayScores,
  homeScores,
  periods,
  awayColor,
  homeColor,
  runs = [],
  labelRuns = 3,
  width = 720,
  height = 260,
  font = 12,
  surface = CHART.surface,
  title,
}: Props) {
  if (!t.length) return null;
  const end = gameSeconds(periods);
  const pts: Point[] = [{ t: 0, m: 0, a: 0, h: 0 }, ...t.map((x, i) => ({ t: x, m: awayScores[i] - homeScores[i], a: awayScores[i], h: homeScores[i] }))];
  const last = pts[pts.length - 1];
  const series = [...pts, { ...last, t: end }];
  const endLabel = last.m === 0 ? "Tied" : `${last.m > 0 ? away : home} +${Math.abs(last.m)}`;
  // side keys (team code with its stripe) sit at the far left, the margin labels between them and the plot
  const keyW = Math.max(away.length, home.length) * font * 0.62 + 7;
  const left = Math.round(keyW + font * 2.2);
  const right = Math.round(endLabel.length * font * 0.62 + font);
  const track = runs.length ? Math.round(font * 2.4) : 0;
  const top = track + Math.round(font * 0.8);
  const bottom = Math.round(font * 2);
  const maxAbs = Math.max(5, ...pts.map((p) => Math.abs(p.m)));
  const x = scaleLinear([0, end], [left, width - right]);
  const y = scaleLinear([-maxAbs, maxAbs], [height - bottom, top]).nice();
  const y0 = y(0);
  const ticks = y.ticks(4).filter((v) => v !== 0);
  const path = line<Point>()
    .x((p) => x(p.t))
    .y((p) => y(p.m))
    .curve(curveStepAfter)(series) ?? "";
  const fill = area<Point>()
    .x((p) => x(p.t))
    .y0(y0)
    .y1((p) => y(p.m))
    .curve(curveStepAfter)(series) ?? "";
  const id = `worm-${away}-${home}-${width}x${height}-${t.length}`.replace(/[^a-zA-Z0-9-]/g, "");
  const color = (side: "away" | "home") => (side === "away" ? awayColor : homeColor);

  // run labels: biggest first, skipping any that would overlap one already placed
  const placed: [number, number][] = [];
  const labels = new Map<FlowRun, number>();
  for (const r of [...runs].sort((a, b) => b.pts - a.pts || a.start_t - b.start_t).slice(0, labelRuns)) {
    const cx = (x(r.start_t) + x(r.end_t)) / 2;
    const w = `${r.team} ${r.pts}-0`.length * font * 0.6;
    const span: [number, number] = [cx - w / 2, cx + w / 2];
    if (span[0] < 0 || span[1] > width) continue;
    if (placed.some(([a, b]) => span[0] < b + font * 0.5 && span[1] > a - font * 0.5)) continue;
    placed.push(span);
    labels.set(r, cx);
  }
  const desc = `Score margin after every scoring play, ${away} at ${home}. Final ${away} ${last.a}, ${home} ${last.h}.`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title ?? desc} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <clipPath id={`${id}-up`}>
          <rect x={0} y={0} width={width} height={y0} />
        </clipPath>
        <clipPath id={`${id}-down`}>
          <rect x={0} y={y0} width={width} height={height - y0} />
        </clipPath>
      </defs>
      {/* gridlines and margin labels (how far ahead, read against the side keys) */}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke={CHART.grid} strokeWidth={1} />
          <text x={left - font * 0.4} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={font * 0.92} fill={CHART.muted} className="num">
            {Math.abs(v)}
          </text>
        </g>
      ))}
      {/* periods */}
      {Array.from({ length: periods }, (_, i) => i + 1).map((p) => {
        const x0 = x(periodStart(p));
        const x1 = x(p < periods ? periodStart(p + 1) : end);
        return (
          <g key={p}>
            {p > 1 ? <line x1={x0} x2={x0} y1={top} y2={height - bottom} stroke={CHART.axis} strokeWidth={1} strokeDasharray="3 4" /> : null}
            <text x={(x0 + x1) / 2} y={height - font * 0.45} textAnchor="middle" fontSize={font} fill={CHART.muted}>
              {periodLabel(p)}
            </text>
          </g>
        );
      })}
      <path d={fill} fill={awayColor} opacity={0.2} clipPath={`url(#${id}-up)`} />
      <path d={fill} fill={homeColor} opacity={0.2} clipPath={`url(#${id}-down)`} />
      <line x1={left} x2={width - right} y1={y0} y2={y0} stroke={CHART.axis} strokeWidth={1} />
      <path d={path} fill="none" stroke={CHART.ink2} strokeWidth={Math.max(1.5, font * 0.14)} strokeLinejoin="round" />
      {/* side keys: who leads above and below the line */}
      <g fontSize={font} fill={CHART.ink2} fontWeight={600}>
        <rect x={0} y={top + 1} width={3} height={font} rx={1} fill={awayColor} />
        <text x={7} y={top + font * 0.9}>{away}</text>
        <rect x={0} y={height - bottom - font - 1} width={3} height={font} rx={1} fill={homeColor} />
        <text x={7} y={height - bottom - font * 0.15}>{home}</text>
      </g>
      {/* scoring runs along the top */}
      {runs.map((r, i) => {
        const x0 = x(r.start_t);
        const w = Math.max(3, x(r.end_t) - x0);
        const cx = labels.get(r);
        return (
          <g key={`${r.start_t}-${i}`}>
            <rect x={x0} y={track - font * 0.7} width={w} height={font * 0.5} rx={font * 0.15} fill={color(r.side)}>
              <title>{`${r.team} ${r.pts}-0 run, ${momentText(r.start_t, periods)} to ${momentText(r.end_t, periods)}`}</title>
            </rect>
            {cx !== undefined ? (
              <text x={cx} y={track - font * 1.05} textAnchor="middle" fontSize={font * 0.92} fontWeight={600} fill={CHART.ink2} className="num">
                {r.team} {r.pts}-0
              </text>
            ) : null}
          </g>
        );
      })}
      {/* every basket: a point to hover */}
      {pts.slice(1).map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.m)} r={Math.max(5, font * 0.45)} fill="transparent">
          <title>{`${momentText(p.t, periods)}: ${away} ${p.a}, ${home} ${p.h} (${p.m === 0 ? "tied" : `${p.m > 0 ? away : home} by ${Math.abs(p.m)}`})`}</title>
        </circle>
      ))}
      <circle cx={x(end)} cy={y(last.m)} r={Math.max(3.5, font * 0.32)} fill={last.m > 0 ? awayColor : last.m < 0 ? homeColor : CHART.muted} stroke={surface} strokeWidth={2} />
      <text x={x(end) + font * 0.7} y={y(last.m)} dominantBaseline="middle" fontSize={font} fontWeight={700} fill={CHART.ink}>
        {endLabel}
      </text>
    </svg>
  );
}
