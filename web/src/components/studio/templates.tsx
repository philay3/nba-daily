/**
 * Studio frames: fixed-size broadcast graphics rendered from database rows.
 * Pure components (no hooks), so the same code renders in the editor preview, in the
 * full-size /studio/frame route and in the PNG export.
 */
import { Columns } from "@/components/charts/Bars";
import { GameFlowChart } from "@/components/charts/GameFlow";
import { OffDefScatter, type ScatterTeam } from "@/components/charts/OffDefScatter";
import { QuarterFlow } from "@/components/charts/QuarterFlow";
import { ShotChart } from "@/components/charts/ShotChart";
import { duration } from "@/lib/flow";
import { f1, longDate, monthDay, ordinal, signed } from "@/lib/format";
import { COURT, ZONE_LABEL, type ZoneKey } from "@/lib/shots";
import { atsWord, edgeText, lineText, winChances } from "@/lib/model";
import { STAT_LABEL, statText } from "@/lib/stories";
import type { ModelSide, SizeKey, StudioFlow, StudioMatchup, StudioModel, StudioPlayerLine, StudioRecap, StudioShotChart, StudioStory, StudioTeam } from "@/lib/studio-types";
import { SIZES } from "@/lib/studio-types";

const C = {
  bgTop: "#10203a",
  bgBottom: "#0a1422",
  panel: "rgba(16, 31, 51, 0.82)",
  line: "#21395a",
  ink: "#edf2f8",
  ink2: "#b6c3d6",
  muted: "#8293ab",
  clock: "#ffb627",
  plus: "#3d9be9",
  minus: "#e8683f",
  surface: "#0d1a2c",
};
const DISPLAY = '"Big Shoulders Display Variable", "Arial Narrow", sans-serif';
const SANS = '"Archivo Variable", system-ui, sans-serif';
const SOURCE = "Data: ESPN via hoopR";

const fit = (text: string, width: number, max: number, ratio = 0.47) => Math.min(max, Math.floor(width / Math.max(1, text.length * ratio)));
const MISSING_TEAM: StudioTeam = { code: "", name: "", nickname: "", conference: "", primary: "#2d4a70", secondary: "#8293ab", accent: "#8293ab" };

/* ------------------------------------------------------------------ frame */

function CourtLines({ w, h, landscape }: { w: number; h: number; landscape: boolean }) {
  // half court, 50 ft wide, drawn at the bottom (portrait) or right edge (landscape) as quiet texture
  const s = landscape ? h / 50 : w / 50;
  const oy = landscape ? 0 : h - 30 * s;
  const stroke = "rgba(237, 242, 248, 0.055)";
  if (landscape) {
    // rotated: baseline on the right edge
    const bx = w;
    const cy = h / 2;
    const r3 = 23.75 * s;
    return (
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }} aria-hidden>
        <g fill="none" stroke={stroke} strokeWidth={3}>
          <rect x={bx - 19 * s} y={cy - 8 * s} width={19 * s} height={16 * s} />
          <circle cx={bx - 19 * s} cy={cy} r={6 * s} />
          <path d={`M ${bx} ${cy - 22 * s} H ${bx - 14 * s} A ${r3} ${r3} 0 0 0 ${bx - 14 * s} ${cy + 22 * s} H ${bx}`} />
          <path d={`M ${bx - 4 * s - 5.25 * s} ${cy - 4 * s} A ${4 * s} ${4 * s} 0 0 0 ${bx - 4 * s - 5.25 * s} ${cy + 4 * s}`} />
        </g>
      </svg>
    );
  }
  const cx = w / 2;
  const by = oy + 30 * s;
  const r3 = 23.75 * s;
  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0 }} aria-hidden>
      <g fill="none" stroke={stroke} strokeWidth={3}>
        <rect x={cx - 8 * s} y={by - 19 * s} width={16 * s} height={19 * s} />
        <circle cx={cx} cy={by - 19 * s} r={6 * s} />
        <path d={`M ${cx - 22 * s} ${by} V ${by - 14 * s} A ${r3} ${r3} 0 0 1 ${cx + 22 * s} ${by - 14 * s} V ${by}`} />
        <path d={`M ${cx - 4 * s} ${by - 5.25 * s} A ${4 * s} ${4 * s} 0 0 1 ${cx + 4 * s} ${by - 5.25 * s}`} />
      </g>
    </svg>
  );
}

function Frame({
  size,
  handle,
  bands,
  children,
  stamp,
  texture = true,
}: {
  size: SizeKey;
  handle: string;
  bands: StudioTeam[];
  children: React.ReactNode;
  stamp: string;
  /** the faint court drawn behind every frame; off when the graphic is a court itself */
  texture?: boolean;
}) {
  const { w, h } = SIZES[size];
  const landscape = w > h;
  const u = landscape ? h / 1080 : w / 1080;
  const foot = Math.round(104 * u);
  return (
    <div
      data-frame={size}
      style={{
        width: w,
        height: h,
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 72%)`,
        color: C.ink,
        fontFamily: SANS,
        fontVariantNumeric: "lining-nums",
      }}
    >
      {texture ? <CourtLines w={w} h={h} landscape={landscape} /> : null}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: Math.round(16 * u), display: "flex" }}>
        {bands.map((t, i) => (
          <div key={i} style={{ flex: 1, display: "grid", gridTemplateRows: "1fr auto" }}>
            <div style={{ background: t.primary }} />
            <div style={{ height: Math.round(5 * u), background: t.secondary }} />
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: Math.round(16 * u), bottom: foot }}>{children}</div>
      <div
        style={{
          position: "absolute",
          left: Math.round(72 * u),
          right: Math.round(72 * u),
          bottom: 0,
          height: foot,
          borderTop: `2px solid ${C.line}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24 * u,
        }}
      >
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 44 * u, letterSpacing: "0.01em", color: C.ink }}>{handle}</span>
        <span style={{ fontSize: 22 * u, color: C.muted, textAlign: "right" }}>
          {stamp}
          <br />
          {SOURCE}
        </span>
      </div>
    </div>
  );
}

function Label({ children, u }: { children: React.ReactNode; u: number }) {
  return <div style={{ fontFamily: DISPLAY, fontWeight: 750, fontSize: 36 * u, color: C.clock, letterSpacing: "0.01em" }}>{children}</div>;
}

function Arrow({ d, u, threshold }: { d: number | null; u: number; threshold: number }) {
  if (d === null || Math.abs(d) < threshold) return null;
  return <span style={{ color: d > 0 ? C.plus : C.minus, fontSize: 26 * u, marginLeft: 8 * u }}>{d > 0 ? "▲" : "▼"}</span>;
}

function PmMeter({ pm, u, width }: { pm: number | null; u: number; width: number }) {
  const v = pm ?? 0;
  const max = Math.max(20, Math.abs(v));
  const half = width / 2;
  const len = (Math.abs(v) / max) * half;
  return (
    <div style={{ position: "relative", width, height: 18 * u }}>
      <div style={{ position: "absolute", left: half - 1, top: -6 * u, bottom: -6 * u, width: 2, background: C.muted }} />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: v >= 0 ? half + 2 : half - 2 - len,
          width: len,
          background: v >= 0 ? C.plus : C.minus,
          borderRadius: v >= 0 ? `0 ${6 * u}px ${6 * u}px 0` : `${6 * u}px 0 0 ${6 * u}px`,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ 1. player game card */

export function PlayerCard({ line, teams, size, handle }: { line: StudioPlayerLine; teams: Record<string, StudioTeam>; size: SizeKey; handle: string }) {
  const { w, h } = SIZES[size];
  const landscape = w > h;
  const story = size === "story";
  const u = landscape ? h / 1080 : w / 1080;
  const pad = 72 * u;
  const team = teams[line.team] ?? MISSING_TEAM;
  const opp = teams[line.opp] ?? MISSING_TEAM;
  const parts = line.name.split(" ");
  const first = parts.length > 1 ? parts[0] : "";
  const last = parts.length > 1 ? parts.slice(1).join(" ") : line.name;
  const nameWidth = landscape ? 860 * u : w - pad * 2;
  const lastSize = fit(last, nameWidth, landscape ? 190 * u : story ? 190 * u : 170 * u, 0.45);
  const result = `${line.team} ${line.won ? "beat" : "lost to"} ${line.opp} ${Math.max(line.team_score, line.opp_score)}-${Math.min(line.team_score, line.opp_score)}`;
  const fgPct = line.fga ? ((100 * line.fgm) / line.fga).toFixed(1) : "0.0";

  const head = (
    <div style={{ display: "grid", gap: 10 * u }}>
      <Label u={u}>{result}</Label>
      <div style={{ fontSize: 26 * u, color: C.ink2 }}>
        {longDate(line.date)}, {line.home ? "at home" : `at ${opp.nickname || line.opp}`}, {line.min} minutes
      </div>
    </div>
  );
  const name = (
    <div style={{ display: "flex", alignItems: "stretch", gap: 24 * u }}>
      <div style={{ width: 14 * u, background: team.accent, borderRadius: 3 * u }} />
      <div style={{ display: "grid" }}>
        {first ? <div style={{ fontSize: 46 * u, fontWeight: 600, color: C.ink2, lineHeight: 1.1 }}>{first}</div> : null}
        <div style={{ fontFamily: DISPLAY, fontWeight: 850, fontSize: lastSize, lineHeight: 0.88, letterSpacing: "0.005em" }}>{last}</div>
        <div style={{ fontSize: 26 * u, color: C.muted, marginTop: 8 * u }}>{team.name}</div>
      </div>
    </div>
  );
  const big = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 * u }}>
      {(
        [
          ["Points", line.pts, line.d_pts, 8],
          ["Rebounds", line.reb, line.d_reb, 5],
          ["Assists", line.ast, line.d_ast, 4],
        ] as const
      ).map(([label, v, d, th]) => (
        <div key={label} style={{ display: "grid", gap: 6 * u }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 850, fontSize: (story ? 250 : landscape ? 230 : 196) * u, lineHeight: 0.82 }}>{v}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 * u }}>
            <div style={{ width: 36 * u, height: 6 * u, background: team.accent, borderRadius: 2 }} />
            <span style={{ fontSize: 28 * u, color: C.ink2, fontWeight: 600 }}>{label}</span>
            <Arrow d={d} u={u} threshold={th} />
          </div>
        </div>
      ))}
    </div>
  );
  const splits = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 * u, borderTop: `2px solid ${C.line}`, paddingTop: 24 * u }}>
      {(
        [
          ["Field goals", `${line.fgm}-${line.fga}`, `${fgPct}%`],
          ["Threes", `${line.tpm}-${line.tpa}`, line.tpa ? `${((100 * line.tpm) / line.tpa).toFixed(1)}%` : ""],
          ["Free throws", `${line.ftm}-${line.fta}`, line.fta ? `${((100 * line.ftm) / line.fta).toFixed(1)}%` : ""],
          ["True shooting", line.ts_pct != null ? line.ts_pct.toFixed(1) : "–", "%"],
        ] as const
      ).map(([label, v, sub]) => (
        <div key={label} style={{ display: "grid", gap: 4 * u, alignContent: "start" }}>
          <span style={{ fontSize: 22 * u, color: C.muted, whiteSpace: "nowrap" }}>{label}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: (landscape ? 58 : 64) * u, lineHeight: 1, whiteSpace: "nowrap" }}>
            {v}
            {landscape ? null : <span style={{ fontFamily: SANS, fontWeight: 500, fontSize: 22 * u, color: C.ink2, marginLeft: 8 * u }}>{sub}</span>}
          </span>
          {landscape ? <span style={{ fontWeight: 500, fontSize: 22 * u, color: C.ink2 }}>{sub}</span> : null}
        </div>
      ))}
    </div>
  );
  const pm = (
    <div style={{ display: "flex", alignItems: "center", gap: 28 * u }}>
      <div style={{ display: "grid", gap: 4 * u }}>
        <span style={{ fontSize: 22 * u, color: C.muted }}>Plus-minus</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 850, fontSize: 84 * u, lineHeight: 0.9 }}>{signed(line.pm, 0)}</span>
      </div>
      <PmMeter pm={line.pm} u={u} width={300 * u} />
      <div style={{ display: "grid", gap: 4 * u, marginLeft: "auto", textAlign: "right" }}>
        <span style={{ fontSize: 22 * u, color: C.muted }}>Steals, blocks, turnovers</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 56 * u, lineHeight: 1 }}>
          {line.stl} / {line.blk} / {line.tov}
        </span>
      </div>
    </div>
  );
  const deltas = line.gp_before ? (
    <div style={{ display: "grid", gap: 14 * u }}>
      <span style={{ fontSize: 24 * u, color: C.ink2 }}>Against his average before this game ({line.gp_before} games)</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 * u }}>
        {(
          [
            ["PTS", line.d_pts, line.avg_pts],
            ["REB", line.d_reb, line.avg_reb],
            ["AST", line.d_ast, line.avg_ast],
          ] as const
        ).map(([k, d, avg]) => (
          <div key={k} style={{ border: `2px solid ${C.line}`, borderRadius: 10 * u, padding: `${10 * u}px ${18 * u}px`, display: "flex", alignItems: "baseline", gap: 12 * u, background: C.panel }}>
            <span style={{ fontSize: 24 * u, color: C.muted, fontWeight: 600 }}>{k}</span>
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 50 * u, color: C.ink }}>{signed(d)}</span>
            <span style={{ fontSize: 20 * u, color: C.muted }}>avg {avg?.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  ) : (
    <div style={{ fontSize: 26 * u, color: C.ink2 }}>First game of his season.</div>
  );
  // the deltas and plus-minus have their own blocks; chips keep the rest (double-double, season high, threes, minutes)
  const flags = line.flags.filter((f) => !/^(PTS|REB|AST|\+\/-)/.test(f)).slice(0, size === "feed" ? 3 : 4);
  const chips = flags.length ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 * u }}>
      {flags.map((f) => (
        <span key={f} style={{ border: `2px solid ${C.clock}`, color: C.ink, borderRadius: 999, padding: `${6 * u}px ${20 * u}px`, fontSize: 24 * u, fontWeight: 600 }}>
          {f}
        </span>
      ))}
    </div>
  ) : null;
  const trend =
    line.trend.length > 1 ? (
      <div style={{ display: "grid", gap: 8 * u }}>
        <span style={{ fontSize: 24 * u, color: C.ink2 }}>Points in every game this season</span>
        <Columns
          width={landscape ? 900 : w - pad * 2}
          height={(landscape ? 300 : 340) * u}
          font={20 * u}
          color={team.accent}
          points={line.trend.map((t) => ({ key: t.date, label: monthDay(t.date), value: t.pts, title: `${monthDay(t.date)}: ${t.pts}` }))}
          avg={line.season?.ppg ?? null}
          avgLabel={`Avg ${line.season?.ppg?.toFixed(1) ?? ""}`}
        />
      </div>
    ) : null;

  const stamp = `${monthDay(line.date)} ${line.team} vs ${line.opp}`;
  if (landscape) {
    return (
      <Frame size={size} handle={handle} bands={[team]} stamp={stamp}>
        <div style={{ position: "absolute", inset: `${56 * u}px ${pad}px ${32 * u}px`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64 * u }}>
          <div style={{ display: "grid", alignContent: "space-between" }}>
            {head}
            {name}
            {big}
          </div>
          <div style={{ display: "grid", alignContent: "space-between", gap: 24 * u }}>
            {splits}
            {pm}
            {deltas}
            {trend ?? chips}
          </div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame size={size} handle={handle} bands={[team]} stamp={stamp}>
      <div style={{ position: "absolute", inset: `${60 * u}px ${pad}px ${36 * u}px`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 24 * u }}>
        {head}
        {name}
        {big}
        {splits}
        {pm}
        {deltas}
        {story ? trend : null}
        {chips}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 2. matchup preview */

function TapeRow({
  label,
  a,
  h,
  aRank,
  hRank,
  aText,
  hText,
  aColor,
  hColor,
  u,
  half,
}: {
  label: string;
  a: number | null;
  h: number | null;
  aRank: number | null;
  hRank: number | null;
  aText: string;
  hText: string;
  aColor: string;
  hColor: string;
  u: number;
  half: number;
}) {
  const len = (rk: number | null) => (rk ? ((31 - rk) / 30) * half : 0);
  const aBetter = aRank !== null && hRank !== null && aRank < hRank;
  const hBetter = aRank !== null && hRank !== null && hRank < aRank;
  void a;
  void h;
  return (
    <div style={{ display: "grid", gap: 10 * u }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "baseline", gap: 16 * u }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 56 * u, color: aBetter ? C.ink : C.ink2 }}>
          {aText} <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 24 * u, color: C.muted }}>{ordinal(aRank)}</span>
        </span>
        <span style={{ fontSize: 26 * u, color: C.ink2, fontWeight: 600, textAlign: "center" }}>{label}</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 56 * u, color: hBetter ? C.ink : C.ink2, textAlign: "right" }}>
          <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 24 * u, color: C.muted }}>{ordinal(hRank)}</span> {hText}
        </span>
      </div>
      <div style={{ position: "relative", height: 18 * u }}>
        <div style={{ position: "absolute", left: "50%", top: -6 * u, bottom: -6 * u, width: 2, marginLeft: -1, background: C.muted }} />
        <div style={{ position: "absolute", right: "50%", marginRight: 4 * u, top: 0, bottom: 0, width: len(aRank), background: aColor, borderRadius: `${6 * u}px 0 0 ${6 * u}px`, opacity: aBetter ? 1 : 0.55 }} />
        <div style={{ position: "absolute", left: "50%", marginLeft: 4 * u, top: 0, bottom: 0, width: len(hRank), background: hColor, borderRadius: `0 ${6 * u}px ${6 * u}px 0`, opacity: hBetter ? 1 : 0.55 }} />
      </div>
    </div>
  );
}

export function MatchupCard({ m, teams, size, handle }: { m: StudioMatchup; teams: Record<string, StudioTeam>; size: SizeKey; handle: string }) {
  const { w, h } = SIZES[size];
  const landscape = w > h;
  const story = size === "story";
  const u = landscape ? h / 1080 : w / 1080;
  const pad = 72 * u;
  const A = teams[m.away] ?? MISSING_TEAM;
  const H = teams[m.home] ?? MISSING_TEAM;
  const a = m.sides[m.away];
  const hm = m.sides[m.home];
  const half = ((landscape ? 1100 * u : w - pad * 2) - 8 * u) / 2;
  const rows: [string, keyof typeof a, keyof typeof a, boolean][] = [
    ["Net rating", "net", "net_rk", true],
    ["Offensive rating", "ortg", "ortg_rk", false],
    ["Defensive rating", "drtg", "drtg_rk", false],
    ...(story ? ([["Net, last 5 games", "l5_net", "l5_net_rk", true]] as [string, keyof typeof a, keyof typeof a, boolean][]) : []),
    ...(story ? ([["Effective FG %", "efg", "efg_rk", false], ["Opponent effective FG %", "opp_efg", "opp_efg_rk", false]] as [string, keyof typeof a, keyof typeof a, boolean][]) : []),
  ];
  const txt = (v: unknown, sgn: boolean) => (typeof v === "number" ? (sgn ? signed(v) : v.toFixed(1)) : "–");
  const teamBlock = (t: StudioTeam, code: string, s: typeof a, right: boolean) => (
    <div style={{ display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "center", gap: 24 * u, textAlign: right ? "right" : "left" }}>
      <div style={{ width: 16 * u, alignSelf: "stretch", background: t.accent, borderRadius: 3 * u }} />
      <div style={{ display: "grid", gap: 6 * u, justifyItems: right ? "end" : "start" }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: (landscape ? 150 : 190) * u, lineHeight: 0.8 }}>{code}</div>
        <div style={{ fontSize: 30 * u, fontWeight: 600 }}>{t.nickname}</div>
        <div style={{ fontSize: 26 * u, color: C.ink2 }}>
          {s.w}-{s.l}
          {s.rest === 0 ? ", back-to-back" : ""}
        </div>
      </div>
    </div>
  );
  const missingBlock = (code: string, s: typeof a, right: boolean) => (
    <div style={{ display: "grid", gap: 6 * u, textAlign: right ? "right" : "left" }}>
      <span style={{ fontSize: 22 * u, color: C.muted }}>Scoring listed out</span>
      <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 60 * u, lineHeight: 1 }}>
        {m.report ? s.missing_ppg.toFixed(1) : "–"} <span style={{ fontFamily: SANS, fontSize: 22 * u, color: C.ink2, fontWeight: 500 }}>PPG</span>
      </span>
      <span style={{ fontSize: 22 * u, color: C.ink2 }}>
        {!m.report ? "No injury report yet" : s.missing.length ? s.missing.slice(0, 2).map((x) => `${x.name} ${x.ppg?.toFixed(1)}`).join(", ") : `${code} nobody key listed out`}
      </span>
    </div>
  );
  const wp = m.away_wp != null && m.home_wp != null;
  const bottom = (
    <div style={{ display: "grid", gap: 16 * u, borderTop: `2px solid ${C.line}`, paddingTop: 24 * u }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 * u, fontSize: 30 * u }}>
        <span>
          <span style={{ color: C.muted, fontSize: 24 * u }}>Line </span>
          <span style={{ fontWeight: 700 }}>{m.line ?? "not posted"}</span>
        </span>
        {m.total != null ? (
          <span>
            <span style={{ color: C.muted, fontSize: 24 * u }}>Total </span>
            <span style={{ fontWeight: 700 }}>{m.total}</span>
          </span>
        ) : null}
        {wp ? (
          <span>
            <span style={{ color: C.muted, fontSize: 24 * u }}>Win odds </span>
            <span style={{ fontWeight: 700 }}>
              {m.away} {m.away_wp!.toFixed(1)}%, {m.home} {m.home_wp!.toFixed(1)}%
            </span>
          </span>
        ) : null}
      </div>
      {wp ? (
        <div style={{ display: "flex", height: 16 * u, gap: 4 * u }}>
          <div style={{ flexGrow: m.away_wp!, background: A.accent, borderRadius: `${8 * u}px 0 0 ${8 * u}px`, opacity: m.away_wp! >= m.home_wp! ? 1 : 0.45 }} />
          <div style={{ flexGrow: m.home_wp!, background: H.accent, borderRadius: `0 ${8 * u}px ${8 * u}px 0`, opacity: m.home_wp! > m.away_wp! ? 1 : 0.45 }} />
        </div>
      ) : null}
    </div>
  );
  const header = (
    <div style={{ display: landscape ? "flex" : "grid", justifyContent: "space-between", alignItems: "baseline", gap: 10 * u }}>
      <Label u={u}>{m.tag && m.tag !== "Game of the night" ? m.tag : "Matchup preview"}</Label>
      <div style={{ fontSize: 26 * u, color: C.ink2 }}>
        {longDate(m.date)}, {m.time_et} ET, {m.tv}
      </div>
    </div>
  );
  const tape = (
    <div style={{ display: "grid", gap: (story ? 40 : landscape ? 18 : 28) * u }}>
      {rows.map(([label, k, rk, sgn]) => (
        <TapeRow
          key={label}
          label={label}
          a={a[k] as number | null}
          h={hm[k] as number | null}
          aRank={a[rk] as number | null}
          hRank={hm[rk] as number | null}
          aText={txt(a[k], sgn)}
          hText={txt(hm[k], sgn)}
          aColor={A.accent}
          hColor={H.accent}
          u={u}
          half={half}
        />
      ))}
      <div style={{ fontSize: 20 * u, color: C.muted, textAlign: "center" }}>Bars show league rank: longer is better, out of 30</div>
    </div>
  );
  const stamp = `${monthDay(m.date)} ${m.away} at ${m.home}`;
  if (landscape) {
    return (
      <Frame size={size} handle={handle} bands={[A, H]} stamp={stamp}>
        <div style={{ position: "absolute", inset: `${48 * u}px ${pad}px ${24 * u}px`, display: "grid", gridTemplateRows: "auto auto 1fr auto", gap: 24 * u }}>
          {header}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 40 * u }}>
            {teamBlock(A, m.away, a, false)}
            <span style={{ fontFamily: DISPLAY, fontSize: 64 * u, color: C.muted, fontWeight: 700 }}>at</span>
            {teamBlock(H, m.home, hm, true)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `${300 * u}px 1fr ${300 * u}px`, alignItems: "center", gap: 40 * u }}>
            {missingBlock(m.away, a, false)}
            {tape}
            {missingBlock(m.home, hm, true)}
          </div>
          {bottom}
        </div>
      </Frame>
    );
  }
  return (
    <Frame size={size} handle={handle} bands={[A, H]} stamp={stamp}>
      <div style={{ position: "absolute", inset: `${56 * u}px ${pad}px ${32 * u}px`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 24 * u }}>
        {header}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 20 * u }}>
          {teamBlock(A, m.away, a, false)}
          <span style={{ fontFamily: DISPLAY, fontSize: 56 * u, color: C.muted, fontWeight: 700 }}>at</span>
          {teamBlock(H, m.home, hm, true)}
        </div>
        {tape}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 * u }}>
          {missingBlock(m.away, a, false)}
          {missingBlock(m.home, hm, true)}
        </div>
        {bottom}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 3. league offense vs defense */

export function LeagueChart({
  teams,
  league,
  highlight,
  size,
  handle,
  asOf,
}: {
  teams: Record<string, StudioTeam>;
  league: ScatterTeam[];
  highlight: string[];
  size: SizeKey;
  handle: string;
  asOf: string;
}) {
  const { w, h } = SIZES[size];
  const landscape = w > h;
  const u = landscape ? h / 1080 : w / 1080;
  const pad = 72 * u;
  const hi = highlight.filter((c) => league.some((t) => t.code === c)).slice(0, 2);
  const bands = hi.length ? hi.map((c) => teams[c] ?? MISSING_TEAM) : [{ ...MISSING_TEAM, primary: "#1f9e8a", secondary: "#9b6fe0" }];
  const chartW = landscape ? 1180 * u : w - pad * 2;
  const chartH = landscape ? 760 * u : size === "story" ? 1080 * u : 760 * u;
  const callouts = hi.map((c) => league.find((t) => t.code === c)!).filter(Boolean);
  const callout = (t: ScatterTeam) => (
    <div key={t.code} style={{ display: "flex", gap: 20 * u, alignItems: "stretch" }}>
      <div style={{ width: 12 * u, background: t.accent, borderRadius: 3 * u }} />
      <div style={{ display: "grid", gap: 6 * u }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 850, fontSize: 64 * u, lineHeight: 0.9 }}>
          {teams[t.code]?.nickname ?? t.code} <span style={{ fontFamily: SANS, fontSize: 26 * u, fontWeight: 600, color: C.ink2 }}>{t.w}-{t.l}</span>
        </div>
        <div style={{ fontSize: 26 * u, color: C.ink2 }}>
          Offense {t.ortg.toFixed(1)} ({ordinal(t.ortg_rk)}), defense {t.drtg.toFixed(1)} ({ordinal(t.drtg_rk)}), net {signed(t.net)}
        </div>
      </div>
    </div>
  );
  const title = (
    <div style={{ display: "grid", gap: 12 * u }}>
      <Label u={u}>League landscape</Label>
      <div style={{ fontFamily: DISPLAY, fontWeight: 850, fontSize: 96 * u, lineHeight: 0.9 }}>Offense vs defense</div>
      <div style={{ fontSize: 26 * u, color: C.ink2, maxWidth: 900 * u }}>
        Points scored and allowed per 100 possessions, every team through {monthDay(asOf)}. Up and right is good on both ends.
      </div>
    </div>
  );
  const chart = <OffDefScatter teams={league} mode={hi.length ? "highlight" : "conference"} highlight={hi} width={chartW} height={chartH} font={20 * u} dot={9 * u} surface={C.surface} />;
  if (landscape) {
    return (
      <Frame size={size} handle={handle} bands={bands} stamp={`Through ${monthDay(asOf)}`}>
        <div style={{ position: "absolute", inset: `${52 * u}px ${pad}px ${28 * u}px`, display: "grid", gridTemplateColumns: `1fr ${chartW}px`, gap: 48 * u }}>
          <div style={{ display: "grid", alignContent: "space-between" }}>
            {title}
            <div style={{ display: "grid", gap: 36 * u }}>{callouts.map(callout)}</div>
          </div>
          <div style={{ alignSelf: "center" }}>{chart}</div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame size={size} handle={handle} bands={bands} stamp={`Through ${monthDay(asOf)}`}>
      <div style={{ position: "absolute", inset: `${56 * u}px ${pad}px ${32 * u}px`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 28 * u }}>
        {title}
        {chart}
        <div style={{ display: "grid", gap: 28 * u }}>{callouts.map(callout)}</div>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 4. game recap */

export function GameRecap({ r, teams, size, handle }: { r: StudioRecap; teams: Record<string, StudioTeam>; size: SizeKey; handle: string }) {
  const { w, h } = SIZES[size];
  const landscape = w > h;
  const story = size === "story";
  const u = landscape ? h / 1080 : w / 1080;
  const pad = 72 * u;
  const A = teams[r.away] ?? MISSING_TEAM;
  const H = teams[r.home] ?? MISSING_TEAM;
  const scoreRow = (t: StudioTeam, code: string, score: number, periods: number[]) => {
    const won = r.winner === code;
    return (
      <div style={{ display: "grid", gridTemplateColumns: `${18 * u}px 1fr auto`, alignItems: "center", gap: 24 * u, opacity: won ? 1 : 0.62 }}>
        <div style={{ alignSelf: "stretch", background: t.accent, borderRadius: 3 * u }} />
        <div style={{ display: "grid" }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: (story || landscape ? 112 : 96) * u, lineHeight: 0.85 }}>{code}</span>
          <span style={{ fontSize: 26 * u, color: C.ink2 }}>
            {t.nickname} <span style={{ color: C.muted }}>{periods.join("  ")}</span>
          </span>
        </div>
        <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: (landscape ? 200 : story ? 210 : 172) * u, lineHeight: 0.8 }}>{score}</span>
      </div>
    );
  };
  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <Label u={u}>{r.ot ? (r.ot === 1 ? "Final, overtime" : `Final, ${r.ot} overtimes`) : "Final"}</Label>
      <span style={{ fontSize: 26 * u, color: C.ink2 }}>{longDate(r.date)}</span>
    </div>
  );
  const flow = (
    <div style={{ display: "grid", gap: 10 * u }}>
      <span style={{ fontSize: 24 * u, color: C.ink2 }}>Margin after each quarter (above the line {r.away} led)</span>
      <QuarterFlow
        away={r.away}
        home={r.home}
        awayPeriods={r.away_periods}
        homePeriods={r.home_periods}
        awayColor={A.accent}
        homeColor={H.accent}
        width={landscape ? 860 * u : w - pad * 2}
        height={(story ? 360 : landscape ? 330 : 220) * u}
        font={24 * u}
        surface={C.surface}
      />
    </div>
  );
  const gaps = r.gaps.length ? (
    <div style={{ display: "grid", gap: 16 * u }}>
      <span style={{ fontSize: 24 * u, color: C.ink2 }}>Where it was decided</span>
      {r.gaps.map((g) => (
        <div key={g.stat} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "baseline", gap: 16 * u, borderLeft: `6px solid ${g.level === "Major" ? C.clock : C.line}`, paddingLeft: 18 * u }}>
          <span style={{ fontSize: 30 * u, fontWeight: 650 }}>{g.stat}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: (story || landscape ? 48 : 42) * u }}>
            {r.away} {g.away_txt}, {r.home} {g.home_txt}
          </span>
        </div>
      ))}
    </div>
  ) : null;
  const leaders = r.leaders.length ? (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${r.leaders.length}, 1fr)`, gap: 24 * u, borderTop: `2px solid ${C.line}`, paddingTop: 22 * u }}>
      {r.leaders.map((l) => (
        <div key={l.name} style={{ display: "grid", gap: 4 * u }}>
          <span style={{ fontSize: 22 * u, color: C.muted }}>{l.team} leader</span>
          <span style={{ fontSize: 32 * u, fontWeight: 700 }}>{l.name}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 52 * u }}>
            {l.pts}-{l.reb}-{l.ast} <span style={{ fontFamily: SANS, fontSize: 22 * u, color: C.ink2, fontWeight: 500 }}>PTS-REB-AST, {signed(l.pm, 0)}</span>
          </span>
        </div>
      ))}
    </div>
  ) : null;
  const meta = (
    <div style={{ fontSize: 24 * u, color: C.ink2 }}>
      Largest leads {r.away} {r.away_max_lead}, {r.home} {r.home_max_lead}. Lead changes {r.lead_changes}.
    </div>
  );
  const stamp = `${monthDay(r.date)} ${r.away} at ${r.home}`;
  if (landscape) {
    return (
      <Frame size={size} handle={handle} bands={[A, H]} stamp={stamp}>
        <div style={{ position: "absolute", inset: `${52 * u}px ${pad}px ${28 * u}px`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 72 * u }}>
          <div style={{ display: "grid", alignContent: "space-between", gap: 24 * u }}>
            {header}
            {scoreRow(A, r.away, r.away_score, r.away_periods)}
            {scoreRow(H, r.home, r.home_score, r.home_periods)}
            {meta}
            {leaders}
          </div>
          <div style={{ display: "grid", alignContent: "space-between", gap: 24 * u }}>
            {flow}
            {gaps}
          </div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame size={size} handle={handle} bands={[A, H]} stamp={stamp}>
      <div style={{ position: "absolute", inset: `${56 * u}px ${pad}px ${32 * u}px`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 22 * u }}>
        {header}
        <div style={{ display: "grid", gap: 18 * u }}>
          {scoreRow(A, r.away, r.away_score, r.away_periods)}
          {scoreRow(H, r.home, r.home_score, r.home_periods)}
        </div>
        {flow}
        {gaps}
        {story ? meta : null}
        {leaders}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 5. shot chart */

export function ShotChartCard({ c, teams, size, handle }: { c: StudioShotChart; teams: Record<string, StudioTeam>; size: SizeKey; handle: string }) {
  const { w, h } = SIZES[size];
  const landscape = w > h;
  const story = size === "story";
  const u = landscape ? h / 1080 : w / 1080;
  const pad = 72 * u;
  const team = teams[c.team] ?? MISSING_TEAM;
  const opp = teams[c.opp] ?? MISSING_TEAM;
  const player = c.kind === "player";
  const parts = c.name.split(" ");
  const first = player && parts.length > 1 ? parts[0] : player ? "" : team.name.replace(new RegExp(`\\s*${team.nickname}$`), "");
  const last = player ? (parts.length > 1 ? parts.slice(1).join(" ") : c.name) : team.nickname || c.team;
  const nameWidth = landscape ? 760 * u : w - pad * 2;
  const lastSize = fit(last, nameWidth, (story ? 150 : landscape ? 124 : 116) * u, 0.45);
  const score = `${Math.max(c.team_score, c.opp_score)}-${Math.min(c.team_score, c.opp_score)}`;
  const depth = story ? 44 : 36; // feet from the baseline: 36 stops 7 ft past the top of the arc
  const chartW = landscape ? 960 * u : story ? w - pad * 2 : 780 * u;
  const hidden = c.shots.filter((s) => s.y - COURT.baseline > depth).length;
  const zones = c.zones.filter((z) => z.zone !== "backcourt");
  const back = c.zones.find((z) => z.zone === "backcourt");

  const head = (
    <div style={{ display: "grid", gap: 10 * u }}>
      <Label u={u}>Shot chart</Label>
      <div style={{ fontSize: 26 * u, color: C.ink2 }}>
        {longDate(c.date)}, {c.home ? "vs" : "at"} {opp.nickname || c.opp}. {c.team} {c.won ? "beat" : "lost to"} {c.opp} {score}.
      </div>
    </div>
  );
  const name = (
    <div style={{ display: "flex", alignItems: "stretch", gap: 24 * u }}>
      <div style={{ width: 14 * u, background: team.accent, borderRadius: 3 * u }} />
      <div style={{ display: "grid" }}>
        {first ? <div style={{ fontSize: 40 * u, fontWeight: 600, color: C.ink2, lineHeight: 1.1 }}>{first}</div> : null}
        <div style={{ fontFamily: DISPLAY, fontWeight: 850, fontSize: lastSize, lineHeight: 0.88, letterSpacing: "0.005em" }}>{last}</div>
      </div>
    </div>
  );
  const line = (
    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 54 * u, lineHeight: 1 }}>
      {c.fgm} of {c.fga}
      <span style={{ fontFamily: SANS, fontWeight: 500, fontSize: 26 * u, color: C.ink2, marginLeft: 12 * u }}>
        from the field, {c.tpm} of {c.tpa} from three{player ? `, ${c.pts} points` : ""}
      </span>
    </div>
  );
  const legend = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 28 * u, fontSize: 22 * u, color: C.ink2 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 * u }}>
        <span style={{ width: 18 * u, height: 18 * u, borderRadius: 999, background: team.accent }} />
        Made
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 * u }}>
        <svg width={18 * u} height={18 * u} viewBox="0 0 12 12" aria-hidden>
          <path d="M2,2L10,10M2,10L10,2" stroke={C.muted} strokeWidth="2" strokeLinecap="round" />
        </svg>
        Missed
      </span>
      <span style={{ color: C.muted }}>
        Basket at the top{hidden ? `. Not shown: ${hidden} from beyond ${Math.round(depth + COURT.baseline)} ft` : ""}
      </span>
    </div>
  );
  const chart = (
    <div style={{ width: chartW }}>
      <ShotChart
        view="dots"
        shots={c.shots}
        width={chartW}
        depth={depth}
        madeColor={team.accent}
        missColor={C.muted}
        lineColor="#36537a"
        surface={C.surface}
        label={`${c.name} shots, ${longDate(c.date)}`}
      />
    </div>
  );
  // zones: made-attempted last night, with the season and the league from there
  const strip = (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${zones.length}, 1fr)`, gap: 14 * u, borderTop: `2px solid ${C.line}`, paddingTop: 20 * u }}>
      {zones.map((z) => (
        <div key={z.zone} style={{ display: "grid", gap: 4 * u, alignContent: "start" }}>
          <span style={{ fontSize: 21 * u, color: C.muted, lineHeight: 1.15 }}>{ZONE_LABEL[z.zone as ZoneKey]}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 54 * u, lineHeight: 1 }}>
            {z.fgm}-{z.fga}
          </span>
          <span style={{ fontSize: 21 * u, color: C.ink2 }}>League {f1(z.lg_fg_pct)}%</span>
        </div>
      ))}
    </div>
  );
  const cols = "2.1fr 1fr 1fr 1fr 1fr";
  const table = (
    <div style={{ display: "grid", gap: 10 * u }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12 * u, fontSize: 21 * u, color: C.muted, borderBottom: `2px solid ${C.line}`, paddingBottom: 10 * u }}>
        <span>Zone</span>
        <span style={{ textAlign: "right" }}>Made</span>
        <span style={{ textAlign: "right" }}>FG%</span>
        <span style={{ textAlign: "right" }}>Season</span>
        <span style={{ textAlign: "right" }}>League</span>
      </div>
      {zones.map((z) => (
        <div key={z.zone} style={{ display: "grid", gridTemplateColumns: cols, gap: 12 * u, alignItems: "baseline" }}>
          <span style={{ fontSize: 26 * u, fontWeight: 600, whiteSpace: "nowrap" }}>{ZONE_LABEL[z.zone as ZoneKey]}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 44 * u, textAlign: "right", lineHeight: 1 }}>
            {z.fgm}-{z.fga}
          </span>
          <span style={{ fontSize: 27 * u, textAlign: "right" }}>{f1(z.fg_pct)}</span>
          <span style={{ fontSize: 27 * u, textAlign: "right", color: C.ink2 }}>{f1(z.season_fg_pct)}</span>
          <span style={{ fontSize: 27 * u, textAlign: "right", color: C.ink2 }}>{f1(z.lg_fg_pct)}</span>
        </div>
      ))}
      <div style={{ fontSize: 20 * u, color: C.muted }}>
        FG% by zone last night, {player ? "his" : "their"} season so far, and the league this season.{back && back.fga ? ` Plus ${back.fgm}-${back.fga} from the backcourt.` : ""}
      </div>
    </div>
  );

  const stamp = `${monthDay(c.date)} ${c.team} ${c.home ? "vs" : "at"} ${c.opp}`;
  if (landscape) {
    return (
      <Frame size={size} handle={handle} bands={[team]} stamp={stamp} texture={false}>
        <div style={{ position: "absolute", inset: `${48 * u}px ${pad}px ${28 * u}px`, display: "grid", gridTemplateColumns: `1fr ${chartW}px`, gap: 56 * u }}>
          <div style={{ display: "grid", alignContent: "space-between", gap: 22 * u }}>
            {head}
            {name}
            {line}
            {table}
          </div>
          <div style={{ display: "grid", alignContent: "center", justifySelf: "center", gap: 16 * u }}>
            {chart}
            {legend}
          </div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame size={size} handle={handle} bands={[team]} stamp={stamp} texture={false}>
      <div style={{ position: "absolute", inset: `${56 * u}px ${pad}px ${32 * u}px`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 20 * u }}>
        {head}
        {name}
        {line}
        <div style={{ display: "grid", gap: 14 * u, width: chartW, alignSelf: "center" }}>
          {chart}
          {legend}
        </div>
        {story ? table : strip}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 6. game flow */

export function GameFlowCard({ f, teams, size, handle }: { f: StudioFlow; teams: Record<string, StudioTeam>; size: SizeKey; handle: string }) {
  const { w, h } = SIZES[size];
  const landscape = w > h;
  const story = size === "story";
  const u = landscape ? h / 1080 : w / 1080;
  const pad = 72 * u;
  const A = teams[f.away] ?? MISSING_TEAM;
  const H = teams[f.home] ?? MISSING_TEAM;
  const final = f.ot ? (f.ot === 1 ? "Final, overtime" : `Final, ${f.ot} overtimes`) : "Final";
  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24 * u }}>
      <Label u={u}>Game flow</Label>
      <span style={{ fontSize: 26 * u, color: C.ink2 }}>
        {longDate(f.date)}, {final.toLowerCase()}
      </span>
    </div>
  );
  const side = (t: StudioTeam, code: string, score: number, right: boolean) => (
    <div style={{ display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "center", gap: 22 * u, opacity: f.winner === code ? 1 : 0.62 }}>
      <div style={{ width: 14 * u, alignSelf: "stretch", background: t.accent, borderRadius: 3 * u }} />
      <div style={{ display: "grid", justifyItems: right ? "end" : "start" }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 88 * u, lineHeight: 0.85 }}>{code}</span>
        <span style={{ fontSize: 24 * u, color: C.ink2 }}>{t.nickname}</span>
      </div>
      <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 140 * u, lineHeight: 0.8 }}>{score}</span>
    </div>
  );
  const scores = landscape ? (
    <div style={{ display: "grid", gap: 22 * u }}>
      {side(A, f.away, f.away_score, false)}
      {side(H, f.home, f.home_score, false)}
    </div>
  ) : (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "center", gap: 24 * u }}>
      {side(A, f.away, f.away_score, false)}
      {side(H, f.home, f.home_score, true)}
    </div>
  );
  const chartW = landscape ? 1080 * u : w - pad * 2;
  const chartH = (landscape ? 760 : story ? 820 : 450) * u;
  const chart = (
    <div style={{ display: "grid", gap: 10 * u }}>
      <span style={{ fontSize: 24 * u, color: C.ink2 }}>
        Score margin after every basket. Above the line {f.away} led, below it {f.home} led.
      </span>
      <GameFlowChart
        away={f.away}
        home={f.home}
        t={f.t}
        awayScores={f.away_pts}
        homeScores={f.home_pts}
        periods={f.periods}
        awayColor={A.accent}
        homeColor={H.accent}
        runs={f.runs}
        labelRuns={story || landscape ? 3 : 2}
        width={chartW}
        height={chartH}
        font={(landscape ? 22 : 24) * u}
        surface={C.surface}
      />
    </div>
  );
  const facts: [string, string][] = [
    ["Lead changes", String(f.lead_changes)],
    ["Times tied", String(f.times_tied)],
    [`${f.away} led for`, duration(f.away_lead_secs)],
    [`${f.home} led for`, duration(f.home_lead_secs)],
  ];
  const factRow = (
    <div style={{ display: "grid", gridTemplateColumns: landscape ? "1fr 1fr" : "repeat(4, 1fr)", gap: `${22 * u}px ${24 * u}px`, borderTop: `2px solid ${C.line}`, paddingTop: 22 * u }}>
      {facts.map(([label, v]) => (
        <div key={label} style={{ display: "grid", gap: 4 * u }}>
          <span style={{ fontSize: 22 * u, color: C.muted }}>{label}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 64 * u, lineHeight: 1 }}>{v}</span>
        </div>
      ))}
    </div>
  );
  const top = [...f.runs].sort((a, b) => b.pts - a.pts || a.start_t - b.start_t).slice(0, story ? 4 : landscape ? 3 : 2);
  const runs = top.length ? (
    <div style={{ display: "grid", gap: 14 * u }}>
      <span style={{ fontSize: 24 * u, color: C.ink2 }}>Biggest runs</span>
      {top.map((r) => (
        <div key={`${r.team}-${r.start_t}`} style={{ display: "grid", gridTemplateColumns: `${10 * u}px auto 1fr`, alignItems: "center", gap: 18 * u }}>
          <div style={{ alignSelf: "stretch", background: (teams[r.team] ?? MISSING_TEAM).accent, borderRadius: 3 * u }} />
          <span style={{ fontFamily: DISPLAY, fontWeight: 850, fontSize: 52 * u, lineHeight: 1 }}>
            {r.team} {r.pts}-0
          </span>
          <span style={{ fontSize: 24 * u, color: C.ink2, textAlign: "right" }}>
            {r.from} to {r.to}, {r.score_from} to {r.score_to}
          </span>
        </div>
      ))}
    </div>
  ) : null;
  const stamp = `${monthDay(f.date)} ${f.away} at ${f.home}`;
  if (landscape) {
    return (
      <Frame size={size} handle={handle} bands={[A, H]} stamp={stamp}>
        <div style={{ position: "absolute", inset: `${52 * u}px ${pad}px ${28 * u}px`, display: "grid", gridTemplateColumns: `1fr ${chartW}px`, gap: 64 * u }}>
          <div style={{ display: "grid", alignContent: "space-between", gap: 24 * u }}>
            {header}
            {scores}
            {factRow}
            {runs}
          </div>
          <div style={{ alignSelf: "center" }}>{chart}</div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame size={size} handle={handle} bands={[A, H]} stamp={stamp}>
      <div style={{ position: "absolute", inset: `${56 * u}px ${pad}px ${32 * u}px`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 24 * u }}>
        {header}
        {scores}
        {chart}
        {factRow}
        {runs}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 7. model vs vegas */

export function ModelCard({ m, teams, size, handle }: { m: StudioModel; teams: Record<string, StudioTeam>; size: SizeKey; handle: string }) {
  const { w, h } = SIZES[size];
  const landscape = w > h;
  const story = size === "story";
  const u = landscape ? h / 1080 : w / 1080;
  const pad = 72 * u;
  const A = teams[m.away] ?? MISSING_TEAM;
  const H = teams[m.home] ?? MISSING_TEAM;
  const a = m.sides[m.away];
  const hm = m.sides[m.home];
  const wc = winChances(m);
  const edge = edgeText({ ...m, home_code: m.home, away_code: m.away });
  const final = m.played && m.actual_margin !== null ? (m.actual_margin === 0 ? "Tied" : `${m.actual_margin > 0 ? m.home : m.away} won by ${Math.abs(m.actual_margin)}`) : null;
  const pick = m.pick === "home" ? m.home : m.pick === "away" ? m.away : null;
  const result = atsWord(m.ats);
  const half = ((landscape ? 900 * u : w - pad * 2) - 8 * u) / 2;

  const teamBlock = (t: StudioTeam, code: string, s: ModelSide, right: boolean) => (
    <div style={{ display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "center", gap: 20 * u, textAlign: right ? "right" : "left" }}>
      <div style={{ width: 14 * u, alignSelf: "stretch", background: t.accent, borderRadius: 3 * u }} />
      <div style={{ display: "grid", gap: 4 * u, justifyItems: right ? "end" : "start" }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: (landscape ? 120 : story ? 170 : 116) * u, lineHeight: 0.8 }}>{code}</div>
        <div style={{ fontSize: 28 * u, fontWeight: 600 }}>{t.nickname}</div>
        <div style={{ fontSize: 24 * u, color: C.ink2 }}>
          {s.w}-{s.l}
          {s.b2b ? ", back-to-back" : ""}
        </div>
      </div>
    </div>
  );
  const bigLine = (label: string, text: string, strong: boolean) => (
    <div style={{ display: "grid", gap: 6 * u, justifyItems: "center" }}>
      <span style={{ fontSize: 26 * u, color: C.muted, fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: (landscape ? 110 : story ? 120 : 100) * u, lineHeight: 0.9, color: strong ? C.ink : C.ink2 }}>{text}</span>
    </div>
  );
  const lines = (
    <div style={{ display: "grid", gap: 20 * u }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2px 1fr", alignItems: "center", gap: 24 * u }}>
        {bigLine("Our model", lineText(m.home, m.away, m.pred_margin), true)}
        <div style={{ alignSelf: "stretch", background: C.line }} />
        {bigLine("ESPN line", m.line_margin === null ? "Not posted" : lineText(m.home, m.away, m.line_margin), false)}
      </div>
      <div style={{ textAlign: "center", fontSize: 34 * u, fontWeight: 700, color: C.clock }}>
        {final ? (
          <>
            {final}
            {pick && result ? <span style={{ color: C.ink2, fontWeight: 600 }}>{`. Model pick ${pick}: ${result.toLowerCase()}`}</span> : null}
          </>
        ) : edge && edge !== "No edge" ? (
          `Model likes ${edge} points against the line`
        ) : m.line_margin === null ? (
          "Line not posted yet"
        ) : (
          "Model and line agree"
        )}
      </div>
    </div>
  );
  const chance = wc ? (
    <div style={{ display: "grid", gap: 10 * u }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28 * u, fontWeight: 700 }}>
        <span>
          {m.away} {wc.away.toFixed(1)}%
        </span>
        <span style={{ fontSize: 22 * u, color: C.muted, fontWeight: 600 }}>Model win chance</span>
        <span>
          {m.home} {wc.home.toFixed(1)}%
        </span>
      </div>
      <div style={{ display: "flex", height: 18 * u, gap: 4 * u }}>
        <div style={{ flexGrow: wc.away, background: A.accent, borderRadius: `${9 * u}px 0 0 ${9 * u}px`, opacity: wc.away >= wc.home ? 1 : 0.45 }} />
        <div style={{ flexGrow: wc.home, background: H.accent, borderRadius: `0 ${9 * u}px ${9 * u}px 0`, opacity: wc.home > wc.away ? 1 : 0.45 }} />
      </div>
      {m.espn_away_wp != null && m.espn_home_wp != null ? (
        <div style={{ fontSize: 22 * u, color: C.ink2, textAlign: "center" }}>
          ESPN: {m.away} {m.espn_away_wp.toFixed(1)}%, {m.home} {m.espn_home_wp.toFixed(1)}%
        </div>
      ) : null}
    </div>
  ) : null;
  const rows: [string, keyof ModelSide, keyof ModelSide, boolean][] = [
    ["Adjusted net rating", "adj_net", "net_rk", true],
    ["Adjusted offense", "adj_ortg", "ortg_rk", false],
    ["Adjusted defense", "adj_drtg", "drtg_rk", false],
  ];
  const txt = (v: unknown, sgn: boolean) => (typeof v === "number" ? (sgn ? signed(v) : v.toFixed(1)) : "–");
  const tape = (
    <div style={{ display: "grid", gap: (story ? 36 : landscape ? 14 : 14) * u }}>
      {rows.map(([label, k, rk, sgn]) => (
        <TapeRow
          key={label}
          label={label}
          a={a[k] as number | null}
          h={hm[k] as number | null}
          aRank={a[rk] as number | null}
          hRank={hm[rk] as number | null}
          aText={txt(a[k], sgn)}
          hText={txt(hm[k], sgn)}
          aColor={A.accent}
          hColor={H.accent}
          u={u}
          half={half}
        />
      ))}
    </div>
  );
  const s = m.season;
  const foot = (
    <div style={{ fontSize: 22 * u, color: C.muted, lineHeight: 1.3, borderTop: `2px solid ${C.line}`, paddingTop: 16 * u }}>
      Ratings adjusted for opponents, from {m.fit_games} games before {monthDay(m.as_of)}.
      {s && s.line_games ? ` Model this season: ${s.ats_w}-${s.ats_l}${s.ats_p ? `-${s.ats_p}` : ""} against the line in ${s.line_games} games.` : ""}
    </div>
  );
  const header = (
    <div style={{ display: landscape ? "flex" : "grid", justifyContent: "space-between", alignItems: "baseline", gap: 10 * u }}>
      <Label u={u}>Model vs Vegas</Label>
      <div style={{ fontSize: 26 * u, color: C.ink2 }}>{m.played ? `${longDate(m.date)}, final` : `${longDate(m.date)}, ${m.time_et} ET${m.tv ? `, ${m.tv}` : ""}`}</div>
    </div>
  );
  const matchup = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 24 * u }}>
      {teamBlock(A, m.away, a, false)}
      <span style={{ fontFamily: DISPLAY, fontSize: 56 * u, color: C.muted, fontWeight: 700 }}>at</span>
      {teamBlock(H, m.home, hm, true)}
    </div>
  );
  const stamp = `${monthDay(m.date)} ${m.away} at ${m.home}`;
  if (landscape) {
    return (
      <Frame size={size} handle={handle} bands={[A, H]} stamp={stamp}>
        <div style={{ position: "absolute", inset: `${44 * u}px ${pad}px ${24 * u}px`, display: "grid", gridTemplateRows: "auto auto 1fr auto", gap: 26 * u }}>
          {header}
          {matchup}
          <div style={{ display: "grid", gridTemplateColumns: `1fr ${900 * u}px`, alignItems: "center", gap: 64 * u }}>
            <div style={{ display: "grid", gap: 30 * u }}>
              {lines}
              {chance}
            </div>
            {tape}
          </div>
          {foot}
        </div>
      </Frame>
    );
  }
  return (
    <Frame size={size} handle={handle} bands={[A, H]} stamp={stamp}>
      <div style={{ position: "absolute", inset: `${56 * u}px ${pad}px ${32 * u}px`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 22 * u }}>
        {header}
        {matchup}
        {lines}
        {chance}
        {tape}
        {foot}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 8. story card */

export function StoryGraphic({ s, teams, size, handle }: { s: StudioStory; teams: Record<string, StudioTeam>; size: SizeKey; handle: string }) {
  const { w, h } = SIZES[size];
  const landscape = w > h;
  const story = size === "story";
  const u = landscape ? h / 1080 : w / 1080;
  const pad = 72 * u;
  const team = teams[s.team] ?? MISSING_TEAM;
  const colW = landscape ? 820 * u : w - pad * 2;
  const headSize = fit(s.headline, colW * (landscape ? 2.6 : story ? 3 : 2.4), (story ? 108 : landscape ? 96 : 92) * u, 0.42);

  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24 * u }}>
      <Label u={u}>{s.kind_label}</Label>
      <span style={{ fontSize: 26 * u, color: C.ink2 }}>
        {longDate(s.date)}, story {s.rank} of the night
      </span>
    </div>
  );
  const head = (
    <div style={{ display: "flex", alignItems: "stretch", gap: 24 * u }}>
      <div style={{ width: 14 * u, background: team.accent, borderRadius: 3 * u, flexShrink: 0 }} />
      <div style={{ display: "grid", gap: 14 * u }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 850, fontSize: headSize, lineHeight: 0.95, letterSpacing: "0.005em" }}>{s.headline}</div>
        <div style={{ fontSize: 26 * u, color: C.muted }}>
          {team.name || s.team} vs {(teams[s.opp] ?? MISSING_TEAM).name || s.opp}
        </div>
      </div>
    </div>
  );
  const detail = <div style={{ fontSize: (story ? 32 : 28) * u, lineHeight: 1.35, color: C.ink2, maxWidth: colW }}>{s.detail}</div>;
  const figures = s.figures.length ? (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${s.figures.length}, 1fr)`, gap: 20 * u, borderTop: `2px solid ${C.line}`, paddingTop: 24 * u }}>
      {s.figures.map(([label, v]) => (
        <div key={label} style={{ display: "grid", gap: 6 * u, alignContent: "start" }}>
          <span style={{ fontSize: 22 * u, color: C.muted }}>{label}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 850, fontSize: fit(v, colW / 3, (story ? 120 : 100) * u, 0.5), lineHeight: 0.9, whiteSpace: "nowrap" }}>{v}</span>
        </div>
      ))}
    </div>
  ) : null;
  const c = s.chart;
  const chartW = landscape ? 860 * u : w - pad * 2;
  const chart = c ? (
    <div style={{ display: "grid", gap: 10 * u }}>
      <span style={{ fontSize: 24 * u, color: C.ink2 }}>{c.label}</span>
      <Columns
        width={chartW}
        height={(landscape ? 520 : story ? 520 : 330) * u}
        font={20 * u}
        diverging={c.diverging}
        color={team.accent}
        points={c.points.map((p) => ({
          key: p.key,
          label: monthDay(p.date),
          value: p.value,
          strong: p.strong,
          title: `${monthDay(p.date)} vs ${p.opp}: ${c.stat === "net" ? signed(p.value) : statText(c.stat, p.value)} ${(STAT_LABEL[c.stat] ?? "net rating").toLowerCase()}`,
        }))}
        avg={c.avg}
        avgLabel={c.avgLabel}
      />
    </div>
  ) : null;
  const also = s.also.length ? (
    <div style={{ display: "grid", gap: 12 * u }}>
      <span style={{ fontSize: 24 * u, color: C.ink2 }}>Also that night</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 * u }}>
        {s.also.slice(0, story ? 3 : 2).map((a) => (
          <span key={a} style={{ border: `2px solid ${C.clock}`, color: C.ink, borderRadius: 999, padding: `${6 * u}px ${20 * u}px`, fontSize: 24 * u, fontWeight: 600 }}>
            {a}
          </span>
        ))}
      </div>
    </div>
  ) : null;
  const stamp = `${monthDay(s.date)} ${s.team} vs ${s.opp}`;
  if (landscape) {
    return (
      <Frame size={size} handle={handle} bands={[team]} stamp={stamp}>
        <div style={{ position: "absolute", inset: `${56 * u}px ${pad}px ${32 * u}px`, display: "grid", gridTemplateColumns: `${colW}px 1fr`, gap: 72 * u }}>
          <div style={{ display: "grid", alignContent: "space-between", gap: 24 * u }}>
            {header}
            {head}
            {detail}
            {figures}
          </div>
          <div style={{ display: "grid", alignContent: "center", gap: 40 * u }}>
            {chart}
            {also}
          </div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame size={size} handle={handle} bands={[team]} stamp={stamp}>
      <div style={{ position: "absolute", inset: `${60 * u}px ${pad}px ${36 * u}px`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 24 * u }}>
        {header}
        {head}
        {detail}
        {figures}
        {chart}
        {story || !chart ? also : null}
      </div>
    </Frame>
  );
}
