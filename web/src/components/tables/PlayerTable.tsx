"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type PlayerRow = {
  id: number;
  name: string;
  team: string;
  accent: string;
  pos: string;
  values: Record<string, number | null>;
};

const COLS: { key: string; label: string; title: string; int?: boolean; signed?: boolean }[] = [
  { key: "gp", label: "GP", title: "Games played", int: true },
  { key: "mpg", label: "MIN", title: "Minutes per game" },
  { key: "ppg", label: "PTS", title: "Points per game" },
  { key: "rpg", label: "REB", title: "Rebounds per game" },
  { key: "apg", label: "AST", title: "Assists per game" },
  { key: "spg", label: "STL", title: "Steals per game" },
  { key: "bpg", label: "BLK", title: "Blocks per game" },
  { key: "tovpg", label: "TO", title: "Turnovers per game" },
  { key: "fg_pct", label: "FG%", title: "Field goal %" },
  { key: "fg3m_pg", label: "3PM", title: "Threes made per game" },
  { key: "fg3_pct", label: "3P%", title: "3-point %" },
  { key: "ft_pct", label: "FT%", title: "Free throw %" },
  { key: "ts_pct", label: "TS%", title: "True shooting %: counts threes and free throws" },
  { key: "pm_pg", label: "+/- per game", title: "Plus-minus per game", signed: true },
  { key: "pm_total", label: "+/- total", title: "Plus-minus, season total", int: true, signed: true },
];

function fmt(v: number | null | undefined, int?: boolean, signed?: boolean) {
  if (v === null || v === undefined) return "–";
  const s = int ? Math.abs(Math.round(v)).toString() : Math.abs(v).toFixed(1);
  if (!signed) return int ? String(Math.round(v)) : v.toFixed(1);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function PlayerTable({ rows }: { rows: PlayerRow[] }) {
  const [query, setQuery] = useState("");
  const [rotation, setRotation] = useState(true);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "pm_total", dir: -1 });
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const r = rows.filter((p) => (!rotation || (p.values.mpg ?? 0) >= 15) && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q));
    const val = (p: PlayerRow) => (sort.key === "name" ? p.name : sort.key === "team" ? p.team : p.values[sort.key]);
    return [...r].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * sort.dir;
      return ((va ?? -1e9) - (vb ?? -1e9)) * sort.dir;
    });
  }, [rows, query, rotation, sort]);
  const click = (key: string) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "name" || key === "team" ? 1 : -1 }));
  const aria = (key: string) => (sort.key === key ? (sort.dir === -1 ? "descending" : "ascending") : "none");
  const maxAbs = Math.max(1, ...shown.map((p) => Math.abs(p.values.pm_pg ?? 0)));
  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-4 px-4 pt-4 sm:px-5">
        <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
          <span className="sr-only">Search players or a team code</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a player or team code"
            className="w-full rounded border border-line-strong bg-arena px-3 py-1.5 text-[14px] text-ink placeholder:text-muted sm:w-72"
          />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={rotation} onChange={(e) => setRotation(e.target.checked)} className="accent-[var(--color-clock)]" />
          Rotation players only (15+ minutes a game)
        </label>
        <span className="text-[13px] text-muted">{shown.length} players</span>
      </div>
      <div className="table-wrap mt-3 max-h-[720px] overflow-y-auto">
        <table className="data-table">
          <caption className="sr-only">Player season stats, sortable</caption>
          <thead>
            <tr>
              <th className="sticky-col" aria-sort={aria("name")}>
                <button type="button" onClick={() => click("name")}>Player</button>
              </th>
              <th aria-sort={aria("team")}>
                <button type="button" onClick={() => click("team")}>Team</button>
              </th>
              <th>Pos</th>
              {COLS.map((c) => (
                <th key={c.key} className="r" aria-sort={aria(c.key)} title={c.title}>
                  <button type="button" onClick={() => click(c.key)}>
                    {c.label}
                    {sort.key === c.key ? <span aria-hidden>{sort.dir === -1 ? " ▾" : " ▴"}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td className="sticky-col">
                  <Link href={`/players/${p.id}`} className="font-semibold no-underline hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td>
                  <Link href={`/teams/${p.team}`} className="inline-flex items-center gap-1.5 no-underline hover:underline">
                    <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ background: p.accent }} />
                    {p.team}
                  </Link>
                </td>
                <td className="text-muted">{p.pos}</td>
                {COLS.map((c) =>
                  c.key === "pm_pg" ? (
                    <td key={c.key} className="r">
                      <span className="inline-flex items-center justify-end gap-2">
                        <span className="num">{fmt(p.values.pm_pg, false, true)}</span>
                        <span aria-hidden className="relative block h-2 w-11">
                          <span className="absolute inset-y-[-2px] left-1/2 w-px bg-line-strong" />
                          <span
                            className="absolute inset-y-0 rounded-[2px]"
                            style={{
                              width: `${Math.min(50, (Math.abs(p.values.pm_pg ?? 0) / maxAbs) * 50)}%`,
                              left: (p.values.pm_pg ?? 0) >= 0 ? "50%" : `${50 - Math.min(50, (Math.abs(p.values.pm_pg ?? 0) / maxAbs) * 50)}%`,
                              background: (p.values.pm_pg ?? 0) >= 0 ? "var(--color-plus)" : "var(--color-minus)",
                            }}
                          />
                        </span>
                      </span>
                    </td>
                  ) : (
                    <td key={c.key} className={`r num ${c.key === "ppg" || c.key === "pm_total" ? "font-semibold" : ""}`}>
                      {fmt(p.values[c.key], c.int, c.signed)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
