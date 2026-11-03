"use client";

import { useState, type ReactNode } from "react";

export type ShotView = "dots" | "hex";

/** Switch between the two server-rendered views of one shot chart. */
export function ShotViews({ dots, hex, initial = "dots", label }: { dots: ReactNode; hex: ReactNode; initial?: ShotView; label: string }) {
  const [view, setView] = useState<ShotView>(initial);
  return (
    <div className="grid gap-3">
      <div role="group" aria-label={`${label}: chart view`} className="flex flex-wrap gap-1.5">
        {(["dots", "hex"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`rounded border px-2.5 py-1 text-[12px] ${view === v ? "border-clock text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}
          >
            {v === "dots" ? "Makes and misses" : "Against the league"}
          </button>
        ))}
      </div>
      <div hidden={view !== "dots"}>{dots}</div>
      <div hidden={view !== "hex"}>{hex}</div>
    </div>
  );
}
