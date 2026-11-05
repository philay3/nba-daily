import type { Metadata } from "next";
import Link from "next/link";

import { RatingsLines, type RatingSeries } from "@/components/charts/RatingsLines";
import { accentOf, Empty, NoDatabase, PmBar, SectionHead } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getRatingsPage, resolveDay } from "@/lib/data";
import { addDays, f1, longDate, ordinal, seasonLabel, signed } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Power ratings" };

type Search = Promise<{ date?: string; teams?: string }>;

export default async function RatingsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof getRatingsPage>>;
  try {
    const { day } = await resolveDay(sp.date);
    data = await getRatingsPage(day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const { season, teams, asOf, rows, history, weekAgo, weekAgoDate, day } = data;
  const header = (
    <header className="grid gap-2">
      <h1 className="display text-[56px] leading-[0.9] sm:text-[80px]">Power ratings</h1>
      <p className="note max-w-[72ch]">
        Points scored and allowed per 100 possessions, adjusted for the opponents each team has faced and for home court. Early in the season every team starts near
        the league average and moves away as its games add up, so a hot week against weak teams counts for less. Net is offense minus defense: how many points
        per 100 possessions better than an average team on a neutral floor.
      </p>
    </header>
  );
  if (!asOf || !rows.length)
    return (
      <div className="grid grid-cols-1 gap-8 pt-6 sm:pt-8">
        {header}
        <Empty title="No ratings yet">They appear after the first night of the season is loaded.</Empty>
      </div>
    );

  // highlighted teams: ?teams=BOS,NYK, else the top 3 and the bottom 2
  const valid = new Set(rows.map((r) => r.team_code));
  const picked = (sp.teams ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((c) => valid.has(c));
  const highlight = new Set(picked.length ? picked : [...rows.slice(0, 3), ...rows.slice(-2)].map((r) => r.team_code));
  const toggle = (code: string) => {
    const next = new Set(highlight);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    const q = new URLSearchParams();
    if (sp.date) q.set("date", sp.date);
    q.set("teams", [...next].join(","));
    return `/ratings?${q.toString()}#chart`;
  };
  const series: RatingSeries[] = rows.map((r) => ({
    code: r.team_code,
    color: accentOf(teams.get(r.team_code)),
    highlight: highlight.has(r.team_code),
    points: history.filter((p) => p.team_code === r.team_code && p.adj_net !== null).map((p) => ({ d: p.as_of, v: p.adj_net! })),
  }));
  const maxNet = Math.max(...rows.map((r) => Math.abs(r.adj_net ?? 0)));

  return (
    <div className="grid grid-cols-1 gap-8 pt-6 sm:pt-8">
      {header}
      <p className="num text-[14px] text-ink-2">
        {seasonLabel(season)}. Ratings on the morning of {longDate(asOf)}, from {day?.games ?? 0} games through {longDate(addDays(asOf, -1))}. League average{" "}
        {f1(day?.league_ortg)} points per 100 possessions. Home court is worth {f1(day?.home_court)} points.
      </p>

      <section id="chart" className="panel grid gap-4 p-4 sm:p-6">
        <SectionHead title="Net rating over the season">
          Each line is one team&apos;s adjusted net rating on the morning of each game day. Zero is an average team. Pick teams below to color them.
        </SectionHead>
        <nav aria-label="Teams on the chart" className="flex flex-wrap gap-1.5">
          {[...rows].sort((a, b) => a.team_code.localeCompare(b.team_code)).map((r) => {
            const on = highlight.has(r.team_code);
            return (
              <Link
                key={r.team_code}
                href={toggle(r.team_code)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[13px] no-underline ${on ? "border-clock text-ink" : "border-line-strong text-muted hover:text-ink"}`}
                scroll={false}
              >
                <span aria-hidden className="h-3 w-[3px] rounded-[1px]" style={{ background: on ? accentOf(teams.get(r.team_code)) : "var(--color-line-strong)" }} />
                {r.team_code}
              </Link>
            );
          })}
        </nav>
        <div className="hidden sm:block">
          <RatingsLines series={series} width={1100} height={440} font={13} />
        </div>
        <div className="sm:hidden">
          <RatingsLines series={series} width={360} height={300} font={11} />
        </div>
      </section>

      <section>
        <SectionHead title="All 30 teams">
          Adjusted ratings with league ranks (1 is best: most points scored, fewest allowed). Raw net is the same games without the adjustment.
          {weekAgoDate ? ` Change is against the ratings of ${longDate(weekAgoDate)}.` : ""}
        </SectionHead>
        <div className="panel table-wrap">
          <table className="data-table">
            <caption className="sr-only">Power ratings for every team, best first</caption>
            <thead>
              <tr>
                <th className="r">Rank</th>
                <th className="sticky-col">Team</th>
                <th className="r">Net</th>
                {weekAgoDate ? <th className="r">Change</th> : null}
                <th className="r">Offense</th>
                <th className="r">Defense</th>
                <th className="r">Raw net</th>
                <th className="r">Games</th>
                <th className="r">Pace</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = teams.get(r.team_code);
                const prev = weekAgo.get(r.team_code);
                const moved = prev?.net_rk && r.net_rk ? prev.net_rk - r.net_rk : null;
                return (
                  <tr key={r.team_code}>
                    <td className="r num text-ink-2">{r.net_rk}</td>
                    <td className="sticky-col">
                      <Link href={`/teams/${r.team_code}`} className="inline-flex items-center gap-2 font-semibold no-underline hover:underline">
                        <span aria-hidden className="h-4 w-[3px] rounded-[1px]" style={{ background: accentOf(t) }} />
                        {t?.display_name ?? r.team_code}
                      </Link>
                    </td>
                    <td className="r">
                      <PmBar value={r.adj_net} maxAbs={maxNet} digits={1} />
                    </td>
                    {weekAgoDate ? (
                      <td className="r num text-ink-2" title={prev ? `Was ${signed(prev.adj_net)}, ${ordinal(prev.net_rk)}` : undefined}>
                        {prev ? signed((r.adj_net ?? 0) - (prev.adj_net ?? 0)) : "–"}
                        {moved ? <span className="ml-1.5 text-[12px] text-muted">{moved > 0 ? `up ${moved}` : `down ${-moved}`}</span> : null}
                      </td>
                    ) : null}
                    <td className="r num">
                      {f1(r.adj_ortg)} <span className="text-[12px] text-muted">{ordinal(r.ortg_rk)}</span>
                    </td>
                    <td className="r num">
                      {f1(r.adj_drtg)} <span className="text-[12px] text-muted">{ordinal(r.drtg_rk)}</span>
                    </td>
                    <td className="r num text-ink-2">{signed(r.net)}</td>
                    <td className="r num text-ink-2">{r.games}</td>
                    <td className="r num text-ink-2">{f1(r.pace)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note mt-3 max-w-[72ch]">
          How it works: a ridge regression on every game&apos;s points per 100 possessions, with a term for each offense, each defense and home court. Each team
          is pulled toward average as if it had also played 7 average games. <Link href="/model">The Model page</Link> shows how these ratings do at picking
          games.
        </p>
      </section>
    </div>
  );
}
