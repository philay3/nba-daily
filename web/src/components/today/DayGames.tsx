import Link from "next/link";

import { accentOf } from "@/components/ui/bits";
import type { Team, TeamSeason, TonightGame } from "@/lib/data";
import { tipTime } from "@/lib/format";

const OFF: Record<string, string> = {
  STATUS_POSTPONED: "Postponed",
  STATUS_CANCELED: "Canceled",
  STATUS_CANCELLED: "Canceled",
  STATUS_SUSPENDED: "Suspended",
};

/** "Postponed" and the like, or null for a game still on. */
export function offText(status: string): string | null {
  return OFF[status] ?? null;
}

/** Where a game links: its matchup breakdown inside the look-ahead, else its game page. */
export function gameHref(g: TonightGame, detailed: boolean): string {
  return detailed ? `/?date=${g.game_date}&game=${encodeURIComponent(g.code)}#matchup` : `/games/${g.id}`;
}

/** One day's schedule: tip time, matchup, records, line once posted, back-to-backs and TV. */
export function DayGames({
  games,
  teams,
  teamSeason,
  detailed,
  caption,
}: {
  games: TonightGame[];
  teams: Map<string, Team>;
  teamSeason: Map<string, TeamSeason>;
  detailed: boolean;
  caption: string;
}) {
  return (
    <div className="panel table-wrap">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th>Time (ET)</th>
            <th className="sticky-col">Matchup</th>
            <th>Records</th>
            <th>Line</th>
            <th>Back-to-back</th>
            <th>TV</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const ta = teamSeason.get(g.away_code);
            const th = teamSeason.get(g.home_code);
            const off = offText(g.status);
            const b2b = [g.away_rest === 0 ? g.away_code : null, g.home_rest === 0 ? g.home_code : null].filter(Boolean).join(", ");
            return (
              <tr key={g.id}>
                <td className="num text-ink-2">{off ? <span className="font-semibold text-clock">{off}</span> : tipTime(g)}</td>
                <td className="sticky-col">
                  <Link href={gameHref(g, detailed && !off)} className="inline-flex items-center gap-1.5 no-underline hover:underline">
                    <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(g.away_code)) }} />
                    <span className="font-semibold">{g.away_code}</span>
                    <span className="text-muted">at</span>
                    <span className="font-semibold">{g.home_code}</span>
                    <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(g.home_code)) }} />
                  </Link>
                </td>
                <td className="num text-ink-2">
                  {ta ? `${ta.w}-${ta.l}` : "0-0"}, {th ? `${th.w}-${th.l}` : "0-0"}
                </td>
                <td className="num">{g.odds?.line ?? <span className="text-muted">not posted</span>}</td>
                <td>{b2b || <span className="text-muted">{"–"}</span>}</td>
                <td className="text-ink-2">{g.tv}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
