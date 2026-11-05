import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { teamAccent } from "@/lib/colors";
import { dayMode, getModelGames, getToday, played, storyLogs, type TodayData } from "@/lib/data";
import { periodLabel } from "@/lib/flow";
import { addDays, tipTime } from "@/lib/format";
import { fgPct, ZONES, zoneCounts } from "@/lib/shots";
import { evidenceOf, keyFigure, STORY_KINDS, storyChart, storyFigures, storyKey, type StoryKind } from "@/lib/stories";
import type { ModelSide, StudioData, StudioFlow, StudioMatchup, StudioModel, StudioPlayerLine, StudioRecap, StudioShotChart, StudioStory, StudioTeam } from "@/lib/studio-types";

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
    if (r.dnp || r.game_date > d.yday) continue;
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

  // matchups for every game in the next 3 days that the newest run's look-ahead covers
  const days = [d];
  for (const i of [1, 2]) {
    const next = addDays(day, i);
    if (dayMode(next, d.latest) === "preview") days.push(await getToday(next));
  }
  const matchups: StudioMatchup[] = days.flatMap((dd, i) => matchupsOf(dd, i));
  matchups.sort((a, b) => a.days_ahead - b.days_ahead || (a.watch ?? 99) - (b.watch ?? 99));

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

  // last night's games with play-by-play, the most back-and-forth first
  const resultIds = d.results.map((r) => r.id);
  const [flowRows, runRows] = resultIds.length
    ? await Promise.all([
        getDb().select().from(t.game_flow).where(inArray(t.game_flow.game_id, resultIds)),
        getDb().select().from(t.game_runs).where(inArray(t.game_runs.game_id, resultIds)).orderBy(asc(t.game_runs.game_id), asc(t.game_runs.seq)),
      ])
    : [[], []];
  const flowById = new Map(flowRows.map((f) => [f.game_id, f]));
  const flows: StudioFlow[] = d.results
    .filter((r) => flowById.has(r.id))
    .map((r) => {
      const f = flowById.get(r.id)!;
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
        periods: f.num_periods,
        t: f.t,
        away_pts: f.away,
        home_pts: f.home,
        lead_changes: f.lead_changes,
        times_tied: f.times_tied,
        away_largest_lead: f.away_largest_lead,
        home_largest_lead: f.home_largest_lead,
        away_lead_secs: f.away_lead_secs,
        home_lead_secs: f.home_lead_secs,
        runs: runRows
          .filter((x) => x.game_id === r.id)
          .map((x) => ({
            side: x.team_code === r.away_code ? ("away" as const) : ("home" as const),
            team: x.team_code,
            pts: x.pts,
            start_t: x.start_t,
            end_t: x.end_t,
            from: `${periodLabel(x.start_period)} ${x.start_clock}`,
            to: `${periodLabel(x.end_period)} ${x.end_clock}`,
            score_from: `${x.away_before}-${x.home_before}`,
            score_to: `${x.away_after}-${x.home_after}`,
          })),
      };
    })
    .sort((a, b) => b.lead_changes - a.lead_changes || Math.abs(a.away_score - a.home_score) - Math.abs(b.away_score - b.home_score));

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

  const shotCharts = await getShotCharts(d.lastNight.map((g) => g.id), d.season, lines, d.results);

  const models = await getStudioModels(d, days);
  const stories = await getStudioStories(d.yday, d.season, teams);

  return { day, yday: addDays(day, -1), season: d.season, teams, players, matchups, recaps, flows, league, shotCharts, models, stories };
}

/** Last night's ranked stories, each with its figures and evidence chart. */
async function getStudioStories(night: string, season: number | null, teams: Record<string, StudioTeam>): Promise<StudioStory[]> {
  if (!season) return [];
  const db = getDb();
  const rows = await db
    .select({ s: t.stories, name: t.players.name })
    .from(t.stories)
    .leftJoin(t.players, eq(t.players.id, t.stories.player_id))
    .where(and(eq(t.stories.season, season), eq(t.stories.story_date, night)))
    .orderBy(asc(t.stories.rank));
  const ids = [...new Set(rows.map((r) => r.s.player_id).filter((x): x is number => x !== null))];
  const logs = await storyLogs(season, ids, night);
  return rows.map(({ s, name }) => ({
    key: storyKey(s),
    rank: s.rank,
    date: s.story_date,
    kind: s.kind,
    kind_label: STORY_KINDS[(s.kind in STORY_KINDS ? s.kind : "outlier") as StoryKind],
    headline: s.headline,
    detail: s.detail,
    name: name ?? teams[s.team_code]?.name ?? s.team_code,
    team: s.team_code,
    opp: s.opp_code,
    figures: storyFigures(s),
    chart: storyChart(s, s.player_id !== null ? (logs.get(s.player_id) ?? []) : []),
    also: (evidenceOf(s).also ?? []).map((a) => a.headline),
    key_figure: keyFigure(s),
  }));
}

/** Model vs ESPN cards: the games of the next 3 days first, then last night's with their results. */
async function getStudioModels(d: TodayData, days: TodayData[]): Promise<StudioModel[]> {
  const ahead = days.flatMap((dd) => dd.tonight.filter((g) => g.model && !OFF.has(g.status)));
  const lastModels = await getModelGames(d.lastNight.map((g) => g.id));
  const last = d.lastNight.filter((g) => lastModels.get(g.id)?.actual_margin != null);
  const all = [...ahead.map((g) => ({ g, m: g.model!, odds: g.odds })), ...last.map((g) => ({ g, m: lastModels.get(g.id)!, odds: null }))];
  if (!all.length || !d.season) return [];
  const db = getDb();
  const asOfs = [...new Set(all.map((x) => x.m.as_of))];
  const [ratings, bt, lastOdds] = await Promise.all([
    db.select().from(t.power_ratings).where(and(eq(t.power_ratings.season, d.season), inArray(t.power_ratings.as_of, asOfs))),
    db.select().from(t.model_backtest).where(eq(t.model_backtest.season, d.season)).limit(1),
    last.length ? db.select().from(t.odds).where(inArray(t.odds.game_id, last.map((g) => g.id))) : Promise.resolve([]),
  ]);
  const rk = new Map(ratings.map((r) => [`${r.as_of}|${r.team_code}`, r]));
  const b = bt[0];
  return all.map(({ g, m, odds }) => {
    const o = odds ?? lastOdds.filter((x) => x.game_id === g.id).sort((a, z) => z.snapshot_date.localeCompare(a.snapshot_date))[0] ?? null;
    const side = (code: string, rest: number | null): ModelSide => {
      const r = rk.get(`${m.as_of}|${code}`);
      const ts = d.teamSeason.get(code);
      return {
        w: ts?.w ?? 0,
        l: ts?.l ?? 0,
        adj_net: r?.adj_net ?? null,
        net_rk: r?.net_rk ?? null,
        adj_ortg: r?.adj_ortg ?? null,
        ortg_rk: r?.ortg_rk ?? null,
        adj_drtg: r?.adj_drtg ?? null,
        drtg_rk: r?.drtg_rk ?? null,
        b2b: rest === 0,
      };
    };
    return {
      key: String(g.id),
      code: g.code,
      game_id: g.id,
      date: g.game_date,
      time_et: tipTime(g),
      tv: g.tv ?? "",
      away: g.away_code,
      home: g.home_code,
      played: m.actual_margin !== null,
      as_of: m.as_of,
      fit_games: m.fit_games,
      pred_margin: m.pred_margin,
      home_wp: m.home_wp,
      sigma: m.sigma,
      home_court: m.home_court,
      rest_adj: m.rest_adj,
      line_margin: m.line_margin,
      espn_away_wp: o?.away_wp ?? null,
      espn_home_wp: o?.home_wp ?? null,
      actual_margin: m.actual_margin,
      ats: m.ats,
      pick: m.pick,
      sides: { [g.away_code]: side(g.away_code, m.away_rest), [g.home_code]: side(g.home_code, m.home_rest) },
      season: b ? { games: b.games, line_games: b.line_games, model_mae: b.model_mae, line_mae: b.line_mae, ats_w: b.ats_w, ats_l: b.ats_l, ats_p: b.ats_p } : null,
    };
  });
}

/** Last night's shots for every player who took one and for both teams of each game, top scorers first. */
async function getShotCharts(
  ids: number[],
  season: number | null,
  lines: TodayData["box"],
  results: TodayData["results"],
): Promise<StudioShotChart[]> {
  if (!ids.length || !season) return [];
  const db = getDb();
  const [shotRows, gameZones, leagueZones, teamZones, playerZones] = await Promise.all([
    db
      .select({ game_id: t.shots.game_id, player_id: t.shots.player_id, team_code: t.shots.team_code, x: t.shots.x, y: t.shots.y, made: t.shots.made, zone: t.shots.zone })
      .from(t.shots)
      .where(inArray(t.shots.game_id, ids))
      .orderBy(asc(t.shots.game_id), asc(t.shots.seq)),
    db.select().from(t.game_shot_zones).where(inArray(t.game_shot_zones.game_id, ids)),
    db.select().from(t.league_shot_zones).where(eq(t.league_shot_zones.season, season)),
    db.select().from(t.team_shot_zones).where(and(eq(t.team_shot_zones.season, season), eq(t.team_shot_zones.side, "offense"))),
    db
      .select({ player_id: t.player_shot_zones.player_id, zone: t.player_shot_zones.zone, fg_pct: t.player_shot_zones.fg_pct })
      .from(t.player_shot_zones)
      .where(and(eq(t.player_shot_zones.season, season), inArray(t.player_shot_zones.player_id, [...new Set(lines.map((b) => b.player_id))]))),
  ]);
  const lg = new Map(leagueZones.map((r) => [r.zone, r.fg_pct]));
  const teamSeason = new Map(teamZones.map((r) => [`${r.team_code}|${r.zone}`, r.fg_pct]));
  const playerSeason = new Map(playerZones.map((r) => [`${r.player_id}|${r.zone}`, r.fg_pct]));
  const point = (r: (typeof shotRows)[number]) => ({ x: r.x, y: r.y, made: r.made, zone: r.zone });

  const charts: StudioShotChart[] = [];
  for (const b of lines) {
    const mine = shotRows.filter((r) => r.game_id === b.game_id && r.player_id === b.player_id);
    const r = results.find((g) => g.id === b.game_id);
    if (!mine.length || !r) continue;
    const counts = zoneCounts(mine);
    const home = b.home_away === "home";
    charts.push({
      key: `p-${b.game_id}-${b.player_id}`,
      kind: "player",
      game_id: b.game_id,
      date: b.game_date,
      name: b.name,
      team: b.team_code,
      opp: b.opp_code,
      home,
      won: r.winner_code === b.team_code,
      team_score: (home ? r.home_score : r.away_score) ?? 0,
      opp_score: (home ? r.away_score : r.home_score) ?? 0,
      fgm: b.fgm ?? 0,
      fga: b.fga ?? 0,
      tpm: b.tpm ?? 0,
      tpa: b.tpa ?? 0,
      pts: b.pts ?? 0,
      shots: mine.map(point),
      zones: ZONES.map((z) => ({ zone: z, ...counts[z], fg_pct: fgPct(counts[z]), season_fg_pct: playerSeason.get(`${b.player_id}|${z}`) ?? null, lg_fg_pct: lg.get(z) ?? null })),
    });
  }
  for (const r of results) {
    for (const [code, tg, opp] of [
      [r.away_code, r.away_tg, r.home_code],
      [r.home_code, r.home_tg, r.away_code],
    ] as const) {
      const mine = shotRows.filter((s) => s.game_id === r.id && s.team_code === code);
      if (!mine.length || !tg) continue;
      const zones = new Map(gameZones.filter((z) => z.game_id === r.id && z.team_code === code).map((z) => [z.zone, z]));
      charts.push({
        key: `t-${r.id}-${code}`,
        kind: "team",
        game_id: r.id,
        date: r.game_date,
        name: code,
        team: code,
        opp,
        home: code === r.home_code,
        won: r.winner_code === code,
        team_score: tg.pts,
        opp_score: tg.opp_pts,
        fgm: tg.fgm,
        fga: tg.fga,
        tpm: tg.tpm,
        tpa: tg.tpa,
        pts: tg.pts,
        shots: mine.map(point),
        zones: ZONES.map((z) => {
          const row = zones.get(z);
          return { zone: z, fgm: row?.fgm ?? 0, fga: row?.fga ?? 0, fg_pct: row?.fg_pct ?? null, season_fg_pct: teamSeason.get(`${code}|${z}`) ?? null, lg_fg_pct: lg.get(z) ?? null };
        }),
      });
    }
  }
  return charts;
}

/** The matchup cards of one day's games (postponed games left out). */
function matchupsOf(d: TodayData, daysAhead: number): StudioMatchup[] {
  const pidx = new Map(d.players.map((p) => [`${p.team_code}|${p.name}`, p]));
  return d.tonight
    .filter((g) => !OFF.has(g.status))
    .map((g) => {
      const report = g.preview ? g.preview.injury_report : d.injuries.length ? d.day : null;
      const side = (code: string) => {
        const ts = d.teamSeason.get(code);
        const out = report
          ? d.injuries
              .filter((i) => i.team_code === code && (i.status === "Out" || i.status === "Doubtful"))
              .map((i) => ({ name: i.player_name, ppg: pidx.get(`${code}|${i.player_name}`)?.ppg ?? null, status: i.status }))
              .filter((x) => x.ppg !== null)
              .sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0))
          : [];
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
        key: String(g.id),
        code: g.code,
        days_ahead: daysAhead,
        report,
        game_id: g.id,
        date: g.game_date,
        time_et: tipTime(g),
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
}

const OFF = new Set(["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_CANCELLED", "STATUS_SUSPENDED"]);
