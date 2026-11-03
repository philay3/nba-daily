import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { QuarterFlow } from "@/components/charts/QuarterFlow";
import { BoxScore } from "@/components/game/BoxScore";
import { accentOf, Empty, NoDatabase, SectionHead, StatusBadge, TeamMark } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getGamePage, type Game, type Gap, type Team } from "@/lib/data";
import { addDays, f1, longDate, ordinal, signed, timeET } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Game ${id}` };
}

function ZBar({ z }: { z: number }) {
  const max = 3;
  const w = Math.min(z, max) / max;
  return (
    <span aria-hidden className="relative block h-2 w-28 rounded bg-line">
      <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${w * 100}%`, background: z >= 1.5 ? "var(--color-clock)" : "var(--color-ink-2)" }} />
      <span className="absolute inset-y-[-3px] w-px bg-muted" style={{ left: `${(1 / max) * 100}%` }} />
      <span className="absolute inset-y-[-3px] w-px bg-muted" style={{ left: `${(1.5 / max) * 100}%` }} />
    </span>
  );
}

function KeyGaps({ gaps }: { gaps: Gap[] }) {
  const top = gaps.filter((g) => g.level).sort((a, b) => b.z - a.z).slice(0, 5);
  if (!top.length) return <p className="text-[14px] text-muted">No team stat was far from a normal game.</p>;
  return (
    <ul className="grid gap-3">
      {top.map((g) => (
        <li key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-l-2 pl-3" style={{ borderColor: g.level === "Major" ? "var(--color-clock)" : "var(--color-line-strong)" }}>
          <span className="font-semibold">{g.stat}</span>
          <span className={`text-[12px] font-semibold ${g.level === "Major" ? "text-clock" : "text-ink-2"}`}>{g.level}</span>
          <span className="num text-[14px] text-ink-2">
            {g.away_code} {g.away_txt}, {g.home_code} {g.home_txt}
            <span className="ml-2 text-muted">{g.edge_txt === "Even" ? "even" : `edge ${g.edge_txt}`}</span>
          </span>
          <span className="flex items-center gap-2 text-[12px] text-muted" title={`${g.z.toFixed(2)} times the usual gap`}>
            <ZBar z={g.z} />
            <span className="num w-9 text-right">{g.z.toFixed(1)}x</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Side({ code, score, right, final, game, teams }: { code: string; score: number | null; right?: boolean; final: boolean; game: Game; teams: Map<string, Team> }) {
  const t = teams.get(code);
  const won = !final || game.winner_code === code;
  const before = right ? game.home_record_before : game.away_record_before;
  return (
    <div className={`flex items-center gap-3 sm:gap-5 ${right ? "flex-row-reverse text-right" : ""}`}>
      <span aria-hidden className="h-[72px] w-2.5 rounded-[2px] sm:h-[104px]" style={{ background: accentOf(t) }} />
      <div className={`grid ${right ? "justify-items-end" : ""}`}>
        <Link href={`/teams/${code}`} className="display text-[40px] leading-none no-underline sm:text-[56px]">
          {code}
        </Link>
        <span className="text-[13px] text-ink-2">
          {t?.nickname}
          {before ? ` (${before} entering)` : ""}
        </span>
      </div>
      {final ? <span className={`display num text-[72px] leading-none sm:text-[112px] ${won ? "" : "opacity-50"}`}>{score}</span> : null}
    </div>
  );
}

export default async function GamePage({ params }: { params: Params }) {
  const { id } = await params;
  const gid = Number(id);
  if (!Number.isInteger(gid)) notFound();
  let data: Awaited<ReturnType<typeof getGamePage>>;
  try {
    data = await getGamePage(gid);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  if (!data) notFound();
  const { game: g, teams, away, home, box, gaps, note, odds, injuries, teamSeason } = data;
  const a = teams.get(g.away_code);
  const h = teams.get(g.home_code);
  const final = g.status === "STATUS_FINAL" && away && home;
  const ac = accentOf(a);
  const hc = accentOf(h);
  const loser = g.winner_code === g.away_code ? g.home_code : g.away_code;
  const loserLead = loser === g.away_code ? away?.largest_lead : home?.largest_lead;

  return (
    <div className="grid grid-cols-1 gap-10 pt-6 sm:pt-8">
      <section className="grid gap-5">
        <p className="text-[13px] text-muted">
          <Link href={`/?date=${addDays(g.game_date, 1)}`} className="text-ink-2">
            {longDate(g.game_date)}
          </Link>
          {g.venue ? (
            <span className="ml-3">
              {g.venue}
              {g.city ? `, ${g.city}` : ""}
            </span>
          ) : null}
          <span className="ml-3">{g.tv}</span>
        </p>
        <div className="panel panel-notch grid gap-6 p-5 sm:p-8">
          <h1 className="sr-only">
            {a?.display_name} at {h?.display_name}
          </h1>
          <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
            <Side code={g.away_code} score={g.away_score} final={Boolean(final)} game={g} teams={teams} />
            <div className="text-center text-[13px] font-semibold text-muted">
              {final ? (g.ot ? (g.ot === 1 ? "Final, overtime" : `Final, ${g.ot} overtimes`) : "Final") : `${timeET(g.tip)} ET`}
            </div>
            <Side code={g.home_code} score={g.home_score} right final={Boolean(final)} game={g} teams={teams} />
          </div>
          {final ? (
            <div className="flex flex-wrap gap-2">
              <span className="chip num">Lead changes {g.lead_changes}</span>
              <span className="chip num">
                Largest leads {g.away_code} {away?.largest_lead}, {g.home_code} {home?.largest_lead}
              </span>
              {odds?.line ? <span className="chip num">Line {odds.line}</span> : null}
              {g.upset ? <span className="chip text-clock">Upset by record</span> : null}
              {(loserLead ?? 0) >= 10 ? (
                <span className="chip text-clock">
                  Comeback: {loser} led by {loserLead}
                </span>
              ) : null}
            </div>
          ) : null}
          {note ? <p className="max-w-[72ch] text-[17px] leading-relaxed">{note}</p> : null}
        </div>
      </section>

      {final ? (
        <>
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="panel p-4 sm:p-6">
              <h2 className="section-title text-[24px]">Quarter flow</h2>
              <p className="note mb-4">Margin after each period. Above the line {g.away_code} led, below it {g.home_code} led.</p>
              <div className="hidden sm:block">
                <QuarterFlow away={g.away_code} home={g.home_code} awayPeriods={g.away_periods} homePeriods={g.home_periods} awayColor={ac} homeColor={hc} width={720} height={240} font={13} />
              </div>
              <div className="sm:hidden">
                <QuarterFlow away={g.away_code} home={g.home_code} awayPeriods={g.away_periods} homePeriods={g.home_periods} awayColor={ac} homeColor={hc} width={340} height={170} font={11} />
              </div>
              <div className="table-wrap mt-4">
                <table className="data-table">
                  <caption className="sr-only">Score by period</caption>
                  <thead>
                    <tr>
                      <th>Team</th>
                      {g.away_periods.map((_, i) => (
                        <th key={i} className="r">
                          {i < 4 ? `Q${i + 1}` : i === 4 ? "OT" : `${i - 3}OT`}
                        </th>
                      ))}
                      <th className="r">Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      [g.away_code, g.away_periods, g.away_score],
                      [g.home_code, g.home_periods, g.home_score],
                    ].map(([code, per, score]) => (
                      <tr key={String(code)}>
                        <td>
                          <TeamMark team={teams.get(String(code))} code={String(code)} />
                        </td>
                        {(per as number[]).map((p, i) => (
                          <td key={i} className="r num">
                            {p}
                          </td>
                        ))}
                        <td className="r num font-bold">{score as number}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel p-4 sm:p-6">
              <h2 className="section-title text-[24px]">Where it was decided</h2>
              <p className="note mb-4">The biggest team gaps, measured against how far apart two teams usually are in a game this season. Major is 1.5 times the usual gap or more; notable is 1 time.</p>
              <KeyGaps gaps={gaps} />
            </div>
          </section>

          <section>
            <SectionHead title="Box scores">
              Arrows mark points, rebounds or assists well above or below his average before this game. Plus-minus is the score change while he was on the floor.
            </SectionHead>
            <div className="grid gap-6">
              <BoxScore team={a} code={g.away_code} lines={box} totals={away} />
              <BoxScore team={h} code={g.home_code} lines={box} totals={home} />
            </div>
          </section>

          <section>
            <SectionHead title="Team stats">Road team first. Gap size compares this gap with the usual gap between two teams in a game this season.</SectionHead>
            <div className="panel table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th className="sticky-col">Stat</th>
                    <th className="r">{g.away_code}</th>
                    <th className="r">{g.home_code}</th>
                    <th>Edge</th>
                    <th className="r">Gap</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {[...gaps].sort((x, y) => (x.sort_order % 100) - (y.sort_order % 100)).map((r) => (
                    <tr key={r.key}>
                      <td className="text-muted">{r.grp}</td>
                      <td className={`sticky-col ${r.level === "Major" ? "font-semibold" : ""}`}>{r.stat}</td>
                      <td className="r num">{r.away_txt}</td>
                      <td className="r num">{r.home_txt}</td>
                      <td>{r.edge_txt}</td>
                      <td className="r num">{r.gap_txt}</td>
                      <td className={r.level === "Major" ? "font-semibold text-clock" : "text-ink-2"}>{r.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="grid gap-5">
          <Empty title={g.status === "STATUS_FINAL" ? "The box score for this game is not loaded yet" : "This game has not been played yet"}>
            {g.status === "STATUS_FINAL" ? (
              <>The daily pipeline adds it after the hoopR mirror updates (about 2 a.m. Eastern).</>
            ) : (
              <>
                Tip-off {timeET(g.tip)} ET on {longDate(g.game_date)}.{" "}
                <Link href={`/?date=${g.game_date}&game=${encodeURIComponent(g.code)}#matchup`}>Open the matchup breakdown</Link>.
              </>
            )}
          </Empty>
          <div className="grid gap-5 md:grid-cols-2">
            {[g.away_code, g.home_code].map((code) => {
              const ts = teamSeason.get(code);
              return (
                <div key={code} className="panel grid gap-2 p-5">
                  <TeamMark team={teams.get(code)} code={code} label={teams.get(code)?.display_name} />
                  {ts ? (
                    <p className="num text-[14px] text-ink-2">
                      {ts.w}-{ts.l}, net {signed(ts.net)} ({ordinal(ts.net_rk)}), offense {f1(ts.ortg)} ({ordinal(ts.ortg_rk)}), defense {f1(ts.drtg)} ({ordinal(ts.drtg_rk)})
                    </p>
                  ) : (
                    <p className="text-[14px] text-muted">No games yet this season.</p>
                  )}
                  <ul className="grid gap-1 text-[14px]">
                    {injuries
                      .filter((i) => i.team_code === code)
                      .map((i) => (
                        <li key={i.player_name} className="flex gap-2">
                          <span>{i.player_name}</span>
                          <StatusBadge status={i.status} />
                        </li>
                      ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
