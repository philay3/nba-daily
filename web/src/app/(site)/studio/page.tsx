import type { Metadata } from "next";

import { Studio } from "@/components/studio/Studio";
import { NoDatabase } from "@/components/ui/bits";
import { DatabaseNotConfigured } from "@/db/client";
import { resolveDay } from "@/lib/data";
import { longDate } from "@/lib/format";
import { getStudioData } from "@/lib/studio-data";
import { selectionFromSearch, type StudioSearch } from "@/lib/studio-params";
import type { StudioData } from "@/lib/studio-types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<StudioSearch> }) {
  const sp = await searchParams;
  let data: StudioData;
  try {
    const { day } = await resolveDay(sp.date);
    data = await getStudioData(day);
  } catch (e) {
    if (e instanceof DatabaseNotConfigured) return <NoDatabase />;
    throw e;
  }
  return (
    <div className="grid grid-cols-1 gap-6 pt-6 sm:pt-8">
      <header className="grid gap-2">
        <h1 className="display text-[56px] leading-[0.9] sm:text-[80px]">Studio</h1>
        <p className="note max-w-[72ch]">
          Post-ready graphics from the database for {longDate(data.day)}: last night&apos;s lines, results, shot charts and game flow, matchups for the next 3 days and the league picture. Pick a
          template and a size, set your handle, and export a PNG at full resolution.
        </p>
      </header>
      <Studio data={data} initial={selectionFromSearch(sp)} />
    </div>
  );
}
