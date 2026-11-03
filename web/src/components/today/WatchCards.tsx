import Link from "next/link";

import { accentOf, WinSplit } from "@/components/ui/bits";
import type { MissingRow, Team, TeamSeason, TonightGame } from "@/lib/data";
import { f1, timeET } from "@/lib/format";

export function WatchCard({
  game,
  teams,
  teamSeason,
  missing,
  rank,
}: {
  game: TonightGame;
  teams: Map<string, Team>;
  teamSeason: Map<string, TeamSeason>;
  missing: Map<string, MissingRow>;
  rank: number | null;
}) {
  const a = teams.get(game.away_code);
  const h = teams.get(game.home_code);
  const ta = teamSeason.get(game.away_code);
  const th = teamSeason.get(game.home_code);
  const o = game.odds;
  const href = `/?date=${game.game_date}&game=${encodeURIComponent(game.code)}#matchup`;
  return (
    <article className="panel grid content-start gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        {rank ? <span className="display num text-[34px] text-muted">{rank}</span> : <span />}
        {game.pick?.tag ? <span className="chip">{game.pick.tag}</span> : null}
      </div>
      <Link href={href} className="flex items-center gap-2 no-underline">
        <span aria-hidden className="h-6 w-1 rounded-[1px]" style={{ background: accentOf(a) }} />
        <span className="display text-[34px]">{game.away_code}</span>
        <span className="display px-1 text-[20px] text-muted">at</span>
        <span className="display text-[34px]">{game.home_code}</span>
        <span aria-hidden className="h-6 w-1 rounded-[1px]" style={{ background: accentOf(h) }} />
      </Link>
      <p className="num flex flex-wrap gap-x-3 text-[13px] text-ink-2">
        <span>{timeET(game.tip)} ET</span>
        <span className="text-muted">{game.tv}</span>
        {ta && th ? (
          <span>
            {ta.w}-{ta.l} vs {th.w}-{th.l}
          </span>
        ) : null}
      </p>
      {o?.away_wp != null && o?.home_wp != null ? (
        <WinSplit away={game.away_code} home={game.home_code} awayWp={o.away_wp} homeWp={o.home_wp} awayTeam={a} homeTeam={h} />
      ) : null}
      {game.pick?.text ? <p className="text-[14px] leading-relaxed">{game.pick.text}</p> : null}
      <div className="flex flex-wrap gap-2">
        <span className="chip num">Line {o?.line ?? "not posted"}</span>
        {o?.total != null ? <span className="chip num">Total {o.total}</span> : null}
        <span className="chip num">
          Missing PPG {f1(missing.get(game.away_code)?.ppg ?? 0)} / {f1(missing.get(game.home_code)?.ppg ?? 0)}
        </span>
      </div>
    </article>
  );
}
