import type { Metadata } from "next";
import Link from "next/link";

import { CalibrationChart } from "@/components/charts/Calibration";
import { Empty, NoDatabase, SectionHead, TeamMark } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getModelPage, resolveDay, type ModelGame, type Team } from "@/lib/data";
import { f1, longDate, seasonLabel, shortDay } from "@/lib/format";
import { atsPct, atsWord, edgeText, lineText, pickTeam, recordText, winChances } from "@/lib/model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Model" };

const n = (k: number, word = "game") => `${k} ${word}${k === 1 ? "" : "s"}`;

function Matchup({ g, teams }: { g: ModelGame; teams: Map<string, Team> }) {
  return (
    <Link href={`/games/${g.game_id}`} className="inline-flex items-center gap-1.5 no-underline hover:underline">
      <TeamMark team={teams.get(g.away_code)} code={g.away_code} link={false} />
      <span className="text-muted">at</span>
      <TeamMark team={teams.get(g.home_code)} code={g.home_code} link={false} />
    </Link>
  );
}

function finalText(g: ModelGame): string {
  const m = g.actual_margin ?? 0;
  return m === 0 ? "Tied" : `${m > 0 ? g.home_code : g.away_code} by ${Math.abs(m)}`;
}

export default async function ModelPage({ searchParams }: { searchParams: Promise<{ date?: string; all?: string }> }) {
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof getModelPage>>;
  try {
    const { day } = await resolveDay(sp.date);
    data = await getModelPage(day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const header = (
    <header className="grid gap-2">
      <h1 className="display text-[56px] leading-[0.9] sm:text-[80px]">Model vs Vegas</h1>
      <p className="note max-w-[72ch]">
        Every game this season, predicted the morning of the game from the <Link href="/ratings">power ratings</Link> of that day, then checked against ESPN&apos;s
        pregame line and the final score. The model never sees a game before predicting it. Early in the season the samples are small, so every number shows
        how many games it rests on.
      </p>
    </header>
  );
  const bt = data?.backtest;
  if (!data || !bt || !bt.games)
    return (
      <div className="grid grid-cols-1 gap-8 pt-6 sm:pt-8">
        {header}
        <Empty title="No graded games yet">The backtest appears after the first night of the season is loaded.</Empty>
      </div>
    );
  const { teams, calibration, finals, upcoming, days, season } = data;
  const first = days[0];
  const picks = bt.ats_w + bt.ats_l + bt.ats_p;
  const cards = [
    { label: "Average miss, model", value: `${f1(bt.model_mae)} pts`, sub: `${n(bt.line_games)} with a line (${f1(bt.model_mae_all)} on all ${bt.games})` },
    { label: "Average miss, ESPN line", value: `${f1(bt.line_mae)} pts`, sub: `the same ${n(bt.line_games)}` },
    { label: "Against the line", value: recordText(bt.ats_w, bt.ats_l, bt.ats_p), sub: `${atsPct(bt.ats_w, bt.ats_l)} of ${n(picks, "pick")}` },
    { label: "Winners picked", value: `${bt.model_su_on_line_games} of ${bt.line_su_games}`, sub: `ESPN line ${bt.line_su_right} of ${bt.line_su_games}` },
    { label: "Home court", value: `${f1(bt.home_court)} pts`, sub: `starts at 2.0, ${n(bt.games)} in so far` },
    { label: "Spread of results", value: `${f1(bt.sigma)} pts`, sub: `starts at 12.0, ${n(bt.games)} in so far` },
  ];
  const shown = sp.all ? finals : finals.slice(0, 40);
  return (
    <div className="grid grid-cols-1 gap-10 pt-6 sm:pt-8">
      {header}
      <section className="grid gap-3">
        <p className="num text-[14px] text-ink-2">
          {seasonLabel(season)}, {n(bt.games)} graded through {longDate(finals[0]?.game_date ?? bt.as_of)}. Brier score {bt.brier?.toFixed(3)} (lower is better; always
          saying 50% scores 0.250).
        </p>
        <dl className="grid grid-cols-2 border-y border-line sm:grid-cols-3 lg:grid-cols-6">
          {cards.map((c, i) => (
            <div key={c.label} className={`grid content-start gap-1 px-1 py-4 sm:px-4 ${i % 2 ? "border-l border-line pl-4" : ""} sm:border-l sm:border-line ${i === 0 ? "sm:border-l-0 sm:pl-0" : ""}`}>
              <dt className="text-[12px] font-semibold text-muted">{c.label}</dt>
              <dd className="display num text-[34px] leading-none">{c.value}</dd>
              <dd className="text-[12px] text-ink-2">{c.sub}</dd>
            </div>
          ))}
        </dl>
        <p className="note max-w-[72ch]">
          The miss is the gap between the predicted margin and the final margin. Against the line, the model takes the side it likes better than ESPN&apos;s
          spread; at standard prices a bettor needs about 52.4% to break even. Home court and the spread of results start from typical NBA values and move
          toward this season&apos;s numbers as games come in{first ? `; the first ratings date was ${longDate(first.as_of)}` : ""}.
        </p>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="panel p-4 sm:p-6">
          <SectionHead title="Are the chances right?">
            Games grouped by the favorite&apos;s win chance. If the model is right, favorites given 70% win about 70% of the time, so the points sit on the dashed
            line. Bigger points hold more games.
          </SectionHead>
          <CalibrationChart bins={calibration} width={520} height={400} font={13} />
        </div>
        <div className="panel table-wrap self-start">
          <table className="data-table">
            <caption className="sr-only">Calibration of the win chance by bin</caption>
            <thead>
              <tr>
                <th>Favorite&apos;s chance</th>
                <th className="r">Games</th>
                <th className="r">Predicted</th>
                <th className="r">Favorites won</th>
              </tr>
            </thead>
            <tbody>
              {calibration.map((c) => (
                <tr key={c.lo}>
                  <td className="num">
                    {c.lo} to {c.hi}%
                  </td>
                  <td className="r num">{c.games}</td>
                  <td className="r num">{c.mean_wp === null ? "–" : `${f1(c.mean_wp)}%`}</td>
                  <td className="r num">{c.win_pct === null ? "–" : `${f1(c.win_pct)}% (${c.wins})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {upcoming.length ? (
        <section>
          <SectionHead title="Next 3 days">The model&apos;s line from this morning&apos;s ratings, next to ESPN&apos;s once it is posted.</SectionHead>
          <div className="panel table-wrap">
            <table className="data-table">
              <caption className="sr-only">Model lines for the next 3 days</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="sticky-col">Matchup</th>
                  <th>Model</th>
                  <th>ESPN line</th>
                  <th>Model likes</th>
                  <th className="r">Win chance</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((g) => {
                  const wc = winChances(g);
                  const fav = wc ? (wc.home >= wc.away ? `${g.home_code} ${f1(wc.home)}%` : `${g.away_code} ${f1(wc.away)}%`) : "–";
                  return (
                    <tr key={g.game_id}>
                      <td className="num text-ink-2">{shortDay(g.game_date)}</td>
                      <td className="sticky-col">
                        <Matchup g={g} teams={teams} />
                      </td>
                      <td className="num font-semibold">{lineText(g.home_code, g.away_code, g.pred_margin)}</td>
                      <td className="num">{g.line_margin === null ? <span className="text-muted">not posted</span> : lineText(g.home_code, g.away_code, g.line_margin)}</td>
                      <td className="num text-ink-2">{edgeText(g) ?? ""}</td>
                      <td className="r num">{fav}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section>
        <SectionHead title="Every graded game">
          Newest first. Final is the winning margin. Miss is how far each line was from it. Pick is the side the model liked against ESPN&apos;s line.
        </SectionHead>
        <div className="panel table-wrap">
          <table className="data-table">
            <caption className="sr-only">Model and ESPN line against the final score for every game this season</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th className="sticky-col">Matchup</th>
                <th>Model</th>
                <th>ESPN line</th>
                <th>Final</th>
                <th className="r">Model miss</th>
                <th className="r">Line miss</th>
                <th>Pick</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => {
                const mMiss = Math.abs((g.actual_margin ?? 0) - (g.pred_margin ?? 0));
                const lMiss = g.line_margin === null ? null : Math.abs((g.actual_margin ?? 0) - g.line_margin);
                const res = atsWord(g.ats);
                return (
                  <tr key={g.game_id}>
                    <td className="num text-ink-2">{shortDay(g.game_date)}</td>
                    <td className="sticky-col">
                      <Matchup g={g} teams={teams} />
                    </td>
                    <td className="num">{lineText(g.home_code, g.away_code, g.pred_margin)}</td>
                    <td className="num">{g.line_margin === null ? "–" : lineText(g.home_code, g.away_code, g.line_margin)}</td>
                    <td className="num">{finalText(g)}</td>
                    <td className={`r num ${lMiss !== null && mMiss < lMiss ? "font-semibold" : "text-ink-2"}`}>{f1(mMiss)}</td>
                    <td className={`r num ${lMiss !== null && lMiss < mMiss ? "font-semibold" : "text-ink-2"}`}>{f1(lMiss)}</td>
                    <td>
                      {pickTeam(g) ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-semibold">{pickTeam(g)}</span>
                          <span style={{ color: g.ats === "W" ? "var(--color-ok)" : g.ats === "L" ? "var(--color-out)" : "var(--color-muted)" }}>{res}</span>
                        </span>
                      ) : (
                        <span className="text-muted">none</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {finals.length > shown.length ? (
          <p className="note mt-3">
            Showing the newest 40 of {finals.length}. <Link href={`/model?${new URLSearchParams({ ...(sp.date ? { date: sp.date } : {}), all: "1" })}`}>Show every game</Link>.
          </p>
        ) : null}
      </section>
    </div>
  );
}
