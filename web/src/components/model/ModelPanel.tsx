import Link from "next/link";

import { SectionHead, TeamMark, WinSplit } from "@/components/ui/bits";
import type { ModelGame, Odds, PowerRating, Team } from "@/lib/data";
import { f1, longDate, ordinal, signed } from "@/lib/format";
import { atsWord, edgeText, lineText, pickTeam, pts, winChances } from "@/lib/model";

/** The model's line next to ESPN's for one game, with the parts that make up the margin and, once played, the result. */
export function ModelPanel({ m, teams, ratings, odds }: { m: ModelGame; teams: Map<string, Team>; ratings: Map<string, PowerRating>; odds: Odds | null }) {
  const a = teams.get(m.away_code);
  const h = teams.get(m.home_code);
  const wc = winChances(m);
  const fromRatings = (m.pred_margin ?? 0) - (m.home_court ?? 0) - (m.rest_adj ?? 0);
  const played = m.actual_margin !== null;
  const final = played ? (m.actual_margin === 0 ? "Tied" : `${m.actual_margin! > 0 ? m.home_code : m.away_code} by ${Math.abs(m.actual_margin!)}`) : null;
  const ra = ratings.get(m.away_code);
  const rh = ratings.get(m.home_code);
  const edge = edgeText(m);
  const result = atsWord(m.ats);
  return (
    <section id="model" className="panel grid gap-5 p-4 sm:p-6">
      <SectionHead title="Model vs ESPN line">
        The model&apos;s line from the <Link href="/ratings">power ratings</Link> on the morning of {longDate(m.as_of)} ({m.fit_games} games before it), next to
        ESPN&apos;s{m.line_source === "pbp" ? " pregame spread" : " line once it is posted"}. <Link href="/model">How the model has done this season</Link>.
      </SectionHead>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <dl className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <dt className="text-[12px] font-semibold text-muted">Model</dt>
              <dd className="display num text-[34px] leading-none">{lineText(m.home_code, m.away_code, m.pred_margin)}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-[12px] font-semibold text-muted">ESPN line</dt>
              {m.line_margin === null ? (
                <dd className="pt-2 text-[15px] text-muted">Not posted yet</dd>
              ) : (
                <dd className="display num text-[34px] leading-none">{lineText(m.home_code, m.away_code, m.line_margin)}</dd>
              )}
            </div>
          </dl>
          {wc ? <WinSplit away={m.away_code} home={m.home_code} awayWp={wc.away} homeWp={wc.home} awayTeam={a} homeTeam={h} /> : null}
          <p className="text-[14px] text-ink-2">
            Model win chance from its margin and a spread of results of {f1(m.sigma)} points.
            {odds?.away_wp != null && odds?.home_wp != null ? ` ESPN: ${m.away_code} ${f1(odds.away_wp)}%, ${m.home_code} ${f1(odds.home_wp)}%.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {edge ? <span className="chip num">Model likes {edge}</span> : null}
            {final ? <span className="chip num">Final: {final}</span> : null}
            {played && result ? (
              <span className="chip num" style={{ color: m.ats === "W" ? "var(--color-ok)" : m.ats === "L" ? "var(--color-out)" : undefined }}>
                Pick {pickTeam(m)}: {result.toLowerCase()}
              </span>
            ) : null}
            {played ? (
              <span className="chip num">
                Miss: model {f1(Math.abs(m.actual_margin! - (m.pred_margin ?? 0)))}
                {m.line_margin !== null ? `, line ${f1(Math.abs(m.actual_margin! - m.line_margin))}` : ""}
              </span>
            ) : null}
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">How the model builds its margin for {m.home_code}</caption>
            <thead>
              <tr>
                <th className="sticky-col">Part of the margin</th>
                <th className="r">{m.home_code} pts</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sticky-col">
                  <span className="grid gap-1">
                    <span>Rating gap at {f1(m.poss)} possessions</span>
                    <span className="flex flex-wrap gap-x-3 text-[12px] text-muted">
                      {[
                        [m.away_code, ra],
                        [m.home_code, rh],
                      ].map(([code, r]) => (
                        <span key={code as string} className="inline-flex items-center gap-1">
                          <TeamMark team={teams.get(code as string)} code={code as string} link={false} />
                          net {signed((r as PowerRating | undefined)?.adj_net)} ({ordinal((r as PowerRating | undefined)?.net_rk)})
                        </span>
                      ))}
                    </span>
                  </span>
                </td>
                <td className="r num">{pts(fromRatings)}</td>
              </tr>
              <tr>
                <td className="sticky-col">Home court</td>
                <td className="r num">{pts(m.home_court)}</td>
              </tr>
              <tr>
                <td className="sticky-col">Back-to-back</td>
                <td className="r num">{pts(m.rest_adj)}</td>
              </tr>
              <tr>
                <td className="sticky-col font-semibold">Predicted margin</td>
                <td className="r num font-semibold">{pts(m.pred_margin)}</td>
              </tr>
              {played ? (
                <tr>
                  <td className="sticky-col">Final margin</td>
                  <td className="r num">{pts(m.actual_margin)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
