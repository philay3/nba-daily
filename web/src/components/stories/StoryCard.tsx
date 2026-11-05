import Link from "next/link";

import { Columns } from "@/components/charts/Bars";
import { accentOf, TeamMark } from "@/components/ui/bits";
import type { Story, StoryLogRow, Team } from "@/lib/data";
import { addDays, monthDay, shortDay, signed } from "@/lib/format";
import { evidenceOf, keyFigure, STAT_LABEL, statText, STORY_KINDS, storyChart, storyFigures, storyKey, type StoryKind } from "@/lib/stories";

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="display text-[28px] leading-none">{value}</span>
    </div>
  );
}

function Evidence({ s, log, team }: { s: Story; log: StoryLogRow[]; team: Team | undefined }) {
  const c = storyChart(s, log);
  if (!c) return null;
  const word = c.stat === "net" ? "net rating" : (STAT_LABEL[c.stat] ?? c.stat).toLowerCase();
  return (
    <div className="grid gap-1">
      <span className="text-[12px] text-muted">{c.label}</span>
      <Columns
        width={520}
        height={150}
        diverging={c.diverging}
        color={accentOf(team)}
        points={c.points.map((p) => ({
          key: p.key,
          label: monthDay(p.date),
          value: p.value,
          strong: p.strong,
          title: `${monthDay(p.date)} vs ${p.opp}: ${c.stat === "net" ? signed(p.value) : statText(c.stat, p.value)} ${word}`,
        }))}
        avg={c.avg}
        avgLabel={c.avgLabel}
      />
    </div>
  );
}

export function StoryCard({ s, teams, log, showDate }: { s: Story; teams: Map<string, Team>; log: StoryLogRow[]; showDate: boolean }) {
  const team = teams.get(s.team_code);
  const ev = evidenceOf(s);
  const kind = (s.kind in STORY_KINDS ? s.kind : "outlier") as StoryKind;
  const figures = storyFigures(s);
  const studio = `/studio?${new URLSearchParams({ date: addDays(s.story_date, 1), t: "story", story: storyKey(s) }).toString()}`;
  return (
    <article className="panel grid content-start gap-4 p-5" aria-label={s.headline}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="display text-[24px] leading-none text-clock">#{s.rank}</span>
        <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-ink-2">{STORY_KINDS[kind]}</span>
        <TeamMark team={team} code={s.team_code} />
        <span className="text-muted">
          vs {s.opp_code}
          {showDate ? `, ${shortDay(s.story_date)}` : ""}
        </span>
      </div>
      <div className="grid gap-1.5">
        <h3 className="text-[20px] leading-snug font-semibold">{s.headline}</h3>
        <p className="note">{s.detail}</p>
      </div>
      {figures.length ? (
        <div className="grid grid-cols-3 gap-3">
          {figures.map(([label, value]) => (
            <Figure key={label} label={label} value={value} />
          ))}
        </div>
      ) : null}
      <Evidence s={s} log={log} team={team} />
      {ev.also?.length ? (
        <div className="grid gap-1 text-[13px]">
          <span className="text-muted">Also that night</span>
          <ul className="grid gap-0.5 text-ink-2">
            {ev.also.map((a) => (
              <li key={a.headline}>{a.headline}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-[13px]">
        <Link href={`/games/${s.game_id}`}>Game page</Link>
        {s.player_id !== null ? <Link href={`/players/${s.player_id}#trend`}>Player trend</Link> : <Link href={`/teams/${s.team_code}`}>Team page</Link>}
        <Link href={studio}>Make a graphic</Link>
        <span className="ml-auto text-muted" title="Score = rarity x (0.5 + prominence). Rarity is a z-score; prominence is minutes and usage, 0 to 1.">
          {keyFigure(s)}. Score {s.score.toFixed(2)}
        </span>
      </div>
    </article>
  );
}
