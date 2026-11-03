import Link from "next/link";

import { DeltaMark, PmBar, TeamMark } from "@/components/ui/bits";
import type { BoxLine, Team, TeamGame } from "@/lib/data";
import { played } from "@/lib/data";
import { f1, signed } from "@/lib/format";

function capitalize(s: string | null): string {
  if (!s) return "";
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function BoxScore({ team, code, lines, totals }: { team?: Team; code: string; lines: BoxLine[]; totals: TeamGame | null }) {
  const rows = lines.filter((b) => b.team_code === code).sort((a, b) => a.box_order - b.box_order);
  const on = rows.filter(played);
  const dnp = rows.filter((b) => !played(b));
  const maxAbs = Math.max(1, ...on.map((b) => Math.abs(b.plus_minus ?? 0)));
  const firstBench = on.findIndex((b) => !b.starter);
  return (
    <div className="panel">
      <h3 className="flex items-center gap-2 px-4 pt-4 text-[18px] font-semibold sm:px-5">
        <TeamMark team={team} code={code} label={team?.display_name ?? code} />
      </h3>
      <div className="table-wrap mt-2">
        <table className="data-table">
          <caption className="sr-only">{team?.display_name ?? code} box score</caption>
          <thead>
            <tr>
              <th className="sticky-col">Player</th>
              <th>Pos</th>
              <th className="r">MIN</th>
              <th className="r">PTS</th>
              <th className="r">FG</th>
              <th className="r">3PT</th>
              <th className="r">FT</th>
              <th className="r">OREB</th>
              <th className="r">DREB</th>
              <th className="r">REB</th>
              <th className="r">AST</th>
              <th className="r">STL</th>
              <th className="r">BLK</th>
              <th className="r">TO</th>
              <th className="r">PF</th>
              <th className="r">+/-</th>
              <th className="r">PTS vs avg</th>
              <th>What stood out</th>
            </tr>
          </thead>
          <tbody>
            {on.map((b, i) => {
              const sep = i === firstBench && i > 0;
              const d = b.delta;
              return (
                <tr key={b.player_id} className={sep ? "group-break" : undefined}>
                  <td className="sticky-col">
                    <Link href={`/players/${b.player_id}`} className="font-semibold no-underline hover:underline">
                      {b.name}
                    </Link>
                    {b.starter ? null : <span className="sr-only"> (bench)</span>}
                  </td>
                  <td className="text-muted">{b.position}</td>
                  <td className="r num">{Math.round(b.min ?? 0)}</td>
                  <td className="r num font-bold">
                    {b.pts}
                    <DeltaMark delta={d?.d_pts} threshold={8} />
                  </td>
                  <td className="r num">
                    {b.fgm}-{b.fga}
                  </td>
                  <td className="r num">
                    {b.tpm}-{b.tpa}
                  </td>
                  <td className="r num">
                    {b.ftm}-{b.fta}
                  </td>
                  <td className="r num">{b.oreb}</td>
                  <td className="r num">{b.dreb}</td>
                  <td className="r num">
                    {b.reb}
                    <DeltaMark delta={d?.d_reb} threshold={5} />
                  </td>
                  <td className="r num">
                    {b.ast}
                    <DeltaMark delta={d?.d_ast} threshold={4} />
                  </td>
                  <td className="r num">{b.stl}</td>
                  <td className="r num">{b.blk}</td>
                  <td className="r num">{b.tov}</td>
                  <td className="r num">{b.pf}</td>
                  <td className="r">
                    <PmBar value={b.plus_minus} maxAbs={maxAbs} />
                  </td>
                  <td className="r num">{d?.gp_before ? signed(d.d_pts) : <span className="text-muted">first game</span>}</td>
                  <td className="text-ink-2">{(d?.flags ?? "").split(" · ").filter(Boolean).join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
          {totals ? (
            <tfoot>
              <tr>
                <td className="sticky-col font-semibold">Team</td>
                <td />
                <td className="r num">{totals.minutes * 5}</td>
                <td className="r num font-bold">{totals.pts}</td>
                <td className="r num">
                  {totals.fgm}-{totals.fga}
                </td>
                <td className="r num">
                  {totals.tpm}-{totals.tpa}
                </td>
                <td className="r num">
                  {totals.ftm}-{totals.fta}
                </td>
                <td className="r num">{totals.oreb}</td>
                <td className="r num">{totals.dreb}</td>
                <td className="r num">{totals.reb}</td>
                <td className="r num">{totals.ast}</td>
                <td className="r num">{totals.stl}</td>
                <td className="r num">{totals.blk}</td>
                <td className="r num">{totals.tov}</td>
                <td className="r num">{totals.pf}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {totals ? (
        <dl className="num grid grid-cols-3 gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-[13px] sm:grid-cols-6 sm:px-5 lg:grid-cols-11">
          {(
            [
              ["FG%", f1(totals.fg_pct)],
              ["3P%", f1(totals.fg3_pct)],
              ["FT%", f1(totals.ft_pct)],
              ["eFG%", f1(totals.efg)],
              ["TOV%", f1(totals.tov_pct)],
              ["ORB%", f1(totals.orb_pct)],
              ["Poss", f1(totals.poss)],
              ["Off rating", f1(totals.ortg)],
              ["Bench", String(totals.bench_pts)],
              ["Paint", String(totals.paint)],
              ["Fast break", String(totals.fb)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="grid">
              <dt className="text-[11px] text-muted">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="note border-t border-line px-4 py-3 sm:px-5">
        Did not play:{" "}
        {dnp.length
          ? dnp.map((b, i) => (
              <span key={b.player_id}>
                {i ? "; " : ""}
                <span className="text-ink-2">{b.name}</span>
                {b.reason ? ` (${capitalize(b.reason)})` : ""}
              </span>
            ))
          : "nobody"}
      </p>
    </div>
  );
}
