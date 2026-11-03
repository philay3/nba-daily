import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Columns } from "@/components/charts/Bars";
import { coverageNote, ShotPanel, ZoneCompare } from "@/components/shots/ShotPanel";
import { accentOf, NoDatabase, PmBar, SectionHead } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getTeamPage, resolveDay, type LineupSeason, type OnOff, type PlayerClutch, type PlayerName, type PlayerSeason, type TeamClutch } from "@/lib/data";
import { CHART } from "@/lib/colors";
import { minutesOf } from "@/lib/flow";
import { addDays, f1, monthDay, ordinal, pctText, seasonLabel, signed, signedInt, timeET } from "@/lib/format";

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

const LINEUP_MIN_POSS = 50;
const SAMPLE_POSS = 50; // on/off rows with fewer possessions on or off the floor are greyed out
const BAR_MAX = 30; // net ratings past +/-30 fill the bar

function shortName(id: number, names: Map<number, PlayerName>): string {
  const p = names.get(id);
  return p?.short_name || p?.name || String(id);
}

/** A lineup's five names, regulars first (most minutes per game on this team). */
function lineupNames(l: LineupSeason, names: Map<number, PlayerName>, mpg: Map<number, number>): string {
  return [...l.player_ids]
    .sort((a, b) => (mpg.get(b) ?? -1) - (mpg.get(a) ?? -1))
    .map((id) => shortName(id, names))
    .join(", ");
}

function LineupTable({ rows, names, mpg }: { rows: LineupSeason[]; names: Map<number, PlayerName>; mpg: Map<number, number> }) {
  return (
    <div className="panel table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="sticky-col">Lineup</th>
            <th className="r">GP</th>
            <th className="r">MIN</th>
            <th className="r">Poss</th>
            <th className="r">Off rtg</th>
            <th className="r">Def rtg</th>
            <th className="r">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.lineup_id}>
              <td className="sticky-col">{lineupNames(l, names, mpg)}</td>
              <td className="r num">{l.games}</td>
              <td className="r num">{minutesOf(l.secs)}</td>
              <td className="r num">{f1(l.poss)}</td>
              <td className="r num">{f1(l.ortg)}</td>
              <td className="r num">{f1(l.drtg)}</td>
              <td className="r">
                <PmBar value={l.net} maxAbs={BAR_MAX} digits={1} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Lineups({ lineups, names, roster }: { lineups: LineupSeason[]; names: Map<number, PlayerName>; roster: PlayerSeason[] }) {
  const mpg = new Map(roster.map((p) => [p.player_id, p.mpg ?? 0]));
  const top = lineups.filter((l) => l.poss >= LINEUP_MIN_POSS).sort((a, b) => (b.net ?? 0) - (a.net ?? 0)).slice(0, 10);
  const used = [...lineups].sort((a, b) => b.poss - a.poss).slice(0, 3);
  return (
    <div>
      <SectionHead title="Top lineups">
        Five-man units with at least {LINEUP_MIN_POSS} possessions together, best net rating first. Ratings are points per 100 possessions, rebuilt from the
        play-by-play.
      </SectionHead>
      {top.length ? (
        <LineupTable rows={top} names={names} mpg={mpg} />
      ) : used.length ? (
        <div className="grid gap-3">
          <p className="note">No lineup has {LINEUP_MIN_POSS} possessions together yet. The most used so far:</p>
          <LineupTable rows={used} names={names} mpg={mpg} />
        </div>
      ) : (
        <p className="note">No play-by-play for this team yet.</p>
      )}
    </div>
  );
}

function ClutchStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="display text-[36px] leading-none">{value}</span>
      {sub ? <span className="text-[13px] text-ink-2">{sub}</span> : null}
    </div>
  );
}

function Clutch({ team, clutch, players, names }: { team: string; clutch: TeamClutch | null; players: PlayerClutch[]; names: Map<number, PlayerName> }) {
  const scorers = players.filter((p) => p.pts > 0 || p.fga > 0).slice(0, 5);
  return (
    <div>
      <SectionHead title="Clutch time">The last 5 minutes of the 4th quarter or overtime with the score within 5.</SectionHead>
      <div className="panel grid gap-5 p-5">
        {clutch ? (
          <>
            <div className="grid grid-cols-2 gap-5">
              <ClutchStat label="Record in clutch games" value={`${clutch.w}-${clutch.l}`} sub={`${clutch.games} ${clutch.games === 1 ? "game" : "games"}, ${minutesOf(clutch.secs)} minutes`} />
              <ClutchStat label="Plus-minus" value={signedInt(clutch.pm)} sub={`${clutch.pts} scored, ${clutch.opp_pts} allowed`} />
              <ClutchStat label="Net rating" value={signed(clutch.net)} sub={`${f1(clutch.poss)} possessions`} />
              <ClutchStat label="Field goals" value={`${clutch.fgm}-${clutch.fga}`} sub={clutch.fga ? pctText(clutch.fg_pct) : "No shots"} />
            </div>
            {scorers.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th className="r">PTS</th>
                      <th className="r">FG</th>
                      <th className="r">MIN</th>
                      <th className="r">+/-</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scorers.map((p) => (
                      <tr key={p.player_id}>
                        <td>
                          <Link href={`/players/${p.player_id}`} className="font-semibold no-underline hover:underline">
                            {names.get(p.player_id)?.name ?? p.player_id}
                          </Link>
                        </td>
                        <td className="r num font-semibold">{p.pts}</td>
                        <td className="r num">
                          {p.fgm}-{p.fga}
                        </td>
                        <td className="r num">{minutesOf(p.secs)}</td>
                        <td className="r num">{signedInt(p.pm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[14px] text-muted">{team} has not played a clutch minute yet this season.</p>
        )}
      </div>
    </div>
  );
}

function OnOffTable({ rows, names }: { rows: OnOff[]; names: Map<number, PlayerName> }) {
  return (
    <section>
      <SectionHead title="On and off the floor">
        Team points scored and allowed per 100 possessions with each player on the floor and off it, in the games he played. On-off is the difference in net
        rating. Small samples swing a lot: grey rows have fewer than {SAMPLE_POSS} possessions on or off the floor.
      </SectionHead>
      <div className="panel table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="sticky-col">Player</th>
              <th className="r">GP</th>
              <th className="r">MIN on</th>
              <th className="r">Off rtg on</th>
              <th className="r">Def rtg on</th>
              <th className="r">Net on</th>
              <th className="r">MIN off</th>
              <th className="r">Net off</th>
              <th className="r">On-off</th>
              <th className="r">+/- on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.player_id} className={Math.min(r.on_poss, r.off_poss) < SAMPLE_POSS ? "text-muted" : undefined}>
                <td className="sticky-col">
                  <Link href={`/players/${r.player_id}`} className="font-semibold no-underline hover:underline">
                    {names.get(r.player_id)?.name ?? r.player_id}
                  </Link>
                </td>
                <td className="r num">{r.games}</td>
                <td className="r num">{minutesOf(r.on_secs)}</td>
                <td className="r num">{f1(r.on_ortg)}</td>
                <td className="r num">{f1(r.on_drtg)}</td>
                <td className="r num font-semibold">{signed(r.on_net)}</td>
                <td className="r num">{minutesOf(r.off_secs)}</td>
                <td className="r num">{signed(r.off_net)}</td>
                <td className="r">
                  <PmBar value={r.on_off} maxAbs={BAR_MAX} digits={1} />
                </td>
                <td className="r num">{signedInt(r.pm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function TeamPage({ params, searchParams }: { params: Params; searchParams: Promise<{ date?: string; shots?: string }> }) {
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
  const { team, teams, row, log, roster, upcoming, season, shots, zones, lineups, onOff, clutch, playerClutch, names } = data;
  const accent = accentOf(team);
  const view = sp.shots === "dots" ? "dots" : "hex"; // a season of shots reads best as hexes
  const asOf = zones[0]?.as_of;
  const side = (s: string) => zones.filter((z) => z.side === s);
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

      {zones.length ? (
        <section>
          <SectionHead title="Shot profile">
            Where the {team.nickname} shoot, and where opponents shoot against them, this season{asOf ? ` through ${monthDay(addDays(asOf, -1))}` : ""}. The second
            view sizes each spot by attempts and colors it by FG% from that zone against the league average.
          </SectionHead>
          <div className="grid gap-5 lg:grid-cols-2">
            <ShotPanel
              table={false}
              label={`${team.display_name} offense`}
              head={<h3 className="text-[15px] font-semibold">Offense: their shots</h3>}
              shots={shots.offense}
              zones={side("offense")}
              madeColor={accent}
              initial={view}
              note={coverageNote(shots.offense.length, log.reduce((n, { tg }) => n + tg.fga, 0))}
            />
            <ShotPanel
              table={false}
              label={`${team.display_name} defense`}
              head={<h3 className="text-[15px] font-semibold">Defense: opponents&apos; shots</h3>}
              shots={shots.defense}
              zones={side("defense")}
              madeColor={CHART.ink2}
              initial={view}
              note={`${shots.defense.length} opponent shots in ${log.length} games. Below the league here is good defense.`}
            />
          </div>
          <div className="mt-5">
            <ZoneCompare
              caption={`${team.display_name} shots by zone on offense and defense, against the league`}
              sides={[
                { label: "Offense", rows: side("offense") },
                { label: "Defense: opponents", rows: side("defense") },
              ]}
            />
          </div>
        </section>
      ) : null}

      {row ? (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Lineups lineups={lineups} names={names} roster={roster} />
          <Clutch team={team.nickname} clutch={clutch} players={playerClutch} names={names} />
        </section>
      ) : null}

      {onOff.length ? <OnOffTable rows={onOff} names={names} /> : null}

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
