import type { Metadata } from "next";

import { NetBars } from "@/components/charts/Bars";
import { OffDefScatter, type ScatterTeam } from "@/components/charts/OffDefScatter";
import { TeamTable, type TeamTableRow } from "@/components/tables/TeamTable";
import { accentOf, Empty, NoDatabase, SectionHead } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { CHART } from "@/lib/colors";
import { getTeamsPage, resolveDay } from "@/lib/data";
import { seasonLabel } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Teams" };

const KEYS = ["net", "ortg", "drtg", "pace", "efg", "tov_pct", "orb_pct", "ftr", "opp_efg", "opp_tov_pct", "drb_pct", "opp_ftr", "fg3_pct", "opp_fg3_pct", "ppg", "opp_ppg", "l5_net"];

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof getTeamsPage>>;
  try {
    const { day } = await resolveDay(sp.date);
    data = await getTeamsPage(day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const { teams, rows, season } = data;
  if (!rows.length) {
    return (
      <div className="py-10">
        <Empty title="No team stats yet">Team ratings appear after the first games of the season are loaded.</Empty>
      </div>
    );
  }
  const scatter: ScatterTeam[] = rows
    .filter((r) => r.ortg != null && r.drtg != null)
    .map((r) => {
      const t = teams.get(r.team_code);
      return {
        code: r.team_code,
        name: t?.display_name ?? r.team_code,
        conf: t?.conference ?? "",
        ortg: r.ortg!,
        drtg: r.drtg!,
        net: r.net,
        ortg_rk: r.ortg_rk,
        drtg_rk: r.drtg_rk,
        w: r.w,
        l: r.l,
        accent: accentOf(t),
      };
    });
  const table: TeamTableRow[] = rows.map((r) => {
    const t = teams.get(r.team_code);
    const rec = r as unknown as Record<string, number | null>;
    return {
      code: r.team_code,
      name: t?.display_name ?? r.team_code,
      conf: t?.conference ?? "",
      accent: accentOf(t),
      w: r.w,
      l: r.l,
      streak: r.streak,
      values: Object.fromEntries(KEYS.map((k) => [k, rec[k]])),
      ranks: Object.fromEntries(KEYS.map((k) => [k, rec[`${k}_rk`] ?? null])),
    };
  });
  const asOf = rows[0]?.as_of;
  return (
    <div className="grid grid-cols-1 gap-12 pt-6 sm:pt-8">
      <header className="grid gap-2">
        <h1 className="display text-[56px] leading-[0.9] sm:text-[80px]">Teams</h1>
        <p className="note">
          {seasonLabel(season)} regular season, games before {asOf}. Ratings are points per 100 possessions.
        </p>
      </header>
      <section>
        <SectionHead title="Offense vs defense">
          Points scored per 100 possessions across, points allowed up the page (fewer allowed is higher). The crossing lines mark the league average, so the top right is good on both ends.
        </SectionHead>
        <div className="panel p-4 sm:p-6">
          <div className="mb-3 flex gap-5 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART.east }} /> East
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART.west }} /> West
            </span>
          </div>
          <div className="hidden md:block">
            <OffDefScatter teams={scatter} width={1100} height={600} font={13} />
          </div>
          <div className="md:hidden">
            <OffDefScatter teams={scatter} width={380} height={420} font={10} dot={5} />
          </div>
        </div>
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div>
          <SectionHead title="Net rating">Points scored minus points allowed per 100 possessions: the best single number for how good a team has been.</SectionHead>
          <div className="panel p-4 sm:p-6">
            <NetBars
              rows={rows
                .filter((r) => r.net != null)
                .map((r) => ({ code: r.team_code, net: r.net!, accent: accentOf(teams.get(r.team_code)), name: teams.get(r.team_code)?.display_name ?? r.team_code, w: r.w, l: r.l, net_rk: r.net_rk }))}
              width={460}
              rowH={22}
            />
          </div>
        </div>
        <div>
          <SectionHead title="Team ratings">Offense, defense and the four factors on both ends.</SectionHead>
          <TeamTable rows={table} />
        </div>
      </section>
    </div>
  );
}
