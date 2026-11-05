import Link from "next/link";

import { accentOf, PmBar, StatusBadge, TeamMark } from "@/components/ui/bits";
import type { Injury, MissingRow, PlayerSeason, Team, TeamSeason, TonightGame } from "@/lib/data";
import { f1, isNum, longDate, ordinal, shortDay, signed, signedInt, tipTime } from "@/lib/format";
import { edgeOf, MATCHUP_ROWS, STATUS_ORDER } from "@/lib/metrics";
import { edgeText, lineText, winChances } from "@/lib/model";

function restText(r: number | null) {
  if (r === null || r === undefined) return "first game";
  if (r === 0) return "none (played the day before)";
  return `${r} day${r === 1 ? "" : "s"}`;
}

/** Second night: played the day before. First night: plays again the next day. From the schedule. */
function b2bText(second: boolean, first: boolean) {
  if (second && first) return "Second night, and plays the next day";
  if (second) return "Second night";
  if (first) return "First night";
  return "No";
}

function Comparison({ game, teams, teamSeason, missing }: { game: TonightGame; teams: Map<string, Team>; teamSeason: Map<string, TeamSeason>; missing: Map<string, MissingRow> }) {
  const a = teamSeason.get(game.away_code);
  const h = teamSeason.get(game.home_code);
  const groups = ["Overall", "Offense", "Defense"] as const;
  const val = (ts: TeamSeason | undefined, key: string, sgn?: boolean) => {
    const v = ts ? (ts as unknown as Record<string, number | null>)[key] : null;
    return sgn ? signed(v) : f1(v);
  };
  return (
    <div className="panel table-wrap">
      <table className="data-table">
        <caption className="sr-only">Season stats for both teams with league ranks</caption>
        <thead>
          <tr>
            <th className="sticky-col">Season stat</th>
            <th className="r">
              <TeamMark team={teams.get(game.away_code)} code={game.away_code} link={false} />
            </th>
            <th className="r">
              <TeamMark team={teams.get(game.home_code)} code={game.home_code} link={false} />
            </th>
            <th>Edge</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sticky-col">Record</td>
            <td className="r num">{a ? `${a.w}-${a.l}` : "–"}</td>
            <td className="r num">{h ? `${h.w}-${h.l}` : "–"}</td>
            <td />
          </tr>
          <tr>
            <td className="sticky-col">Days of rest</td>
            <td className="r">{restText(game.away_rest)}</td>
            <td className="r">{restText(game.home_rest)}</td>
            <td />
          </tr>
          {game.preview ? (
            <tr>
              <td className="sticky-col">Back-to-back</td>
              <td className="r">{b2bText(game.preview.away_b2b, game.preview.away_b2b_next)}</td>
              <td className="r">{b2bText(game.preview.home_b2b, game.preview.home_b2b_next)}</td>
              <td />
            </tr>
          ) : null}
          <tr>
            <td className="sticky-col">Win odds</td>
            <td className="r num">{isNum(game.odds?.away_wp) ? `${game.odds!.away_wp!.toFixed(1)}%` : "–"}</td>
            <td className="r num">{isNum(game.odds?.home_wp) ? `${game.odds!.home_wp!.toFixed(1)}%` : "–"}</td>
            <td />
          </tr>
          {game.model ? (
            <tr>
              <td className="sticky-col">
                <Link href="/model">Model</Link> win chance
              </td>
              <td className="r num">{f1(winChances(game.model)?.away)}%</td>
              <td className="r num">{f1(winChances(game.model)?.home)}%</td>
              <td className="text-ink-2">{edgeText(game.model) ? `Against the line: ${edgeText(game.model)}` : ""}</td>
            </tr>
          ) : null}
          <tr>
            <td className="sticky-col">Scoring missing (PPG)</td>
            <td className="r num">{f1(missing.get(game.away_code)?.ppg)}</td>
            <td className="r num">{f1(missing.get(game.home_code)?.ppg)}</td>
            <td />
          </tr>
          {groups.map((grp) => (
            <GroupRows key={grp} grp={grp} game={game} a={a} h={h} val={val} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  grp,
  game,
  a,
  h,
  val,
}: {
  grp: "Overall" | "Offense" | "Defense";
  game: TonightGame;
  a?: TeamSeason;
  h?: TeamSeason;
  val: (ts: TeamSeason | undefined, key: string, sgn?: boolean) => string;
}) {
  const rows = MATCHUP_ROWS.filter((r) => r.group === grp);
  return (
    <>
      <tr className="group-break">
        <td className="sticky-col pt-4 font-semibold text-muted" colSpan={1}>
          {grp}
        </td>
        <td colSpan={3} className="pt-4" />
      </tr>
      {rows.map((r) => {
        const e = r.edge === false ? null : edgeOf(game.away_code, game.home_code, a as never, h as never, r.key);
        const rk = (ts?: TeamSeason) => (ts ? (ts as unknown as Record<string, number | null>)[`${r.key}_rk`] : null);
        const win = (code: string) => e && e.team === code;
        return (
          <tr key={r.key}>
            <td className="sticky-col">{r.label}</td>
            <td className={`r num ${win(game.away_code) ? "font-bold text-ink" : "text-ink-2"}`}>
              {val(a, r.key, r.signed)} <span className="ml-1 text-[11px] font-normal text-muted">{ordinal(rk(a))}</span>
            </td>
            <td className={`r num ${win(game.home_code) ? "font-bold text-ink" : "text-ink-2"}`}>
              {val(h, r.key, r.signed)} <span className="ml-1 text-[11px] font-normal text-muted">{ordinal(rk(h))}</span>
            </td>
            <td className="num">
              {e ? (
                e.team === "Even" ? (
                  <span className="text-muted">Even</span>
                ) : (
                  <span className={e.big ? "font-semibold text-clock" : "text-ink-2"}>
                    {e.team} by {e.by}
                    {e.big ? <span className="sr-only"> (10 or more spots)</span> : null}
                  </span>
                )
              ) : null}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function InjuryList({
  team,
  code,
  injuries,
  players,
  missing,
  report,
}: {
  team?: Team;
  code: string;
  injuries: Injury[];
  players: Map<string, PlayerSeason>;
  missing?: MissingRow;
  report: string | null;
}) {
  const rows = injuries
    .filter((i) => i.team_code === code)
    .sort((x, y) => (STATUS_ORDER[x.status] ?? 9) - (STATUS_ORDER[y.status] ?? 9) || (players.get(`${code}|${y.player_name}`)?.ppg ?? -1) - (players.get(`${code}|${x.player_name}`)?.ppg ?? -1));
  return (
    <div className="panel p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-[17px] font-semibold">
        <TeamMark team={team} code={code} /> injury list
      </h3>
      {report ? (
        <p className="note mt-1">
          Out or doubtful players average <span className="num font-semibold text-ink">{f1(missing?.ppg ?? 0)}</span> points a game this season.
          <span className="block text-muted">From the injury report of {shortDay(report)}.</span>
        </p>
      ) : (
        <p className="note mt-1">No injury report covers this game yet. The daily run adds one for every game in the next 3 days.</p>
      )}
      {!report ? null : rows.length ? (
        <ul className="mt-3 grid gap-2.5">
          {rows.map((i) => {
            const p = players.get(`${code}|${i.player_name}`);
            return (
              <li key={i.player_name} className="grid gap-0.5 border-t border-line pt-2.5 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {p ? (
                    <Link href={`/players/${p.player_id}`} className="font-semibold no-underline hover:underline">
                      {i.player_name}
                    </Link>
                  ) : (
                    <span className="font-semibold">{i.player_name}</span>
                  )}
                  <StatusBadge status={i.status} />
                  {i.injury ? <span className="text-[13px] text-muted">{i.injury}</span> : null}
                </div>
                <div className="num flex flex-wrap gap-x-4 text-[13px] text-ink-2">
                  {p ? (
                    <>
                      <span>{f1(p.ppg)} ppg</span>
                      <span>{f1(p.mpg)} min</span>
                      <span>{signed(p.pm_pg)} +/- per game</span>
                    </>
                  ) : (
                    <span className="text-muted">No games this season</span>
                  )}
                  {i.note ? <span className="text-muted">{i.note}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-[14px] text-muted">Nobody listed.</p>
      )}
    </div>
  );
}

function Rotation({ team, code, players, injuries }: { team?: Team; code: string; players: PlayerSeason[]; injuries: Injury[] }) {
  const status = new Map(injuries.filter((i) => i.team_code === code).map((i) => [i.player_name, i.status]));
  const rows = players.filter((p) => p.team_code === code && p.team_mpg_rank <= 10).sort((x, y) => (y.mpg ?? 0) - (x.mpg ?? 0));
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.pm_pg ?? 0)));
  return (
    <div className="panel">
      <h3 className="flex items-center gap-2 px-4 pt-4 text-[17px] font-semibold sm:px-5">
        <TeamMark team={team} code={code} /> rotation
      </h3>
      <p className="note px-4 pb-2 sm:px-5">Top 10 in minutes this season. Plus-minus is the scoring margin while he is on the floor.</p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="sticky-col">Player</th>
              <th>Status</th>
              <th className="r">GP</th>
              <th className="r">MIN</th>
              <th className="r">PTS</th>
              <th className="r">REB</th>
              <th className="r">AST</th>
              <th className="r">3PM</th>
              <th className="r">FG%</th>
              <th className="r">TS%</th>
              <th className="r">+/- per game</th>
              <th className="r">+/- total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.player_id}>
                <td className="sticky-col">
                  <Link href={`/players/${p.player_id}`} className="font-semibold no-underline hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td>{status.get(p.name) ? <StatusBadge status={status.get(p.name)!} /> : null}</td>
                <td className="r num">{p.gp}</td>
                <td className="r num">{f1(p.mpg)}</td>
                <td className="r num font-semibold">{f1(p.ppg)}</td>
                <td className="r num">{f1(p.rpg)}</td>
                <td className="r num">{f1(p.apg)}</td>
                <td className="r num">{f1(p.fg3m_pg)}</td>
                <td className="r num">{f1(p.fg_pct)}</td>
                <td className="r num">{f1(p.ts_pct)}</td>
                <td className="r">
                  <PmBar value={p.pm_pg} maxAbs={maxAbs} digits={1} />
                </td>
                <td className="r num">{signedInt(p.pm_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Matchup({
  game,
  games,
  teams,
  teamSeason,
  players,
  injuries,
  missing,
  report,
}: {
  game: TonightGame;
  games: TonightGame[];
  teams: Map<string, Team>;
  teamSeason: Map<string, TeamSeason>;
  players: PlayerSeason[];
  injuries: Injury[];
  missing: Map<string, MissingRow>;
  report: string | null; // date of the injury report used, null when none covers this game
}) {
  const pidx = new Map(players.map((p) => [`${p.team_code}|${p.name}`, p]));
  return (
    <div className="grid gap-5">
      <nav aria-label="Pick a game" className="flex flex-wrap gap-1.5">
        {games.map((g) => (
          <Link
            key={g.id}
            href={`/?date=${g.game_date}&game=${encodeURIComponent(g.code)}#matchup`}
            aria-current={g.code === game.code ? "true" : undefined}
            className={`rounded border px-2.5 py-1 text-[13px] no-underline ${g.code === game.code ? "border-clock text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}
          >
            {g.away_code} at {g.home_code}
          </Link>
        ))}
      </nav>
      <div className="panel grid gap-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-7 w-1.5 rounded-[1px]" style={{ background: accentOf(teams.get(game.away_code)) }} />
            <span className="display text-[40px]">{game.away_code}</span>
            <span className="display text-[24px] text-muted">at</span>
            <span className="display text-[40px]">{game.home_code}</span>
            <span aria-hidden className="h-7 w-1.5 rounded-[1px]" style={{ background: accentOf(teams.get(game.home_code)) }} />
          </span>
          <span className="num flex flex-wrap gap-x-4 text-[14px] text-ink-2">
            <span>{longDate(game.game_date)}</span>
            <span>{tipTime(game)} ET</span>
            <span>{game.tv}</span>
            <span>Line {game.odds?.line ?? "not posted"}</span>
            {game.model ? (
              <Link href={`/games/${game.id}#model`} className="text-ink-2">
                Model {lineText(game.home_code, game.away_code, game.model.pred_margin)}
              </Link>
            ) : null}
            {game.odds?.total != null ? <span>Total {game.odds.total}</span> : null}
          </span>
        </div>
        {game.pick?.text ? <p className="max-w-[72ch]">{game.pick.text}</p> : null}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start">
        <Comparison game={game} teams={teams} teamSeason={teamSeason} missing={missing} />
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-1">
          <InjuryList team={teams.get(game.away_code)} code={game.away_code} injuries={injuries} players={pidx} missing={missing.get(game.away_code)} report={report} />
          <InjuryList team={teams.get(game.home_code)} code={game.home_code} injuries={injuries} players={pidx} missing={missing.get(game.home_code)} report={report} />
        </div>
      </div>
      <Rotation team={teams.get(game.away_code)} code={game.away_code} players={players} injuries={injuries} />
      <Rotation team={teams.get(game.home_code)} code={game.home_code} players={players} injuries={injuries} />
    </div>
  );
}
