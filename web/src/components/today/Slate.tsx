import Link from "next/link";

import { accentOf } from "@/components/ui/bits";
import type { MissingRow, Team, TeamSeason, TonightGame } from "@/lib/data";
import { f1, timeET } from "@/lib/format";

export function Slate({
  games,
  teams,
  teamSeason,
  missing,
  selected,
}: {
  games: TonightGame[];
  teams: Map<string, Team>;
  teamSeason: Map<string, TeamSeason>;
  missing: Map<string, MissingRow>;
  selected?: string;
}) {
  return (
    <div className="panel table-wrap">
      <table className="data-table">
        <caption className="sr-only">Every game tonight in tip-off order</caption>
        <thead>
          <tr>
            <th>Time (ET)</th>
            <th className="sticky-col">Matchup</th>
            <th>Records</th>
            <th>Line</th>
            <th>Win odds</th>
            <th className="r">Total</th>
            <th>No rest</th>
            <th className="r">Away missing</th>
            <th className="r">Home missing</th>
            <th>TV</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const ta = teamSeason.get(g.away_code);
            const th = teamSeason.get(g.home_code);
            const o = g.odds;
            const fav = o?.away_wp != null && o?.home_wp != null ? (o.away_wp >= o.home_wp ? [g.away_code, o.away_wp] : [g.home_code, o.home_wp]) : null;
            const noRest = [g.away_rest === 0 ? g.away_code : null, g.home_rest === 0 ? g.home_code : null].filter(Boolean).join(", ");
            const isSel = selected === g.code;
            return (
              <tr key={g.id} aria-current={isSel ? "true" : undefined}>
                <td className="num text-ink-2">{timeET(g.tip)}</td>
                <td className="sticky-col">
                  <Link
                    href={`/?date=${g.game_date}&game=${encodeURIComponent(g.code)}#matchup`}
                    className={`inline-flex items-center gap-1.5 no-underline hover:underline ${isSel ? "text-clock" : ""}`}
                  >
                    <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(g.away_code)) }} />
                    <span className="font-semibold">{g.away_code}</span>
                    <span className="text-muted">at</span>
                    <span className="font-semibold">{g.home_code}</span>
                    <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(g.home_code)) }} />
                  </Link>
                </td>
                <td className="num text-ink-2">{ta && th ? `${ta.w}-${ta.l}, ${th.w}-${th.l}` : ""}</td>
                <td className="num">{o?.line ?? <span className="text-muted">not posted</span>}</td>
                <td className="num">
                  {fav ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-[70px]">
                        {fav[0]} {Number(fav[1]).toFixed(1)}%
                      </span>
                      <span aria-hidden className="relative block h-1.5 w-14 rounded bg-line-strong">
                        <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${fav[1]}%`, background: accentOf(teams.get(String(fav[0]))) }} />
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted">{"–"}</span>
                  )}
                </td>
                <td className="r num">{o?.total ?? ""}</td>
                <td>{noRest}</td>
                <td className="r num">{f1(missing.get(g.away_code)?.ppg ?? 0)}</td>
                <td className="r num">{f1(missing.get(g.home_code)?.ppg ?? 0)}</td>
                <td className="text-ink-2">{g.tv}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
