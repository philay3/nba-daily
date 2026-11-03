import type { Metadata } from "next";
import Link from "next/link";

import { GameOfNight } from "@/components/today/GameOfNight";
import { NightLeaders, ResultCards } from "@/components/today/LastNight";
import { Matchup } from "@/components/today/Matchup";
import { Slate } from "@/components/today/Slate";
import { WatchCard } from "@/components/today/WatchCards";
import { Empty, NoDatabase, SectionHead } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getToday, played, resolveDay, type TodayData, type TonightGame } from "@/lib/data";
import { addDays, f1, longDate, parseTs, shortDay, TZ } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today" };

type Search = Promise<{ date?: string; game?: string }>;

function DateNav({ day, today }: { day: string; today: string }) {
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  return (
    <nav aria-label="Change date" className="flex items-center gap-2 text-[13px]">
      <Link href={`/?date=${prev}`} className="rounded border border-line-strong px-2.5 py-1 text-ink-2 no-underline hover:text-ink">
        {"‹"} {shortDay(prev)}
      </Link>
      {day !== today ? (
        <Link href="/" className="rounded border border-line-strong px-2.5 py-1 text-ink-2 no-underline hover:text-ink">
          Today
        </Link>
      ) : null}
      <Link href={`/?date=${next}`} className="rounded border border-line-strong px-2.5 py-1 text-ink-2 no-underline hover:text-ink">
        {shortDay(next)} {"›"}
      </Link>
    </nav>
  );
}

function KeyNumbers({ d }: { d: TodayData }) {
  const noRest = d.tonight.reduce((n, g) => n + (g.away_rest === 0 ? 1 : 0) + (g.home_rest === 0 ? 1 : 0), 0);
  const out = d.injuries.filter((i) => i.status === "Out").length;
  const topMissing = [...d.missing.values()].sort((a, b) => b.ppg - a.ppg)[0];
  const withLine = d.tonight.filter((g) => g.odds?.spread_abs != null).sort((a, b) => (a.odds!.spread_abs ?? 0) - (b.odds!.spread_abs ?? 0));
  const closest = withLine[0];
  const best = d.box.filter(played).sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))[0];
  const cells: { label: string; value: string; sub?: string }[] = [
    { label: "Games tonight", value: String(d.tonight.length) },
    { label: "Teams on no rest", value: String(noRest), sub: "Played last night" },
    { label: "Players listed out", value: d.injuries.length ? String(out) : "–", sub: d.injuries.length ? "Across tonight's teams" : "No injury report yet" },
    { label: "Most scoring missing", value: topMissing ? f1(topMissing.ppg) : "–", sub: topMissing ? `${topMissing.team} points per game` : undefined },
    { label: "Closest line", value: closest?.odds?.line ?? "–", sub: closest ? `${closest.away_code} at ${closest.home_code}` : undefined },
    { label: "Best line last night", value: best ? `${best.pts}-${best.reb}-${best.ast}` : "–", sub: best ? `${best.name}, PTS-REB-AST` : undefined },
  ];
  return (
    <dl className="grid grid-cols-2 border-y border-line sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c, i) => (
        <div key={c.label} className={`grid content-start gap-1 px-1 py-4 sm:px-4 ${i % 2 ? "border-l border-line pl-4" : ""} sm:border-l sm:border-line ${i === 0 ? "sm:border-l-0 sm:pl-0" : ""}`}>
          <dt className="text-[12px] text-muted">{c.label}</dt>
          <dd className="display text-[34px] leading-none">{c.value}</dd>
          {c.sub ? <dd className="text-[12px] text-ink-2">{c.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function updatedText(ts: string): string {
  const t = parseTs(ts);
  if (!t) return "";
  return `${t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ })}, ${t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })} ET`;
}

function fallbackLede(d: TodayData): string {
  const n = d.tonight.length;
  const m = d.results.length;
  const tonight = n ? `${n} game${n === 1 ? "" : "s"} tonight.` : "No games tonight.";
  const last = m ? ` ${m} game${m === 1 ? "" : "s"} last night.` : d.lastNight.length ? " Last night's box scores are not loaded yet." : "";
  return tonight + last;
}

export default async function TodayPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  let d: TodayData;
  let today: string;
  let latest: string | null;
  let pinned: boolean;
  try {
    const r = await resolveDay(sp.date);
    ({ today, latest, pinned } = r);
    d = await getToday(r.day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const headline = d.brief.find((b) => b.kind === "headline")?.text;
  const surprises = d.brief.filter((b) => b.kind === "surprise");
  const picks: TonightGame[] = d.tonight.filter((g) => g.pick?.watch != null).sort((a, b) => (a.pick!.watch ?? 9) - (b.pick!.watch ?? 9));
  const ranked = picks.length
    ? picks
    : [...d.tonight]
        .filter((g) => d.teamSeason.get(g.away_code) && d.teamSeason.get(g.home_code))
        .sort((a, b) => {
          const s = (g: TonightGame) => (d.teamSeason.get(g.away_code)!.net ?? 0) + (d.teamSeason.get(g.home_code)!.net ?? 0);
          return s(b) - s(a);
        })
        .slice(0, 4);
  const lead = ranked[0];
  const selected = d.tonight.find((g) => g.code === sp.game) ?? lead ?? d.tonight[0];
  const showingLatest = !pinned && latest && d.day === latest && d.day !== today;

  return (
    <div className="grid gap-12 pt-6 sm:pt-8">
      <section className="grid gap-5" aria-labelledby="day-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">
            Last night: <span className="text-ink-2">{longDate(d.yday)}</span>
            <span className="ml-3">{d.run?.finished_at ? `Updated ${updatedText(d.run.finished_at)}` : "No pipeline run for this date yet"}</span>
          </p>
          <DateNav day={d.day} today={today} />
        </div>
        {showingLatest ? (
          <p className="rounded border border-clock/50 px-3 py-2 text-[13px] text-ink-2">
            Showing {longDate(d.day)}, the latest day in the database. Run the pipeline to load today.
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end lg:gap-10">
          <h1 id="day-title" className="display grid gap-3 text-[56px] leading-[0.95] sm:text-[88px]">
            <span>{d.tonight.length ? "Tonight" : "No games tonight"}</span>
            <span className="block text-[24px] leading-none text-ink-2 sm:text-[30px]">{longDate(d.day)}</span>
          </h1>
          <p className="max-w-[68ch] text-[17px] leading-relaxed text-ink sm:text-[19px]">{headline ?? fallbackLede(d)}</p>
        </div>
        {d.tonight.length || d.results.length ? <KeyNumbers d={d} /> : null}
      </section>

      {d.tonight.length ? (
        <section className="grid gap-5" aria-label="Games to watch">
          {lead ? (
            <GameOfNight game={lead} teams={d.teams} teamSeason={d.teamSeason} missing={d.missing} label={picks.length ? lead.pick?.tag || "Game of the night" : "Best matchup by net rating"} />
          ) : null}
          {ranked.length > 1 ? (
            <div>
              <SectionHead title="Games to watch">
                {picks.length
                  ? "Ranked on team ratings, how close the line is, who is missing and the storylines."
                  : "No picks were written for this date, so these are the matchups with the best combined net rating."}
              </SectionHead>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {ranked.slice(1).map((g) => (
                  <WatchCard key={g.id} game={g} teams={d.teams} teamSeason={d.teamSeason} missing={d.missing} rank={picks.length ? g.pick?.watch ?? null : null} />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {d.tonight.length ? (
        <section aria-labelledby="slate">
          <SectionHead title="Tonight's slate" id="slate">
            Every game in tip-off order. Win odds show the favorite. Missing is the season scoring of players listed out or doubtful.
          </SectionHead>
          <Slate games={d.tonight} teams={d.teams} teamSeason={d.teamSeason} missing={d.missing} selected={selected?.code} />
        </section>
      ) : null}

      {selected ? (
        <section aria-labelledby="matchup" className="scroll-mt-20" id="matchup">
          <SectionHead title="Matchup breakdown" id="matchup-title">
            Season numbers through last night. Ranks are out of 30, 1 is best (for pace, 1 is fastest). Amber edges are 10 or more spots.
          </SectionHead>
          <Matchup game={selected} games={d.tonight} teams={d.teams} teamSeason={d.teamSeason} players={d.players} injuries={d.injuries} missing={d.missing} />
        </section>
      ) : null}

      <section aria-labelledby="last-night">
        <SectionHead title="Last night" id="last-night">
          The line shows the margin after each quarter: above the middle the road team led. Open a game for its full box score.
        </SectionHead>
        {d.results.length ? (
          <div className="grid gap-6">
            <ResultCards results={d.results} teams={d.teams} />
            <NightLeaders box={d.box} teams={d.teams} />
          </div>
        ) : d.lastNight.length ? (
          <Empty title={`Box scores for ${longDate(d.yday)} are not loaded yet`}>
            The hoopR mirror rebuilds around 2 a.m. Eastern and the daily pipeline runs at about 9:45 a.m. Run{" "}
            <code>python3 -m nba_pipeline run --date {d.day}</code> to load them now.
          </Empty>
        ) : (
          <Empty title={`No games on ${longDate(d.yday)}`} />
        )}
      </section>

      {surprises.length ? (
        <section aria-labelledby="surprises">
          <SectionHead title="Surprises" id="surprises">
            What stands out in the ratings, last night&apos;s games and the injury news.
          </SectionHead>
          <ol className="panel grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
            {surprises.map((s) => (
              <li key={s.ref} className="grid gap-1 border-l-2 border-clock/70 pl-3">
                <span className="font-semibold">{s.title}</span>
                <span className="text-[14px] text-ink-2">{s.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
