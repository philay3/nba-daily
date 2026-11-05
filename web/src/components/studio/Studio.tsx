"use client";

import { toPng } from "html-to-image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { emptyReason, resolveSelection, selectionToQuery, TemplateFrame } from "@/components/studio/render";
import { SIZES, TEMPLATES, type SizeKey, type StudioData, type StudioSelection, type TemplateKey } from "@/lib/studio-types";
import { shortDay } from "@/lib/format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function Studio({ data, initial }: { data: StudioData; initial: StudioSelection }) {
  const [sel, setSel] = useState<StudioSelection>(() => resolveSelection(data, initial));
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const [boxRef, boxWidth] = useWidth<HTMLDivElement>();
  const { w, h } = SIZES[sel.size];
  const scale = Math.min(1, boxWidth / w, 860 / h);

  // keep the URL in step so a graphic can be bookmarked or reopened (the handle default comes from NEXT_PUBLIC_BRAND_HANDLE)
  useEffect(() => {
    window.history.replaceState(null, "", `/studio?${selectionToQuery(data.day, sel)}`);
  }, [sel, data.day]);

  const set = (patch: Partial<StudioSelection>) => setSel((s) => ({ ...s, ...patch }));
  const empty = emptyReason(data, sel.template);

  async function exportPng() {
    const node = frameRef.current?.querySelector<HTMLElement>("[data-frame]");
    if (!node) return;
    setBusy(true);
    setStatus("Rendering...");
    try {
      await document.fonts.ready;
      const url = await toPng(node, { width: w, height: h, pixelRatio: 1, cacheBust: true, backgroundColor: "#0b1624" });
      const a = document.createElement("a");
      a.href = url;
      a.download = `nba-daily_${sel.template}_${sel.size}_${data.day}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus(`Saved ${a.download} (${w} x ${h})`);
    } catch (e) {
      setStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const teamsSorted = Object.values(data.teams).sort((a, b) => a.code.localeCompare(b.code));
  const field = "rounded border border-line-strong bg-arena px-3 py-2 text-[14px] text-ink";
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <form className="panel grid gap-5 p-5 lg:sticky lg:top-20" onSubmit={(e) => e.preventDefault()} aria-label="Graphic settings">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink-2">Template</legend>
          {(Object.keys(TEMPLATES) as TemplateKey[]).map((k) => (
            <label key={k} className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-[14px] ${sel.template === k ? "border-clock text-ink" : "border-line-strong text-ink-2"}`}>
              <input type="radio" name="template" value={k} checked={sel.template === k} onChange={() => set({ template: k })} className="accent-[var(--color-clock)]" />
              {TEMPLATES[k]}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink-2">Size</legend>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(SIZES) as SizeKey[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={sel.size === k}
                onClick={() => set({ size: k })}
                className={`rounded border px-2 py-2 text-[13px] ${sel.size === k ? "border-clock text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}
              >
                {k === "feed" ? "Feed" : k === "story" ? "Story" : "YouTube"}
                <span className="block text-[11px] text-muted">
                  {SIZES[k].w}x{SIZES[k].h}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        {sel.template === "player" && data.players.length ? (
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Player (last night)
            <select className={field} value={sel.player} onChange={(e) => set({ player: e.target.value })}>
              {data.players.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} {p.team}: {p.pts}-{p.reb}-{p.ast}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sel.template === "matchup" && data.matchups.length ? (
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Game (next 3 days)
            <select className={field} value={sel.matchup} onChange={(e) => set({ matchup: e.target.value })}>
              {[0, 1, 2].map((i) => {
                const list = data.matchups.filter((m) => m.days_ahead === i);
                return list.length ? (
                  <optgroup key={i} label={shortDay(list[0].date)}>
                    {list.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.away} at {m.home}, {m.time_et}
                        {m.watch ? ` (watch #${m.watch})` : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
        ) : null}
        {sel.template === "recap" && data.recaps.length ? (
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Game (last night)
            <select className={field} value={sel.recap} onChange={(e) => set({ recap: e.target.value })}>
              {data.recaps.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.away} {r.away_score}, {r.home} {r.home_score}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sel.template === "shots" && data.shotCharts.length ? (
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Player or team (last night)
            <select className={field} value={sel.shot} onChange={(e) => set({ shot: e.target.value })}>
              <optgroup label="Players">
                {data.shotCharts
                  .filter((c) => c.kind === "player")
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name} {c.team}: {c.fgm}-{c.fga}, {c.pts} pts
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Teams">
                {data.shotCharts
                  .filter((c) => c.kind === "team")
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.team} {c.home ? "vs" : "at"} {c.opp}: {c.fgm}-{c.fga}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
        ) : null}
        {sel.template === "flow" && data.flows.length ? (
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Game (last night, most lead changes first)
            <select className={field} value={sel.flow} onChange={(e) => set({ flow: e.target.value })}>
              {data.flows.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.away} {f.away_score}, {f.home} {f.home_score}
                  {f.lead_changes ? ` (${f.lead_changes} lead changes)` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sel.template === "model" && data.models.length ? (
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Game
            <select className={field} value={sel.model} onChange={(e) => set({ model: e.target.value })}>
              {[...new Set(data.models.map((m) => m.date))].map((d) => (
                <optgroup key={d} label={`${shortDay(d)}${data.models.find((m) => m.date === d)?.played ? ", final" : ""}`}>
                  {data.models
                    .filter((m) => m.date === d)
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.away} at {m.home}
                        {m.played ? "" : `, ${m.time_et}`}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        ) : null}
        {sel.template === "story" && data.stories.length ? (
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
            Story (last night, best first)
            <select className={field} value={sel.story} onChange={(e) => set({ story: e.target.value })}>
              {data.stories.map((s) => (
                <option key={s.key} value={s.key}>
                  #{s.rank} {s.headline}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sel.template === "league" ? (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((i) => (
              <label key={i} className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
                Highlight {i + 1}
                <select
                  className={field}
                  value={sel.highlight?.[i] ?? ""}
                  onChange={(e) => {
                    const next = [...(sel.highlight ?? [])];
                    next[i] = e.target.value;
                    set({ highlight: next.filter(Boolean) });
                  }}
                >
                  <option value="">None</option>
                  {teamsSorted.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}
        <label className="grid gap-1.5 text-[13px] font-semibold text-ink-2">
          Handle or brand text
          <input className={field} value={sel.handle} maxLength={40} onChange={(e) => set({ handle: e.target.value })} />
        </label>
        <div className="grid gap-2">
          <button
            type="button"
            onClick={exportPng}
            disabled={busy || Boolean(empty)}
            className="rounded bg-clock px-4 py-2.5 text-[15px] font-semibold text-arena disabled:opacity-50"
          >
            {busy ? "Exporting..." : `Export PNG (${w} x ${h})`}
          </button>
          <a href={`/studio/frame?${selectionToQuery(data.day, sel)}`} target="_blank" rel="noreferrer" className="text-center text-[13px] text-ink-2">
            Open at full size
          </a>
          <p role="status" aria-live="polite" className="min-h-5 text-[12px] text-muted">
            {status}
          </p>
        </div>
      </form>
      <div ref={boxRef} className="grid gap-2">
        {empty ? (
          <div className="panel p-6 text-ink-2">{empty} Pick another template or date.</div>
        ) : (
          <>
            <div className="text-[12px] text-muted">
              Preview at {Math.round(scale * 100)}%. The export is {w} x {h} pixels.
            </div>
            <div style={{ width: w * scale, height: h * scale }} className="overflow-hidden rounded-[4px] shadow-[0_0_0_1px_var(--color-line)]">
              <div ref={frameRef} style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                <TemplateFrame data={data} sel={sel} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
