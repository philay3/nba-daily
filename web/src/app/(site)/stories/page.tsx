import type { Metadata } from "next";
import Link from "next/link";

import { StoryCard } from "@/components/stories/StoryCard";
import { Empty, NoDatabase } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getStoriesPage, resolveDay } from "@/lib/data";
import { addDays, longDate, seasonLabel, shortDay } from "@/lib/format";
import { STORY_KINDS, storyFilters, storyQuery, type StoryKind } from "@/lib/stories";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stories" };

type Search = { date?: string; type?: string; team?: string; player?: string; scope?: string };

export default async function StoriesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const f = storyFilters(sp);
  let data: Awaited<ReturnType<typeof getStoriesPage>>;
  let day: string;
  try {
    ({ day } = await resolveDay(sp.date));
    data = await getStoriesPage(day, f);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const { teams, nights, night, stories, players, names, logs, season } = data;
  const href = (patch: Parameters<typeof storyQuery>[2]) => `/stories?${storyQuery(sp.date, f, patch)}`;
  // nights are newest first: the one before this night is older
  const i = night ? nights.indexOf(night) : -1;
  const older = i >= 0 ? nights[i + 1] : undefined;
  const newer = i > 0 ? nights[i - 1] : undefined;
  const nightLink = (d: string) => `/stories?${storyQuery(addDays(d, 1), f)}`;
  const who = f.player !== null ? (names.get(f.player)?.name ?? `player ${f.player}`) : f.team ? (teams.get(f.team)?.display_name ?? f.team) : null;
  const title =
    f.scope === "night"
      ? night
        ? `From ${longDate(night)}`
        : "No game nights yet"
      : `${seasonLabel(season)} season${who ? `: ${who}` : ""}`;
  const teamCodes = [...teams.keys()].sort();
  const field = "rounded border border-line-strong bg-arena px-3 py-2 text-[14px] text-ink";

  return (
    <div className="grid grid-cols-1 gap-6 pt-6 sm:pt-8">
      <header className="grid gap-2">
        <h1 className="display text-[56px] leading-[0.9] sm:text-[80px]">Stories</h1>
        <p className="note max-w-[72ch]">
          Story ideas from each night&apos;s box scores, ranked by how rare they are and how big a role the player has. Outliers are lines far from his own average before that
          night. Streaks, firsts and rare lines count only games already played. Team swings compare a team&apos;s last games with the ones before.
        </p>
      </header>

      <section aria-label="Filters" className="panel grid gap-4 p-4 sm:p-5">
        <nav aria-label="Story type" className="flex flex-wrap gap-2">
          {([null, ...Object.keys(STORY_KINDS)] as (StoryKind | null)[]).map((k) => (
            <Link
              key={k ?? "all"}
              href={href({ kind: k })}
              aria-current={f.kind === k ? "true" : undefined}
              className={`rounded-full border px-3 py-1 text-[13px] no-underline ${f.kind === k ? "border-ink text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}
            >
              {k ? STORY_KINDS[k] : "Every type"}
            </Link>
          ))}
        </nav>
        <form method="get" action="/stories" className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          {sp.date ? <input type="hidden" name="date" value={sp.date} /> : null}
          {f.kind ? <input type="hidden" name="type" value={f.kind} /> : null}
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Team
            <select name="team" defaultValue={f.team ?? ""} className={field}>
              <option value="">Every team</option>
              {teamCodes.map((c) => (
                <option key={c} value={c}>
                  {teams.get(c)?.display_name ?? c}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Player
            <select name="player" defaultValue={f.player !== null ? String(f.player) : ""} className={field}>
              <option value="">Every player</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Nights
            <select name="scope" defaultValue={f.scope} className={field}>
              <option value="night">Last night only</option>
              <option value="season">The whole season</option>
            </select>
          </label>
          <button type="submit" className="rounded bg-clock px-4 py-2 text-[14px] font-semibold text-arena">
            Show
          </button>
        </form>
      </section>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="section-title">{title}</h2>
        {f.scope === "night" && night ? (
          <nav aria-label="Other nights" className="flex gap-4 text-[14px]">
            {older ? <Link href={nightLink(older)}>Earlier: {shortDay(older)}</Link> : null}
            {newer ? <Link href={nightLink(newer)}>Later: {shortDay(newer)}</Link> : null}
          </nav>
        ) : (
          <span className="text-[13px] text-muted">
            {stories.length} {stories.length === 1 ? "story" : "stories"}, newest first
          </span>
        )}
      </div>

      {stories.length ? (
        <section aria-label="Stories" className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {stories.map((s) => (
            <StoryCard key={`${s.story_date}-${s.rank}`} s={s} teams={teams} log={s.player_id !== null ? (logs.get(s.player_id) ?? []) : []} showDate={f.scope === "season"} />
          ))}
        </section>
      ) : (
        <Empty title={night || f.scope === "season" ? "No stories match these filters" : "No stories yet"}>
          {night || f.scope === "season"
            ? "Try another type, team or player, or look at the whole season."
            : "The daily pipeline ranks story ideas after each game night. Run it, or pick a date in the season."}
        </Empty>
      )}
    </div>
  );
}
