import Link from "next/link";

import { QuarterFlow } from "@/components/charts/QuarterFlow";
import { accentOf, DeltaMark, PmBar } from "@/components/ui/bits";
import type { BoxLine, Result, Team } from "@/lib/data";
import { played } from "@/lib/data";
import { signed, signedInt } from "@/lib/format";

export function ScoreLine({ r, teams, size = "md" }: { r: Result; teams: Map<string, Team>; size?: "md" | "lg" }) {
  const big = size === "lg" ? "text-[56px] sm:text-[72px]" : "text-[34px]";
  const code = size === "lg" ? "text-[28px] sm:text-[36px]" : "text-[20px]";
  const side = (c: string, score: number | null, right: boolean) => {
    const won = r.winner_code === c;
    return (
      <span className={`flex items-center gap-2 ${right ? "flex-row-reverse" : ""} ${won ? "" : "opacity-55"}`}>
        <span aria-hidden className={`${size === "lg" ? "h-10 w-2" : "h-6 w-1"} rounded-[1px]`} style={{ background: accentOf(teams.get(c)) }} />
        <span className={`display ${code}`}>{c}</span>
        <span className={`display num ${big}`}>{score}</span>
      </span>
    );
  };
  return (
    <div className="flex items-center justify-between gap-2">
      {side(r.away_code, r.away_score, false)}
      <span className="text-[12px] text-muted">{r.ot ? (r.ot === 1 ? "Final/OT" : `Final/${r.ot}OT`) : "Final"}</span>
      {side(r.home_code, r.home_score, true)}
    </div>
  );
}

export function ResultCards({ results, teams }: { results: Result[]; teams: Map<string, Team> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {results.map((r) => (
        <article key={r.id} className="panel grid content-start gap-3 p-4">
          <div className="flex items-center justify-between">
            <Link href={`/games/${r.id}`} className="text-[13px] font-semibold text-ink-2">
              Box score
            </Link>
            {r.upset ? <span className="chip text-clock">Upset by record</span> : null}
          </div>
          <ScoreLine r={r} teams={teams} />
          <QuarterFlow
            away={r.away_code}
            home={r.home_code}
            awayPeriods={r.away_periods}
            homePeriods={r.home_periods}
            awayColor={accentOf(teams.get(r.away_code))}
            homeColor={accentOf(teams.get(r.home_code))}
            width={320}
            height={104}
          />
          {r.note ? <p className="text-[14px] leading-relaxed">{r.note}</p> : null}
        </article>
      ))}
    </div>
  );
}

export function NightLeaders({ box, teams }: { box: BoxLine[]; teams: Map<string, Team> }) {
  const lines = box.filter(played);
  if (!lines.length) return null;
  const byPm = lines.filter((b) => b.plus_minus !== null).sort((a, b) => (b.plus_minus ?? 0) - (a.plus_minus ?? 0));
  const best = byPm.slice(0, 5);
  const worst = byPm.slice(-5).reverse();
  const standout = lines
    .filter((b) => (b.pts ?? 0) >= 15 || (b.reb ?? 0) >= 10 || (b.ast ?? 0) >= 10 || Math.abs(b.plus_minus ?? 0) >= 15)
    .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));
  const maxAbs = Math.max(1, ...standout.map((b) => Math.abs(b.plus_minus ?? 0)));
  const pmList = (rows: BoxLine[]) => (
    <ol className="grid gap-1.5">
      {rows.map((b) => (
        <li key={`${b.game_id}-${b.player_id}`} className="flex items-baseline justify-between gap-3">
          <span>
            <Link href={`/players/${b.player_id}`} className="font-semibold no-underline hover:underline">
              {b.name}
            </Link>{" "}
            <span className="text-[13px] text-muted">
              {b.team_code} vs {b.opp_code}, {Math.round(b.min ?? 0)} min
            </span>
          </span>
          <span className="num font-semibold">{signedInt(b.plus_minus)}</span>
        </li>
      ))}
    </ol>
  );
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="panel p-4 sm:p-5">
          <h3 className="mb-3 text-[17px] font-semibold">Best plus-minus</h3>
          {pmList(best)}
        </div>
        <div className="panel p-4 sm:p-5">
          <h3 className="mb-3 text-[17px] font-semibold">Worst plus-minus</h3>
          {pmList(worst)}
        </div>
      </div>
      <div className="panel">
        <h3 className="px-4 pt-4 text-[17px] font-semibold sm:px-5">Best stat lines</h3>
        <p className="note px-4 pb-2 sm:px-5">15 or more points, 10 or more rebounds or assists, or plus-minus of 15 either way. Arrows mark lines well above or below his average before the game.</p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sticky-col">Player</th>
                <th>Team</th>
                <th className="r">MIN</th>
                <th className="r">PTS</th>
                <th className="r">REB</th>
                <th className="r">AST</th>
                <th className="r">STL</th>
                <th className="r">BLK</th>
                <th className="r">FG</th>
                <th className="r">3PT</th>
                <th className="r">TS%</th>
                <th className="r">+/-</th>
                <th className="r">PTS vs avg</th>
                <th>What stood out</th>
              </tr>
            </thead>
            <tbody>
              {standout.map((b) => (
                <tr key={`${b.game_id}-${b.player_id}`}>
                  <td className="sticky-col">
                    <Link href={`/players/${b.player_id}`} className="font-semibold no-underline hover:underline">
                      {b.name}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/games/${b.game_id}`} className="no-underline hover:underline">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: accentOf(teams.get(b.team_code)) }} />
                        {b.team_code}
                      </span>
                    </Link>
                  </td>
                  <td className="r num">{Math.round(b.min ?? 0)}</td>
                  <td className="r num font-bold">
                    {b.pts}
                    <DeltaMark delta={b.delta?.d_pts} threshold={8} />
                  </td>
                  <td className="r num">
                    {b.reb}
                    <DeltaMark delta={b.delta?.d_reb} threshold={5} />
                  </td>
                  <td className="r num">
                    {b.ast}
                    <DeltaMark delta={b.delta?.d_ast} threshold={4} />
                  </td>
                  <td className="r num">{b.stl}</td>
                  <td className="r num">{b.blk}</td>
                  <td className="r num">
                    {b.fgm}-{b.fga}
                  </td>
                  <td className="r num">
                    {b.tpm}-{b.tpa}
                  </td>
                  <td className="r num">{b.ts_pct?.toFixed(1) ?? ""}</td>
                  <td className="r">
                    <PmBar value={b.plus_minus} maxAbs={maxAbs} />
                  </td>
                  <td className="r num">{b.delta?.gp_before ? signed(b.delta.d_pts) : ""}</td>
                  <td className="text-ink-2">{(b.delta?.flags ?? "").split(" · ").filter(Boolean).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
