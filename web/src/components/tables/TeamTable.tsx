"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type TeamTableRow = {
  code: string;
  name: string;
  conf: string;
  accent: string;
  w: number;
  l: number;
  streak: string;
  values: Record<string, number | null>;
  ranks: Record<string, number | null>;
};

const COLS: { key: string; label: string; title: string; signed?: boolean; lowBetter?: boolean; noRank?: boolean }[] = [
  { key: "net", label: "Net", title: "Net rating", signed: true },
  { key: "ortg", label: "Off rtg", title: "Offensive rating" },
  { key: "drtg", label: "Def rtg", title: "Defensive rating, lower is better", lowBetter: true },
  { key: "pace", label: "Pace", title: "Possessions per 48 minutes", noRank: true },
  { key: "efg", label: "eFG%", title: "Effective field goal %" },
  { key: "tov_pct", label: "TOV%", title: "Turnover %, lower is better", lowBetter: true },
  { key: "orb_pct", label: "ORB%", title: "Offensive rebound %" },
  { key: "ftr", label: "FT rate", title: "Free throws made per field goal attempt" },
  { key: "opp_efg", label: "Opp eFG%", title: "Opponent effective FG %, lower is better", lowBetter: true },
  { key: "opp_tov_pct", label: "Forced TOV%", title: "Forced turnover %" },
  { key: "drb_pct", label: "DRB%", title: "Defensive rebound %" },
  { key: "opp_ftr", label: "Opp FT rate", title: "Opponent free throw rate, lower is better", lowBetter: true },
  { key: "fg3_pct", label: "3P%", title: "3-point %" },
  { key: "opp_fg3_pct", label: "Opp 3P%", title: "Opponent 3-point %, lower is better", lowBetter: true },
  { key: "ppg", label: "PPG", title: "Points per game" },
  { key: "opp_ppg", label: "Opp PPG", title: "Points allowed per game", lowBetter: true },
  { key: "l5_net", label: "Last 5 net", title: "Net rating over the last 5 games", signed: true },
];

function fmt(v: number | null, signed?: boolean) {
  if (v === null || v === undefined) return "–";
  const s = Math.abs(v).toFixed(1);
  if (!signed) return v.toFixed(1);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : "0.0";
}

export function TeamTable({ rows }: { rows: TeamTableRow[] }) {
  const [conf, setConf] = useState<"all" | "East" | "West">("all");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "net", dir: -1 });
  const shown = useMemo(() => {
    const r = rows.filter((x) => conf === "all" || x.conf === conf);
    const val = (x: TeamTableRow) => (sort.key === "team" ? x.code : sort.key === "w" ? x.w : sort.key === "l" ? x.l : x.values[sort.key]);
    return [...r].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * sort.dir;
      return ((va ?? -1e9) - (vb ?? -1e9)) * sort.dir;
    });
  }, [rows, conf, sort]);
  const click = (key: string) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "team" ? 1 : -1 }));
  const aria = (key: string) => (sort.key === key ? (sort.dir === -1 ? "descending" : "ascending") : "none");
  const rankClass = (rk: number | null | undefined) => (rk == null ? "" : rk <= 5 ? "font-bold text-ink" : rk >= 26 ? "text-muted" : "text-ink-2");
  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5" role="group" aria-label="Conference">
        {(["all", "East", "West"] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={conf === c}
            onClick={() => setConf(c)}
            className={`rounded-full border px-3 py-1 text-[13px] ${conf === c ? "border-ink text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}
          >
            {c === "all" ? "All teams" : c}
          </button>
        ))}
      </div>
      <div className="table-wrap mt-3 max-h-[640px] overflow-y-auto">
        <table className="data-table">
          <caption className="sr-only">Team ratings and four factors, sortable</caption>
          <thead>
            <tr>
              <th className="sticky-col" aria-sort={aria("team")}>
                <button type="button" onClick={() => click("team")}>Team</button>
              </th>
              <th className="r" aria-sort={aria("w")}>
                <button type="button" onClick={() => click("w")}>W</button>
              </th>
              <th className="r" aria-sort={aria("l")}>
                <button type="button" onClick={() => click("l")}>L</button>
              </th>
              {COLS.map((c) => (
                <th key={c.key} className="r" aria-sort={aria(c.key)} title={c.title}>
                  <button type="button" onClick={() => click(c.key)}>
                    {c.label}
                    {sort.key === c.key ? <span aria-hidden>{sort.dir === -1 ? " ▾" : " ▴"}</span> : null}
                  </button>
                </th>
              ))}
              <th>Streak</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.code}>
                <td className="sticky-col">
                  <Link href={`/teams/${t.code}`} className="inline-flex items-center gap-1.5 font-semibold no-underline hover:underline">
                    <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: t.accent }} />
                    {t.code}
                  </Link>
                </td>
                <td className="r num">{t.w}</td>
                <td className="r num">{t.l}</td>
                {COLS.map((c) => (
                  <td key={c.key} className={`r num ${c.noRank ? "text-ink-2" : rankClass(t.ranks[c.key])}`} title={t.ranks[c.key] ? `Rank ${t.ranks[c.key]} of 30` : undefined}>
                    {fmt(t.values[c.key], c.signed)}
                  </td>
                ))}
                <td className="text-ink-2">{t.streak}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note px-4 py-3 sm:px-5">Bold cells rank top five in the league; grey cells rank bottom five. Select a column to sort.</p>
    </div>
  );
}
