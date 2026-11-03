import type { Metadata } from "next";

import { emptyReason, TemplateFrame } from "@/components/studio/render";
import { NoDatabase } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { resolveDay } from "@/lib/data";
import { getStudioData } from "@/lib/studio-data";
import { selectionFromSearch, type StudioSearch } from "@/lib/studio-params";
import type { StudioData } from "@/lib/studio-types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Studio frame", robots: { index: false } };

/** One template at its export size and nothing else: for screenshots, headless exports and checking a graphic at 100%. */
export default async function FramePage({ searchParams }: { searchParams: Promise<StudioSearch> }) {
  const sp = await searchParams;
  let data: StudioData;
  try {
    const { day } = await resolveDay(sp.date);
    data = await getStudioData(day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  const sel = selectionFromSearch(sp);
  const empty = emptyReason(data, sel.template);
  if (empty) return <p className="p-8 text-ink-2">{empty}</p>;
  return (
    <div style={{ width: "max-content" }}>
      <TemplateFrame data={data} sel={sel} />
    </div>
  );
}
