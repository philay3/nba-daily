import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Columns } from "@/components/charts/Bars";
import { coverageNote, ShotPanel } from "@/components/shots/ShotPanel";
import { accentOf, DeltaMark, NoDatabase, PmBar, SectionHead } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getPlayerPage, resolveDay, type OnOff, type PlayerClutch, type Team, type TeamClutch } from "@/lib/data";
import { minutesOf } from "@/lib/flow";
import { addDays, f1, monthDay, pctText, seasonLabel, signed, signedInt } from "@/lib/format";
import { shotTitle } from "@/lib/shots";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Player ${id}` };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="display text-[40px] leading-none">{value}</span>
    </div>
  );
}

const SAMPLE_POSS = 50;

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="display text-[34px] leading-none">{value}</span>
      {sub ? <span className="text-[13px] text-ink-2">{sub}</span> : null}
    </div>
  );
}

function OnOffPanel({ rows, teams }: { rows: OnOff[]; teams: Map<string, Team> }) {
  return (
    <div>
      <SectionHead title="On and off the floor">
        His team&apos;s points scored and allowed per 100 possessions with him on the floor and off it, in the games he played.
      </SectionHead>
      <div className="grid gap-4">
        {rows.map((r) => {
          const small = Math.min(r.on_poss, r.off_poss) < SAMPLE_POSS;
          return (
            <div key={r.team_code} className="panel grid gap-5 p-5">
              {rows.length > 1 ? <span className="text-[13px] font-semibold text-ink-2">With {teams.get(r.team_code)?.display_name ?? r.team_code}</span> : null}
              <div className="grid grid-cols-3 gap-4">
                <Mini label="Net rating on" value={signed(r.on_net)} sub={`${minutesOf(r.on_secs)} minutes`} />
                <Mini label="Net rating off" value={signed(r.off_net)} sub={`${minutesOf(r.off_secs)} minutes`} />
                <Mini label="On-off" value={signed(r.on_off)} sub={`${r.games} ${r.games === 1 ? "game" : "games"}`} />
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th className="r">MIN</th>
                      <th className="r">Poss</th>
                      <th className="r">Off rtg</th>
                      <th className="r">Def rtg</th>
                      <th className="r">Net</th>
                      <th className="r">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ["On the floor", r.on_secs, r.on_poss, r.on_ortg, r.on_drtg, r.on_net, r.on_pts, r.on_opp_pts],
                        ["Off the floor", r.off_secs, r.off_poss, r.off_ortg, r.off_drtg, r.off_net, r.off_pts, r.off_opp_pts],
                      ] as const
                    ).map(([label, secs, poss, o, d, n, pts, opp]) => (
                      <tr key={label}>
                        <td>{label}</td>
                        <td className="r num">{minutesOf(secs)}</td>
                        <td className="r num">{f1(poss)}</td>
                        <td className="r num">{f1(o)}</td>
                        <td className="r num">{f1(d)}</td>
                        <td className="r num font-semibold">{signed(n)}</td>
                        <td className="r num">
                          {pts}-{opp}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {small ? <p className="note">Fewer than {SAMPLE_POSS} possessions on one side: a small sample.</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClutchPanel({ rows, teamClutch, teams }: { rows: PlayerClutch[]; teamClutch: Map<string, TeamClutch>; teams: Map<string, Team> }) {
  return (
    <div>
      <SectionHead title="Clutch time">The last 5 minutes of the 4th quarter or overtime with the score within 5.</SectionHead>
      <div className="grid gap-4">
        {rows.length ? (
          rows.map((r) => {
            const tc = teamClutch.get(r.team_code);
            return (
              <div key={r.team_code} className="panel grid gap-5 p-5">
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                  <Mini label="Points" value={String(r.pts)} sub={`${minutesOf(r.secs)} minutes, ${r.games} ${r.games === 1 ? "game" : "games"}`} />
                  <Mini label="Field goals" value={`${r.fgm}-${r.fga}`} sub={r.fga ? pctText(r.fg_pct) : "No shots"} />
                  <Mini label="Plus-minus" value={signedInt(r.pm)} sub="on the floor" />
                  <Mini label="Net rating" value={signed(r.net)} sub={`${f1(r.poss)} possessions`} />
                </div>
                <p className="text-[14px] text-ink-2">
                  Threes {r.tpm}-{r.tpa}, free throws {r.ftm}-{r.fta}.
                  {tc ? ` The ${teams.get(r.team_code)?.nickname ?? r.team_code} are ${tc.w}-${tc.l} in games with clutch time.` : ""}
                </p>
              </div>
            );
          })
        ) : (
          <div className="panel p-5 text-[14px] text-muted">No clutch minutes yet this season.</div>
        )}
      </div>
    </div>
  );
}

export default async function PlayerPage({ params, searchParams }: { params: Params; searchParams: Promise<{ date?: string; shots?: string }> }) {
  const { id } = await params;
  const pid = Number(id);
  if (!Number.isFinite(pid)) notFound();
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof getPlayerPage>>;
  try {
    const { day } = await resolveDay(sp.date);
    data = await getPlayerPage(pid, day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  if (!data) notFound();
  const { player, teams, row, log, season, shots, zones, onOff, clutch, teamClutch } = data;
  const team = teams.get(row?.team_code ?? player.team_code ?? "");
  const asOf = zones[0]?.as_of;
  const fga = log.filter(({ g }) => !asOf || g.game_date < asOf).reduce((n, { pg }) => n + (pg.fga ?? 0), 0);
  const games = log.filter(({ pg }) => !pg.did_not_play);
  const maxAbs = Math.max(1, ...games.map(({ pg }) => Math.abs(pg.plus_minus ?? 0)));
  return (
    <div className="grid grid-cols-1 gap-12 pt-6 sm:pt-8">
      <header className="panel panel-notch grid gap-6 p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <span aria-hidden className="h-[84px] w-3 rounded-[2px]" style={{ background: accentOf(team) }} />
          <div className="grid gap-1">
            <h1 className="display text-[48px] leading-[0.9] sm:text-[72px]">{player.name}</h1>
            <p className="text-[14px] text-ink-2">
              {team ? (
                <Link href={`/teams/${team.code}`} className="text-ink">
                  {team.display_name}
                </Link>
              ) : null}
              {player.position ? <span className="ml-3">{player.position}</span> : null}
              {player.jersey ? <span className="ml-3">#{player.jersey}</span> : null}
              <span className="ml-3 text-muted">{seasonLabel(season)}</span>
            </p>
          </div>
        </div>
        {row ? (
          <div className="grid grid-cols-3 gap-6 sm:grid-cols-6">
            <Stat label="Points" value={f1(row.ppg)} />
            <Stat label="Rebounds" value={f1(row.rpg)} />
            <Stat label="Assists" value={f1(row.apg)} />
            <Stat label="True shooting" value={f1(row.ts_pct)} />
            <Stat label="+/- per game" value={signed(row.pm_pg)} />
            <Stat label="Games" value={`${row.gp}`} />
          </div>
        ) : (
          <p className="text-muted">No games this season.</p>
        )}
      </header>

      {zones.length ? (
        <section>
          <SectionHead title="Shot chart">
            Every field goal attempt this season{asOf ? ` through ${monthDay(addDays(asOf, -1))}` : ""}, basket at the top. The second view sizes each spot by his attempts
            and colors it by his FG% from that zone against the league average.
          </SectionHead>
          <ShotPanel
            wide
            label={`${player.name} shots`}
            shots={shots.map((s) => ({ ...s, title: `${monthDay(s.game_date)} vs ${s.opp_code}: ${shotTitle(s)}` }))}
            zones={zones}
            madeColor={accentOf(team)}
            initial={sp.shots === "hex" ? "hex" : "dots"}
            note={coverageNote(shots.length, fga)}
          />
        </section>
      ) : null}

      {games.length ? (
        <section id="trend" className="grid scroll-mt-20 gap-5 lg:grid-cols-2">
          <div>
            <SectionHead title="Points by game">The line is his season average.</SectionHead>
            <div className="panel p-4 sm:p-5">
              <Columns
                width={560}
                height={220}
                color={accentOf(team)}
                points={games.map(({ pg, g }) => ({
                  key: String(g.id),
                  label: monthDay(pg.game_date),
                  value: pg.pts,
                  title: `${monthDay(pg.game_date)} ${pg.home_away === "home" ? "vs" : "at"} ${pg.opp_code}: ${pg.pts} pts, ${pg.reb} reb, ${pg.ast} ast`,
                }))}
                avg={row?.ppg ?? null}
                avgLabel={`Season ${f1(row?.ppg)}`}
              />
            </div>
          </div>
          <div>
            <SectionHead title="Plus-minus by game">Score change while he was on the floor.</SectionHead>
            <div className="panel p-4 sm:p-5">
              <Columns
                diverging
                width={560}
                height={220}
                points={games.map(({ pg, g }) => ({
                  key: String(g.id),
                  label: monthDay(pg.game_date),
                  value: pg.plus_minus,
                  title: `${monthDay(pg.game_date)} ${pg.home_away === "home" ? "vs" : "at"} ${pg.opp_code}: ${signedInt(pg.plus_minus)} in ${Math.round(pg.min ?? 0)} min`,
                }))}
                avg={row?.pm_pg ?? null}
                avgLabel={`Season ${signed(row?.pm_pg)} per game`}
              />
            </div>
          </div>
        </section>
      ) : null}

      {onOff.length ? (
        <section className="grid gap-5 lg:grid-cols-2">
          <OnOffPanel rows={onOff} teams={teams} />
          <ClutchPanel rows={clutch} teamClutch={teamClutch} teams={teams} />
        </section>
      ) : null}

      <section>
        <SectionHead title="Game log">Arrows mark games well above or below his average before that game.</SectionHead>
        <div className="panel table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="sticky-col">Opponent</th>
                <th>Result</th>
                <th className="r">MIN</th>
                <th className="r">PTS</th>
                <th className="r">REB</th>
                <th className="r">AST</th>
                <th className="r">STL</th>
                <th className="r">BLK</th>
                <th className="r">TO</th>
                <th className="r">FG</th>
                <th className="r">3PT</th>
                <th className="r">FT</th>
                <th className="r">TS%</th>
                <th className="r">+/-</th>
                <th>What stood out</th>
              </tr>
            </thead>
            <tbody>
              {[...log].reverse().map(({ pg, d, g }) => {
                const dnp = pg.did_not_play;
                const won = g.winner_code === pg.team_code;
                const us = pg.home_away === "home" ? g.home_score : g.away_score;
                const them = pg.home_away === "home" ? g.away_score : g.home_score;
                return (
                  <tr key={g.id}>
                    <td className="num text-ink-2">{monthDay(pg.game_date)}</td>
                    <td className="sticky-col">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-5 text-muted">{pg.home_away === "home" ? "vs" : "at"}</span>
                        <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(pg.opp_code)) }} />
                        <span className="font-semibold">{pg.opp_code}</span>
                      </span>
                    </td>
                    <td className="num">
                      <Link href={`/games/${g.id}`} className="no-underline hover:underline">
                        <span className={won ? "font-semibold" : "text-ink-2"}>{won ? "W" : "L"}</span> {us}-{them}
                      </Link>
                    </td>
                    {dnp ? (
                      <td colSpan={13} className="text-muted">
                        Did not play{pg.reason ? `: ${pg.reason.charAt(0)}${pg.reason.slice(1).toLowerCase()}` : ""}
                      </td>
                    ) : (
                      <>
                        <td className="r num">{Math.round(pg.min ?? 0)}</td>
                        <td className="r num font-bold">
                          {pg.pts}
                          <DeltaMark delta={d?.d_pts} threshold={8} />
                        </td>
                        <td className="r num">
                          {pg.reb}
                          <DeltaMark delta={d?.d_reb} threshold={5} />
                        </td>
                        <td className="r num">
                          {pg.ast}
                          <DeltaMark delta={d?.d_ast} threshold={4} />
                        </td>
                        <td className="r num">{pg.stl}</td>
                        <td className="r num">{pg.blk}</td>
                        <td className="r num">{pg.tov}</td>
                        <td className="r num">
                          {pg.fgm}-{pg.fga}
                        </td>
                        <td className="r num">
                          {pg.tpm}-{pg.tpa}
                        </td>
                        <td className="r num">
                          {pg.ftm}-{pg.fta}
                        </td>
                        <td className="r num">{f1(pg.ts_pct)}</td>
                        <td className="r">
                          <PmBar value={pg.plus_minus} maxAbs={maxAbs} />
                        </td>
                        <td className="text-ink-2">{(d?.flags ?? "").split(" · ").filter(Boolean).join(", ")}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
