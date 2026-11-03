import Link from "next/link";

import { accentOf, WinSplit } from "@/components/ui/bits";
import type { MissingRow, Team, TeamSeason, TonightGame } from "@/lib/data";
import { f1, ordinal, signed, timeET } from "@/lib/format";

function Side({ team, code, ts, align }: { team?: Team; code: string; ts?: TeamSeason; align: "left" | "right" }) {
  const right = align === "right";
  return (
    <div className={`grid gap-2 ${right ? "justify-items-end text-right" : ""}`}>
      <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
        <span aria-hidden className="block h-[64px] w-2.5 rounded-[2px] sm:h-[88px]" style={{ background: accentOf(team) }} />
        <Link href={`/teams/${code}`} className="display text-[64px] leading-[0.85] no-underline sm:text-[96px]">
          {code}
        </Link>
      </div>
      <div className="text-[15px] text-ink-2">
        <span className="font-semibold text-ink">{team?.nickname ?? code}</span>
        {ts ? <span className="num"> {ts.w}-{ts.l}</span> : null}
      </div>
      {ts ? (
        <div className={`num flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-muted ${right ? "justify-end" : ""}`}>
          <span className="whitespace-nowrap">
            Net {signed(ts.net)} <span className="text-ink-2">{ordinal(ts.net_rk)}</span>
          </span>
          <span className="whitespace-nowrap">
            Off {f1(ts.ortg)} <span className="text-ink-2">{ordinal(ts.ortg_rk)}</span>
          </span>
          <span className="whitespace-nowrap">
            Def {f1(ts.drtg)} <span className="text-ink-2">{ordinal(ts.drtg_rk)}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function GameOfNight({
  game,
  teams,
  teamSeason,
  missing,
  label,
}: {
  game: TonightGame;
  teams: Map<string, Team>;
  teamSeason: Map<string, TeamSeason>;
  missing: Map<string, MissingRow>;
  label: string;
}) {
  const a = teams.get(game.away_code);
  const h = teams.get(game.home_code);
  const o = game.odds;
  const noRest = [game.away_code, game.home_code].filter((c, i) => (i === 0 ? game.away_rest : game.home_rest) === 0);
  const ma = missing.get(game.away_code)?.ppg ?? 0;
  const mh = missing.get(game.home_code)?.ppg ?? 0;
  return (
    <article className="panel panel-notch relative overflow-hidden p-5 sm:p-8" aria-labelledby="gotn">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="gotn" className="display text-[22px] text-clock">
          {label}
        </h2>
        <p className="num text-[14px] text-ink-2">
          {timeET(game.tip)} ET <span className="ml-3 text-muted">{game.tv}</span>
        </p>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-start gap-3 sm:gap-6">
        <Side team={a} code={game.away_code} ts={teamSeason.get(game.away_code)} align="left" />
        <span className="display pt-4 text-[28px] text-muted sm:pt-8 sm:text-[36px]">at</span>
        <Side team={h} code={game.home_code} ts={teamSeason.get(game.home_code)} align="right" />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:items-end">
        <div className="grid gap-3">
          {o?.away_wp != null && o?.home_wp != null ? (
            <WinSplit away={game.away_code} home={game.home_code} awayWp={o.away_wp} homeWp={o.home_wp} awayTeam={a} homeTeam={h} />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <span className="chip num">Line {o?.line ?? "not posted"}</span>
            {o?.total != null ? <span className="chip num">Total {o.total}</span> : null}
            {noRest.length ? <span className="chip">No rest: {noRest.join(", ")}</span> : null}
            {ma || mh ? (
              <span className="chip num">
                Missing PPG {game.away_code} {f1(ma)}, {game.home_code} {f1(mh)}
              </span>
            ) : null}
          </div>
        </div>
        {game.pick?.text ? <p className="max-w-[60ch] text-[16px] leading-relaxed text-ink">{game.pick.text}</p> : null}
      </div>
      <div className="mt-5">
        <Link href={`/?date=${game.game_date}&game=${encodeURIComponent(game.code)}#matchup`} className="text-[14px] text-ink-2">
          Break down this matchup
        </Link>
      </div>
    </article>
  );
}
