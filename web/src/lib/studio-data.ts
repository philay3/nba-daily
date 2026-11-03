import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { teamAccent } from "@/lib/colors";
import { getToday, played } from "@/lib/data";
import { addDays, timeET } from "@/lib/format";
import type { StudioData, StudioMatchup, StudioPlayerLine, StudioRecap, StudioTeam } from "@/lib/studio-types";

/** Everything the studio templates need for one date, as plain JSON. */
export async function getStudioData(day: string): Promise<StudioData> {
  const d = await getToday(day);
  const teams: Record<string, StudioTeam> = {};
  for (const tm of d.teams.values()) {
    teams[tm.code] = {
      code: tm.code,
      name: tm.display_name,
      nickname: tm.nickname,
      conference: tm.conference,
      primary: tm.primary_color,
      secondary: tm.secondary_color,
      accent: teamAccent(tm.primary_color, tm.secondary_color),
    };
  }
  const seasonIdx = new Map(d.players.map((p) => [p.player_id, p]));

  // last night's lines, best first, with each player's season trend
  const lines = d.box.filter(played).sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));
  const ids = [...new Set(lines.map((b) => b.player_id))];
  const trendRows = ids.length && d.season
    ? await getDb()
        .select({ player_id: t.player_games.player_id, game_date: t.player_games.game_date, pts: t.player_games.pts, pm: t.player_games.plus_minus, min: t.player_games.min, dnp: t.player_games.did_not_play })
        .from(t.player_games)
        .innerJoin(t.games, eq(t.games.id, t.player_games.game_id))
        .where(and(inArray(t.player_games.player_id, ids), eq(t.games.season, d.season)))
        .orderBy(asc(t.player_games.game_date))
    : [];
  const trend = new Map<number, { date: string; pts: number; pm: number | null }[]>();
  for (const r of trendRows) {
    if (r.dnp || !((r.min ?? 0) > 0) || r.game_date > d.yday) continue;
    const list = trend.get(r.player_id) ?? [];
    list.push({ date: r.game_date, pts: r.pts ?? 0, pm: r.pm });
    trend.set(r.player_id, list);
  }
  const gameById = new Map(d.lastNight.map((g) => [g.id, g]));
  const players: StudioPlayerLine[] = lines.map((b) => {
    const g = gameById.get(b.game_id)!;
    const home = b.home_away === "home";
    const us = (home ? g.home_score : g.away_score) ?? 0;
    const them = (home ? g.away_score : g.home_score) ?? 0;
    const s = seasonIdx.get(b.player_id);
    return {
      key: `${b.game_id}-${b.player_id}`,
      game_id: b.game_id,
      player_id: b.player_id,
      name: b.name,
      team: b.team_code,
      opp: b.opp_code,
      home,
      date: b.game_date,
      min: Math.round(b.min ?? 0),
      pts: b.pts ?? 0,
      reb: b.reb ?? 0,
      ast: b.ast ?? 0,
      stl: b.stl ?? 0,
      blk: b.blk ?? 0,
      tov: b.tov ?? 0,
      fgm: b.fgm ?? 0,
      fga: b.fga ?? 0,
      tpm: b.tpm ?? 0,
      tpa: b.tpa ?? 0,
      ftm: b.ftm ?? 0,
      fta: b.fta ?? 0,
      pm: b.plus_minus,
      ts_pct: b.ts_pct,
      gp_before: b.delta?.gp_before ?? 0,
      avg_pts: b.delta?.avg_pts ?? null,
      avg_reb: b.delta?.avg_reb ?? null,
      avg_ast: b.delta?.avg_ast ?? null,
      d_pts: b.delta?.d_pts ?? null,
      d_reb: b.delta?.d_reb ?? null,
      d_ast: b.delta?.d_ast ?? null,
      flags: (b.delta?.flags ?? "").split(" · ").filter(Boolean),
      team_score: us,
      opp_score: them,
      won: g.winner_code === b.team_code,
      season: s ? { gp: s.gp, ppg: s.ppg, rpg: s.rpg, apg: s.apg, ts_pct: s.ts_pct, pm_pg: s.pm_pg } : null,
      trend: trend.get(b.player_id) ?? [],
    };
  });

  const pidx = new Map(d.players.map((p) => [`${p.team_code}|${p.name}`, p]));
  const matchups: StudioMatchup[] = d.tonight.map((g) => {
    const side = (code: string) => {
      const ts = d.teamSeason.get(code);
      const out = d.injuries
        .filter((i) => i.team_code === code && (i.status === "Out" || i.status === "Doubtful"))
        .map((i) => ({ name: i.player_name, ppg: pidx.get(`${code}|${i.player_name}`)?.ppg ?? null, status: i.status }))
        .filter((x) => x.ppg !== null)
        .sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0));
      return {
        w: ts?.w ?? 0,
        l: ts?.l ?? 0,
        net: ts?.net ?? null,
        net_rk: ts?.net_rk ?? null,
        ortg: ts?.ortg ?? null,
        ortg_rk: ts?.ortg_rk ?? null,
        drtg: ts?.drtg ?? null,
        drtg_rk: ts?.drtg_rk ?? null,
        pace: ts?.pace ?? null,
        pace_rk: ts?.pace_rk ?? null,
        l5_net: ts?.l5_net ?? null,
        l5_net_rk: ts?.l5_net_rk ?? null,
        efg: ts?.efg ?? null,
        efg_rk: ts?.efg_rk ?? null,
        opp_efg: ts?.opp_efg ?? null,
        opp_efg_rk: ts?.opp_efg_rk ?? null,
        rest: code === g.away_code ? g.away_rest : g.home_rest,
        missing_ppg: d.missing.get(code)?.ppg ?? 0,
        missing: out.slice(0, 3),
      };
    };
    return {
      code: g.code,
      game_id: g.id,
      date: g.game_date,
      time_et: timeET(g.tip),
      tv: g.tv ?? "",
      away: g.away_code,
      home: g.home_code,
      line: g.odds?.line ?? null,
      total: g.odds?.total ?? null,
      away_wp: g.odds?.away_wp ?? null,
      home_wp: g.odds?.home_wp ?? null,
      watch: g.pick?.watch ?? null,
      tag: g.pick?.tag ?? "",
      sides: { [g.away_code]: side(g.away_code), [g.home_code]: side(g.home_code) },
    };
  });
  matchups.sort((a, b) => (a.watch ?? 99) - (b.watch ?? 99));

  const gaps = d.lastNight.length
    ? await getDb().select().from(t.game_gaps).where(inArray(t.game_gaps.game_id, d.lastNight.map((g) => g.id)))
    : [];
  const recaps: StudioRecap[] = d.results.map((r) => {
    const top = (code: string) => {
      const b = lines.filter((x) => x.game_id === r.id && x.team_code === code)[0];
      return b ? { name: b.name, team: code, pts: b.pts ?? 0, reb: b.reb ?? 0, ast: b.ast ?? 0, pm: b.plus_minus } : null;
    };
    return {
      game_id: r.id,
      code: r.code,
      date: r.game_date,
      away: r.away_code,
      home: r.home_code,
      away_score: r.away_score ?? 0,
      home_score: r.home_score ?? 0,
      winner: r.winner_code ?? "",
      ot: r.ot ?? 0,
      away_periods: r.away_periods,
      home_periods: r.home_periods,
      lead_changes: r.lead_changes ?? 0,
      away_max_lead: r.away_tg?.largest_lead ?? 0,
      home_max_lead: r.home_tg?.largest_lead ?? 0,
      note: r.note,
      gaps: gaps
        .filter((x) => x.game_id === r.id && x.level)
        .sort((a, b) => b.z - a.z)
        .slice(0, 3)
        .map((x) => ({ stat: x.stat, away_txt: x.away_txt, home_txt: x.home_txt, level: x.level, edge: x.edge, z: x.z })),
      leaders: [top(r.away_code), top(r.home_code)].filter((x): x is NonNullable<typeof x> => x !== null),
    };
  });

  const league = [...d.teamSeason.values()]
    .filter((r) => r.ortg != null && r.drtg != null)
    .map((r) => ({
      code: r.team_code,
      name: teams[r.team_code]?.name ?? r.team_code,
      conf: teams[r.team_code]?.conference ?? "",
      ortg: r.ortg!,
      drtg: r.drtg!,
      net: r.net,
      ortg_rk: r.ortg_rk,
      drtg_rk: r.drtg_rk,
      w: r.w,
      l: r.l,
      accent: teams[r.team_code]?.accent ?? "#8293ab",
    }));

  return { day, yday: addDays(day, -1), season: d.season, teams, players, matchups, recaps, league };
}
