import type { Metadata } from "next";

import { GameOfNight } from "@/components/today/GameOfNight";
import { NightLeaders, ResultCards } from "@/components/today/LastNight";
import { Matchup } from "@/components/today/Matchup";
import { DatePicker } from "@/components/today/DatePicker";
import { DayGames, offText } from "@/components/today/DayGames";
import { Slate } from "@/components/today/Slate";
import { WatchCard } from "@/components/today/WatchCards";
import { WeekView } from "@/components/today/WeekView";
import { Empty, NoDatabase, SectionHead } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getToday, getWeek, played, resolveDay, type TodayData, type TonightGame, type WeekDay } from "@/lib/data";
import { addDays, dayWord, f1, longDate, monthDay, parseTs, shortDay, TZ } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today" };

type Search = Promise<{ date?: string; game?: string }>;

function KeyNumbers({ d, word }: { d: TodayData; word: string }) {
  const games = d.tonight.filter((g) => !offText(g.status));
  const noRest = games.reduce((n, g) => n + (g.away_rest === 0 ? 1 : 0) + (g.home_rest === 0 ? 1 : 0), 0);
  const out = [...d.missing.values()].reduce((n, m) => n + m.out, 0);
  const topMissing = [...d.missing.values()].sort((a, b) => b.ppg - a.ppg)[0];
  const withLine = games.filter((g) => g.odds?.spread_abs != null).sort((a, b) => (a.odds!.spread_abs ?? 0) - (b.odds!.spread_abs ?? 0));
  const closest = withLine[0];
  const best = d.results.length ? d.box.filter(played).sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))[0] : undefined;
  const lower = word === "Tonight" || word === "Tomorrow" ? word.toLowerCase() : `on ${word}`;
  const cells: { label: string; value: string; sub?: string }[] = [
    { label: `Games ${lower}`, value: String(games.length) },
    { label: "Teams on a back-to-back", value: String(noRest), sub: "Played the day before" },
    {
      label: "Players listed out",
      value: d.missing.size ? String(out) : "–",
      sub: d.missing.size ? "Out or doubtful, both teams" : "No injury report yet",
    },
    { label: "Most scoring missing", value: topMissing ? f1(topMissing.ppg) : "–", sub: topMissing ? `${topMissing.team} points per game` : undefined },
    { label: "Closest line", value: closest?.odds?.line ?? "–", sub: closest ? `${closest.away_code} at ${closest.home_code}` : "Not posted yet" },
    best
      ? { label: "Best line last night", value: `${best.pts}-${best.reb}-${best.ast}`, sub: `${best.name}, PTS-REB-AST` }
      : { label: "Lines posted", value: `${withLine.length} of ${games.length}`, sub: "Spreads from ESPN" },
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

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function fallbackLede(d: TodayData, word: string): string {
  const live = d.tonight.filter((g) => !offText(g.status)).length;
  if (d.mode === "past") {
    if (!d.tonight.length) return "No games on this date.";
    const missing = d.tonight.length - d.results.length;
    return `${plural(d.results.length, "final")}. Open a game for its box score.` + (missing ? ` ${plural(missing, "game")} without a final score here.` : "");
  }
  if (d.mode === "schedule") {
    return live
      ? `${plural(live, "game")} on the schedule. The full matchup breakdown, injuries and lines start 3 days out.`
      : "No games on the schedule for this date.";
  }
  const when = word === "Tonight" ? "tonight" : word === "Tomorrow" ? "tomorrow" : `on ${word}`;
  const tonight = live ? `${plural(live, "game")} ${when}.` : `No games ${when}.`;
  const m = d.results.length;
  const last = d.day !== d.latest ? "" : m ? ` ${plural(m, "game")} last night.` : d.lastNight.length ? " Last night's box scores are not loaded yet." : "";
  return tonight + last;
}

function topLine(d: TodayData): string {
  if (d.mode === "past") return `Final scores for ${longDate(d.day)}`;
  if (!d.latest) return "No pipeline run yet";
  const when = d.run?.finished_at ? `Updated ${updatedText(d.run.finished_at)}` : "";
  if (d.day === d.latest) return [`Last night: ${longDate(d.yday)}`, when].filter(Boolean).join(". ");
  return [`Look-ahead from the run of ${shortDay(d.latest)}`, when].filter(Boolean).join(". ");
}

export default async function TodayPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  let d: TodayData;
  let today: string;
  let latest: string | null;
  let pinned: boolean;
  let week: WeekDay[] = [];
  try {
    const r = await resolveDay(sp.date);
    ({ today, latest, pinned } = r);
    d = await getToday(r.day);
    if (d.mode !== "past") week = await getWeek(d.day, d.latest);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const headline = d.brief.find((b) => b.kind === "headline")?.text;
  const surprises = d.brief.filter((b) => b.kind === "surprise");
  const word = dayWord(d.day, today);
  const playing = d.tonight.filter((g) => !offText(g.status));
  const picks: TonightGame[] = playing.filter((g) => g.pick?.watch != null).sort((a, b) => (a.pick!.watch ?? 9) - (b.pick!.watch ?? 9));
  const ranked = picks.length
    ? picks
    : [...playing]
        .filter((g) => d.teamSeason.get(g.away_code) && d.teamSeason.get(g.home_code))
        .sort((a, b) => {
          const s = (g: TonightGame) => (d.teamSeason.get(g.away_code)!.net ?? 0) + (d.teamSeason.get(g.home_code)!.net ?? 0);
          return s(b) - s(a);
        })
        .slice(0, 4);
  const lead = ranked[0];
  const selected = playing.find((g) => g.code === sp.game) ?? lead ?? playing[0];
  const showingLatest = !pinned && latest && d.day === latest && d.day !== today;
  const outside = d.range && (d.day < d.range.first || d.day > d.range.last);
  const preview = d.mode === "preview";
  const through = d.latest ? shortDay(addDays(d.latest, -1)) : "";
  const report = selected ? (selected.preview ? selected.preview.injury_report : d.injuries.length ? d.snapshot : null) : null;
  const title = d.mode === "past" ? "Final scores" : d.tonight.length ? word : `No games ${word === "Tonight" || word === "Tomorrow" ? word.toLowerCase() : ""}`.trim();

  return (
    <div className="grid gap-12 pt-6 sm:pt-8">
      <section className="grid gap-5" aria-labelledby="day-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">{topLine(d)}</p>
          <DatePicker day={d.day} today={today} range={d.range} />
        </div>
        {showingLatest ? (
          <p className="rounded border border-clock/50 px-3 py-2 text-[13px] text-ink-2">
            Showing {longDate(d.day)}, the latest day in the database. Run the pipeline to load today.
          </p>
        ) : null}
        {outside && d.range ? (
          <p className="rounded border border-clock/50 px-3 py-2 text-[13px] text-ink-2">
            This date is outside the regular season, which runs from {longDate(d.range.first)} to {longDate(d.range.last)}.
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end lg:gap-10">
          <h1 id="day-title" className="display grid gap-3 text-[56px] leading-[0.95] sm:text-[88px]">
            <span>{title}</span>
            <span className="block text-[24px] leading-none text-ink-2 sm:text-[30px]">{title === word ? (word === "Tonight" || word === "Tomorrow" ? longDate(d.day) : monthDay(d.day)) : longDate(d.day)}</span>
          </h1>
          <p className="max-w-[68ch] text-[17px] leading-relaxed text-ink sm:text-[19px]">{headline ?? fallbackLede(d, word)}</p>
        </div>
        {preview && (playing.length || d.results.length) ? <KeyNumbers d={d} word={word} /> : null}
      </section>

      {d.mode === "past" ? (
        <section aria-labelledby="finals" className="grid gap-6">
          <SectionHead title="Results" id="finals">
            The line shows the margin after each quarter: above the middle the road team led. Open a game for its full box score.
          </SectionHead>
          {d.results.length ? (
            <>
              <ResultCards results={d.results} teams={d.teams} />
              <NightLeaders box={d.box} teams={d.teams} />
            </>
          ) : null}
          {d.tonight.length > d.results.length ? (
            <div className="grid gap-2">
              <h3 className="text-[17px] font-semibold">Games without a final score here</h3>
              <p className="note">Postponed games, or box scores the daily run has not loaded yet.</p>
              <DayGames
                games={d.tonight.filter((g) => !d.results.some((r) => r.id === g.id))}
                teams={d.teams}
                teamSeason={d.teamSeason}
                detailed={false}
                caption={`Games on ${longDate(d.day)} without a final score`}
              />
            </div>
          ) : null}
          {!d.tonight.length ? <Empty title={`No games on ${longDate(d.day)}`} /> : null}
        </section>
      ) : null}

      {preview && playing.length ? (
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

      {preview && d.tonight.length ? (
        <section aria-labelledby="slate">
          <SectionHead title={word === "Tonight" ? "Tonight's slate" : `${word}'s slate`} id="slate">
            Every game in tip-off order. Win odds show the favorite. Missing is the season scoring of players listed out or doubtful.
          </SectionHead>
          <Slate games={d.tonight} teams={d.teams} teamSeason={d.teamSeason} missing={d.missing} selected={selected?.code} />
        </section>
      ) : null}

      {preview && selected ? (
        <section aria-labelledby="matchup" className="scroll-mt-20" id="matchup">
          <SectionHead title="Matchup breakdown" id="matchup-title">
            Season numbers through {through}. Ranks are out of 30, 1 is best (for pace, 1 is fastest). Amber edges are 10 or more spots.
          </SectionHead>
          <Matchup game={selected} games={playing} teams={d.teams} teamSeason={d.teamSeason} players={d.players} injuries={report ? d.injuries : []} missing={d.missing} report={report} />
        </section>
      ) : null}

      {week.length ? (
        <section aria-labelledby="week" className="scroll-mt-20" id="week-ahead">
          <SectionHead title="The week ahead" id="week">
            The next 7 days from {shortDay(d.day)}. Records are through {through || "the latest run"}. Lines show once ESPN posts them, usually a day or two out.
          </SectionHead>
          <WeekView week={week} teams={d.teams} teamSeason={d.teamSeason} current={d.day} />
        </section>
      ) : null}

      {preview && d.day === d.latest ? (
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
      ) : null}

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
