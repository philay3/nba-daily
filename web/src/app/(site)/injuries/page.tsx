import type { Metadata } from "next";
import Link from "next/link";

import { accentOf, Empty, NoDatabase, StatusBadge } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getInjuriesPage, missingScoring, resolveDay } from "@/lib/data";
import { f1, longDate, signed } from "@/lib/format";
import { STATUS_ORDER } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Injuries" };

const FILTERS = [
  { key: "all", label: "Everyone" },
  { key: "gtd", label: "Game-time calls" },
  { key: "out", label: "Out" },
] as const;

export default async function InjuriesPage({ searchParams }: { searchParams: Promise<{ date?: string; show?: string }> }) {
  const sp = await searchParams;
  const show = sp.show === "out" || sp.show === "gtd" ? sp.show : "all";
  let data: Awaited<ReturnType<typeof getInjuriesPage>>;
  let day: string;
  try {
    ({ day } = await resolveDay(sp.date));
    data = await getInjuriesPage(day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const { teams, games, injuries, players } = data;
  const tip = new Map(games.map((g) => [g.code, g.tip ?? ""]));
  const pidx = new Map(players.map((p) => [`${p.team_code}|${p.name}`, p]));
  const missing = missingScoring(injuries, players);
  const rows = injuries
    .filter((i) => (show === "all" ? true : show === "out" ? i.status === "Out" : i.status !== "Out"))
    .sort(
      (a, b) =>
        (tip.get(a.game_code ?? "") ?? "").localeCompare(tip.get(b.game_code ?? "") ?? "") ||
        (a.game_code ?? "").localeCompare(b.game_code ?? "") ||
        a.team_code.localeCompare(b.team_code) ||
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        a.player_name.localeCompare(b.player_name),
    );
  const q = (k: string) => `/injuries?${new URLSearchParams({ ...(sp.date ? { date: sp.date } : {}), ...(k === "all" ? {} : { show: k }) }).toString()}`;
  const topMissing = [...missing.values()].sort((a, b) => b.ppg - a.ppg).slice(0, 5);
  return (
    <div className="grid grid-cols-1 gap-8 pt-6 sm:pt-8">
      <header className="grid gap-2">
        <h1 className="display text-[56px] leading-[0.9] sm:text-[80px]">Injuries</h1>
        <p className="note max-w-[72ch]">
          Tonight&apos;s teams on {longDate(day)}, from ESPN&apos;s injury report, with each player&apos;s season scoring and minutes. Game-time calls are doubtful, questionable,
          probable or day-to-day.
        </p>
      </header>
      {injuries.length ? (
        <>
          {topMissing.length ? (
            <section aria-label="Most scoring missing" className="grid gap-3 sm:grid-cols-5">
              {topMissing.map((m) => (
                <div key={m.team} className="panel grid gap-1 p-4">
                  <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
                    <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(m.team)) }} />
                    {m.team}, {m.out} out or doubtful
                  </span>
                  <span className="display text-[36px] leading-none">{f1(m.ppg)}</span>
                  <span className="text-[12px] text-muted">points per game missing</span>
                </div>
              ))}
            </section>
          ) : null}
          <div className="panel">
            <nav aria-label="Filter players" className="flex flex-wrap gap-2 px-4 pt-4 sm:px-5">
              {FILTERS.map((f) => (
                <Link
                  key={f.key}
                  href={q(f.key)}
                  aria-current={show === f.key ? "true" : undefined}
                  className={`rounded-full border px-3 py-1 text-[13px] no-underline ${show === f.key ? "border-ink text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
            <div className="table-wrap mt-3">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Team</th>
                    <th className="sticky-col">Player</th>
                    <th>Status</th>
                    <th>Injury</th>
                    <th className="r">PPG</th>
                    <th className="r">MIN</th>
                    <th className="r">+/- per game</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => {
                    const p = pidx.get(`${i.team_code}|${i.player_name}`);
                    return (
                      <tr key={`${i.team_code}|${i.player_name}`}>
                        <td className="text-ink-2">{i.game_code}</td>
                        <td>
                          <Link href={`/teams/${i.team_code}`} className="inline-flex items-center gap-1.5 font-semibold no-underline hover:underline">
                            <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(i.team_code)) }} />
                            {i.team_code}
                          </Link>
                        </td>
                        <td className="sticky-col">
                          {p ? (
                            <Link href={`/players/${p.player_id}`} className="font-semibold no-underline hover:underline">
                              {i.player_name}
                            </Link>
                          ) : (
                            <span className="font-semibold">{i.player_name}</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={i.status} />
                        </td>
                        <td className="text-ink-2">{i.injury}</td>
                        <td className="r num">{p ? f1(p.ppg) : <span className="text-muted">no games</span>}</td>
                        <td className="r num">{p ? f1(p.mpg) : ""}</td>
                        <td className="r num">{p ? signed(p.pm_pg) : ""}</td>
                        <td className="text-ink-2">{i.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <Empty title={games.length ? "No injury report for this date yet" : "No games on this date"}>
          {games.length
            ? "The daily pipeline saves ESPN's injury report each morning for the teams playing that night."
            : "Injuries are listed for teams playing that night. Pick another date from the Today page."}
        </Empty>
      )}
    </div>
  );
}
