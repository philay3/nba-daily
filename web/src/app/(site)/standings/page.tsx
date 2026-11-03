import type { Metadata } from "next";
import Link from "next/link";

import { accentOf, Empty, NoDatabase } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getStandings, resolveDay, type Team, type TeamSeason } from "@/lib/data";
import { seasonLabel, signed, winPct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Standings" };

function Conference({ conf, rows, teams }: { conf: string; rows: TeamSeason[]; teams: Map<string, Team> }) {
  const list = rows.filter((r) => teams.get(r.team_code)?.conference === conf).sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
  const lead = list[0];
  const gb = (r: TeamSeason) => (lead ? (lead.w - r.w + (r.l - lead.l)) / 2 : 0);
  return (
    <div className="panel">
      <h2 className="section-title px-4 pt-4 text-[26px] sm:px-5">{conf}</h2>
      <div className="table-wrap mt-2">
        <table className="data-table">
          <caption className="sr-only">{conf} standings</caption>
          <thead>
            <tr>
              <th className="r">Seed</th>
              <th className="sticky-col">Team</th>
              <th className="r">W</th>
              <th className="r">L</th>
              <th className="r">PCT</th>
              <th className="r">GB</th>
              <th className="r">Net</th>
              <th>Streak</th>
              <th>Last 5</th>
              <th>Home</th>
              <th>Road</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const t = teams.get(r.team_code);
              const cut = r.seed === 7 || r.seed === 11;
              return (
                <tr key={r.team_code} className={cut ? "group-break" : undefined}>
                  <td className="r num text-ink-2">{r.seed}</td>
                  <td className="sticky-col">
                    <Link href={`/teams/${r.team_code}`} className="inline-flex items-center gap-2 font-semibold no-underline hover:underline">
                      <span aria-hidden className="h-4 w-[3px] rounded-[1px]" style={{ background: accentOf(t) }} />
                      {t?.display_name ?? r.team_code}
                    </Link>
                  </td>
                  <td className="r num">{r.w}</td>
                  <td className="r num">{r.l}</td>
                  <td className="r num">{winPct(r.w, r.l)}</td>
                  <td className="r num">{gb(r) === 0 ? "–" : gb(r).toFixed(1)}</td>
                  <td className="r num">{signed(r.net)}</td>
                  <td className="text-ink-2">{r.streak}</td>
                  <td className="num text-ink-2">{r.l5_rec}</td>
                  <td className="num text-ink-2">{r.home_rec}</td>
                  <td className="num text-ink-2">{r.road_rec}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function StandingsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof getStandings>>;
  try {
    const { day } = await resolveDay(sp.date);
    data = await getStandings(day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const { rows, teams, season } = data;
  const official = rows.some((r) => r.seed_source === "official");
  return (
    <div className="grid grid-cols-1 gap-8 pt-6 sm:pt-8">
      <header className="grid gap-2">
        <h1 className="display text-[56px] leading-[0.9] sm:text-[80px]">Standings</h1>
        <p className="note max-w-[72ch]">
          {seasonLabel(season)}. Lines mark the cut after seed 6 and seed 10: seeds 7 to 10 go to the play-in. GB is games behind the conference leader.{" "}
          {official ? "Seeds are the official ones, tiebreakers included." : "Seeds are by record; ties are broken by wins, then team code, until official seeds are supplied."}
        </p>
      </header>
      {rows.length ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Conference conf="East" rows={rows} teams={teams} />
          <Conference conf="West" rows={rows} teams={teams} />
        </div>
      ) : (
        <Empty title="No standings yet">They appear after the first games of the season are loaded.</Empty>
      )}
    </div>
  );
}
