import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Columns } from "@/components/charts/Bars";
import { accentOf, NoDatabase, PmBar, SectionHead } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getTeamPage, resolveDay } from "@/lib/data";
import { f1, monthDay, ordinal, seasonLabel, signed, signedInt, timeET } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { code } = await params;
  return { title: code.toUpperCase() };
}

function Big({ label, value, rank }: { label: string; value: string; rank?: number | null }) {
  return (
    <div className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="display text-[44px] leading-none">{value}</span>
      {rank ? <span className="text-[13px] text-ink-2">{ordinal(rank)} of 30</span> : null}
    </div>
  );
}

export default async function TeamPage({ params, searchParams }: { params: Params; searchParams: Promise<{ date?: string }> }) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof getTeamPage>>;
  try {
    const { day } = await resolveDay(sp.date);
    data = await getTeamPage(code, day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  if (!data) notFound();
  const { team, teams, row, log, roster, upcoming, season } = data;
  const accent = accentOf(team);
  const r = row as unknown as Record<string, number | null> | null;
  const factors: [string, string, string, string][] = [
    ["Effective FG %", "efg", "Opponent effective FG %", "opp_efg"],
    ["Turnover %", "tov_pct", "Forced turnover %", "opp_tov_pct"],
    ["Offensive rebound %", "orb_pct", "Defensive rebound %", "drb_pct"],
    ["Free throw rate", "ftr", "Opponent free throw rate", "opp_ftr"],
  ];
  const players = [...roster].sort((a, b) => (b.mpg ?? 0) - (a.mpg ?? 0));
  const maxAbs = Math.max(1, ...players.map((p) => Math.abs(p.pm_pg ?? 0)));
  return (
    <div className="grid grid-cols-1 gap-12 pt-6 sm:pt-8">
      <header className="panel panel-notch grid gap-6 p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <span aria-hidden className="h-[84px] w-3 rounded-[2px]" style={{ background: accent }} />
          <div className="grid gap-1">
            <h1 className="display text-[48px] leading-[0.9] sm:text-[72px]">{team.display_name}</h1>
            <p className="text-[14px] text-ink-2">
              {team.conference}
              {row ? (
                <>
                  <span className="num ml-3 text-ink">
                    {row.w}-{row.l}
                  </span>
                  <span className="ml-3">Seed {row.seed}</span>
                  <span className="ml-3">Home {row.home_rec}</span>
                  <span className="ml-3">Road {row.road_rec}</span>
                  <span className="ml-3">Last 5 {row.l5_rec}</span>
                  {row.streak ? <span className="ml-3">Streak {row.streak}</span> : null}
                </>
              ) : null}
              <span className="ml-3 text-muted">{seasonLabel(season)}</span>
            </p>
          </div>
        </div>
        {row ? (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Big label="Net rating" value={signed(row.net)} rank={row.net_rk} />
            <Big label="Offensive rating" value={f1(row.ortg)} rank={row.ortg_rk} />
            <Big label="Defensive rating" value={f1(row.drtg)} rank={row.drtg_rk} />
            <Big label="Pace" value={f1(row.pace)} rank={row.pace_rk} />
          </div>
        ) : (
          <p className="text-muted">No games yet this season.</p>
        )}
      </header>

      {r ? (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <SectionHead title="Four factors">Offense on the left, the same factor on defense on the right. Ranks are out of 30, 1 is best.</SectionHead>
            <div className="panel table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Offense</th>
                    <th className="r">Value</th>
                    <th className="r">Rank</th>
                    <th>Defense</th>
                    <th className="r">Value</th>
                    <th className="r">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {factors.map(([lo, ko, ld, kd]) => (
                    <tr key={ko}>
                      <td>{lo}</td>
                      <td className="r num font-semibold">{f1(r[ko])}</td>
                      <td className="r num text-ink-2">{ordinal(r[`${ko}_rk`])}</td>
                      <td>{ld}</td>
                      <td className="r num font-semibold">{f1(r[kd])}</td>
                      <td className="r num text-ink-2">{ordinal(r[`${kd}_rk`])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <SectionHead title="Net rating by game">Each column is one game: points scored minus allowed per 100 possessions.</SectionHead>
            <div className="panel p-4 sm:p-5">
              <Columns
                diverging
                width={640}
                height={220}
                points={log.map(({ tg, g }) => ({
                  key: String(g.id),
                  label: monthDay(tg.game_date),
                  value: tg.net,
                  title: `${monthDay(tg.game_date)} ${tg.home_away === "home" ? "vs" : "at"} ${tg.opp_code}: ${tg.win ? "W" : "L"} ${tg.pts}-${tg.opp_pts}, net ${signed(tg.net)}`,
                }))}
                avg={row?.net ?? null}
                avgLabel={`Season ${signed(row?.net)}`}
              />
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <SectionHead title="Game log">Per-game ratings use that game&apos;s possessions. Open a game for its box score.</SectionHead>
        <div className="panel table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="sticky-col">Opponent</th>
                <th>Result</th>
                <th className="r">Off rtg</th>
                <th className="r">Def rtg</th>
                <th className="r">Net</th>
                <th className="r">Pace</th>
                <th className="r">eFG%</th>
                <th className="r">TOV%</th>
                <th className="r">ORB%</th>
                <th className="r">FT rate</th>
                <th className="r">3PM</th>
                <th className="r">Bench</th>
              </tr>
            </thead>
            <tbody>
              {log.length ? (
                [...log].reverse().map(({ tg, g }) => (
                  <tr key={g.id}>
                    <td className="num text-ink-2">{monthDay(tg.game_date)}</td>
                    <td className="sticky-col">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-5 text-muted">{tg.home_away === "home" ? "vs" : "at"}</span>
                        <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(tg.opp_code)) }} />
                        <Link href={`/teams/${tg.opp_code}`} className="font-semibold no-underline hover:underline">
                          {tg.opp_code}
                        </Link>
                      </span>
                    </td>
                    <td className="num">
                      <Link href={`/games/${g.id}`} className="no-underline hover:underline">
                        <span className={tg.win ? "font-semibold text-ink" : "text-ink-2"}>{tg.win ? "W" : "L"}</span> {tg.pts}-{tg.opp_pts}
                        {g.ot ? <span className="text-muted"> {g.ot === 1 ? "OT" : `${g.ot}OT`}</span> : null}
                      </Link>
                    </td>
                    <td className="r num">{f1(tg.ortg)}</td>
                    <td className="r num">{f1(tg.drtg)}</td>
                    <td className="r num font-semibold">{signed(tg.net)}</td>
                    <td className="r num">{f1(tg.pace)}</td>
                    <td className="r num">{f1(tg.efg)}</td>
                    <td className="r num">{f1(tg.tov_pct)}</td>
                    <td className="r num">{f1(tg.orb_pct)}</td>
                    <td className="r num">{f1(tg.ftr)}</td>
                    <td className="r num">{tg.tpm}</td>
                    <td className="r num">{tg.bench_pts}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={13} className="text-muted">
                    No games yet this season.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHead title="Roster">Season averages, most minutes first. Plus-minus is the scoring margin while he is on the floor.</SectionHead>
        <div className="panel table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sticky-col">Player</th>
                <th>Pos</th>
                <th className="r">GP</th>
                <th className="r">GS</th>
                <th className="r">MIN</th>
                <th className="r">PTS</th>
                <th className="r">REB</th>
                <th className="r">AST</th>
                <th className="r">STL</th>
                <th className="r">BLK</th>
                <th className="r">FG%</th>
                <th className="r">3P%</th>
                <th className="r">TS%</th>
                <th className="r">+/- per game</th>
                <th className="r">+/- total</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.player_id}>
                  <td className="sticky-col">
                    <Link href={`/players/${p.player_id}`} className="font-semibold no-underline hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="text-muted">{p.position}</td>
                  <td className="r num">{p.gp}</td>
                  <td className="r num">{p.gs}</td>
                  <td className="r num">{f1(p.mpg)}</td>
                  <td className="r num font-semibold">{f1(p.ppg)}</td>
                  <td className="r num">{f1(p.rpg)}</td>
                  <td className="r num">{f1(p.apg)}</td>
                  <td className="r num">{f1(p.spg)}</td>
                  <td className="r num">{f1(p.bpg)}</td>
                  <td className="r num">{f1(p.fg_pct)}</td>
                  <td className="r num">{f1(p.fg3_pct)}</td>
                  <td className="r num">{f1(p.ts_pct)}</td>
                  <td className="r">
                    <PmBar value={p.pm_pg} maxAbs={maxAbs} digits={1} />
                  </td>
                  <td className="r num">{signedInt(p.pm_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {upcoming.length ? (
        <section>
          <SectionHead title="Next games" />
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {upcoming.map((g) => {
              const home = g.home_code === code;
              const opp = home ? g.away_code : g.home_code;
              return (
                <li key={g.id} className="panel grid gap-1 p-4">
                  <span className="text-[13px] text-muted">
                    {monthDay(g.game_date)}, {timeET(g.tip)} ET
                  </span>
                  <Link href={`/games/${g.id}`} className="inline-flex items-center gap-2 font-semibold no-underline hover:underline">
                    <span className="text-muted">{home ? "vs" : "at"}</span>
                    <span aria-hidden className="h-4 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(opp)) }} />
                    {opp}
                  </Link>
                  <span className="text-[13px] text-ink-2">{g.tv}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
