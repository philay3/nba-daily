import { GameFlowCard, GameRecap, LeagueChart, MatchupCard, PlayerCard, ShotChartCard } from "@/components/studio/templates";
import type { StudioData, StudioSelection } from "@/lib/studio-types";

/** Default highlight for the league chart: tonight's top game, else the two best net ratings. */
export function defaultHighlight(data: StudioData): string[] {
  const m = data.matchups[0];
  if (m) return [m.away, m.home];
  return [...data.league].sort((a, b) => (b.net ?? 0) - (a.net ?? 0)).slice(0, 2).map((t) => t.code);
}

/** The selection with every missing choice filled from the data. */
export function resolveSelection(data: StudioData, sel: StudioSelection): StudioSelection {
  return {
    ...sel,
    player: data.players.find((p) => p.key === sel.player)?.key ?? data.players[0]?.key,
    // by game id; a game code (older links) picks that code's first game
    matchup: (data.matchups.find((m) => m.key === sel.matchup) ?? data.matchups.find((m) => m.code === sel.matchup) ?? data.matchups[0])?.key,
    recap: data.recaps.find((r) => r.code === sel.recap)?.code ?? data.recaps[0]?.code,
    shot: data.shotCharts.find((c) => c.key === sel.shot)?.key ?? data.shotCharts[0]?.key,
    flow: data.flows.find((f) => f.code === sel.flow)?.code ?? data.flows[0]?.code,
    highlight: sel.highlight?.length ? sel.highlight : defaultHighlight(data),
  };
}

export function emptyReason(data: StudioData, template: StudioSelection["template"]): string | null {
  if (template === "player" && !data.players.length) return "No box scores from last night for this date.";
  if (template === "recap" && !data.recaps.length) return "No finished games from last night for this date.";
  if (template === "matchup" && !data.matchups.length) return "No games in the next 3 days for this date.";
  if (template === "league" && !data.league.length) return "No team stats yet this season.";
  if (template === "shots" && !data.shotCharts.length) return "No shots from last night for this date.";
  if (template === "flow" && !data.flows.length) return "No play-by-play from last night for this date.";
  return null;
}

export function TemplateFrame({ data, sel }: { data: StudioData; sel: StudioSelection }) {
  const s = resolveSelection(data, sel);
  if (s.template === "player") {
    const line = data.players.find((p) => p.key === s.player);
    return line ? <PlayerCard line={line} teams={data.teams} size={s.size} handle={s.handle} /> : null;
  }
  if (s.template === "matchup") {
    const m = data.matchups.find((x) => x.key === s.matchup);
    return m ? <MatchupCard m={m} teams={data.teams} size={s.size} handle={s.handle} /> : null;
  }
  if (s.template === "recap") {
    const r = data.recaps.find((x) => x.code === s.recap);
    return r ? <GameRecap r={r} teams={data.teams} size={s.size} handle={s.handle} /> : null;
  }
  if (s.template === "shots") {
    const c = data.shotCharts.find((x) => x.key === s.shot);
    return c ? <ShotChartCard c={c} teams={data.teams} size={s.size} handle={s.handle} /> : null;
  }
  if (s.template === "flow") {
    const f = data.flows.find((x) => x.code === s.flow);
    return f ? <GameFlowCard f={f} teams={data.teams} size={s.size} handle={s.handle} /> : null;
  }
  return data.league.length ? (
    <LeagueChart teams={data.teams} league={data.league} highlight={s.highlight ?? []} size={s.size} handle={s.handle} asOf={data.yday} />
  ) : null;
}

export function selectionToQuery(day: string, s: StudioSelection): string {
  const q = new URLSearchParams({ date: day, t: s.template, size: s.size, handle: s.handle });
  if (s.template === "player" && s.player) q.set("player", s.player);
  if (s.template === "matchup" && s.matchup) q.set("game", s.matchup);
  if (s.template === "recap" && s.recap) q.set("game", s.recap);
  if (s.template === "shots" && s.shot) q.set("shot", s.shot);
  if (s.template === "flow" && s.flow) q.set("game", s.flow);
  if (s.template === "league" && s.highlight?.length) q.set("teams", s.highlight.join(","));
  return q.toString();
}
