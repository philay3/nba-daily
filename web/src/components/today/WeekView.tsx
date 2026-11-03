import Link from "next/link";

import { DayGames } from "@/components/today/DayGames";
import type { Team, TeamSeason, WeekDay } from "@/lib/data";
import { longDate } from "@/lib/format";

/** The next 7 days of games, grouped by date. The first 3 days link to their full matchup breakdown. */
export function WeekView({ week, teams, teamSeason, current }: { week: WeekDay[]; teams: Map<string, Team>; teamSeason: Map<string, TeamSeason>; current: string }) {
  return (
    <div className="grid gap-6">
      {week.map((w) => (
        <div key={w.day} className="grid gap-2">
          <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link href={`/?date=${w.day}`} className={`text-[17px] font-semibold no-underline hover:underline ${w.day === current ? "text-clock" : ""}`}>
              {longDate(w.day)}
            </Link>
            <span className="text-[13px] text-muted">
              {w.games.length ? `${w.games.length} game${w.games.length === 1 ? "" : "s"}` : "No games"}
              {w.games.length && w.detailed ? ". Open a game for its matchup breakdown." : ""}
            </span>
          </h3>
          {w.games.length ? (
            <DayGames games={w.games} teams={teams} teamSeason={teamSeason} detailed={w.detailed} caption={`Games on ${longDate(w.day)}`} />
          ) : null}
        </div>
      ))}
    </div>
  );
}
