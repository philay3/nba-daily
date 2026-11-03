import type { Metadata } from "next";

import { PlayerTable, type PlayerRow } from "@/components/tables/PlayerTable";
import { accentOf, Empty, NoDatabase } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { getPlayersPage, resolveDay } from "@/lib/data";
import { seasonLabel } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Players" };

const KEYS = ["gp", "mpg", "ppg", "rpg", "apg", "spg", "bpg", "tovpg", "fg_pct", "fg3m_pg", "fg3_pct", "ft_pct", "ts_pct", "pm_pg", "pm_total"];

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof getPlayersPage>>;
  try {
    const { day } = await resolveDay(sp.date);
    data = await getPlayersPage(day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const { rows, teams, season } = data;
  const table: PlayerRow[] = rows.map((p) => {
    const rec = p as unknown as Record<string, number | null>;
    return {
      id: p.player_id,
      name: p.name,
      team: p.team_code,
      accent: accentOf(teams.get(p.team_code)),
      pos: p.position,
      values: Object.fromEntries(KEYS.map((k) => [k, rec[k]])),
    };
  });
  return (
    <div className="grid grid-cols-1 gap-8 pt-6 sm:pt-8">
      <header className="grid gap-2">
        <h1 className="display text-[56px] leading-[0.9] sm:text-[80px]">Players</h1>
        <p className="note max-w-[72ch]">
          {seasonLabel(season)} season averages through last night, sorted by total plus-minus. TS% is true shooting, which counts threes and free throws.
          A player traded mid-season is listed with his latest team.
        </p>
      </header>
      {table.length ? <PlayerTable rows={table} /> : <Empty title="No player stats yet">They appear after the first games of the season are loaded.</Empty>}
    </div>
  );
}
