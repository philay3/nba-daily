import Link from "next/link";

import { addDays, shortDay } from "@/lib/format";

const btn = "rounded border border-line-strong px-2.5 py-1 text-ink-2 no-underline hover:text-ink";

/**
 * Previous and next day, back to today, and a date field for any day this season.
 * A plain GET form: it works without client JavaScript and keeps the date in the URL (?date=YYYY-MM-DD).
 */
export function DatePicker({ day, today, range }: { day: string; today: string; range: { first: string; last: string } | null }) {
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const canPrev = !range || prev >= range.first;
  const canNext = !range || next <= range.last;
  return (
    <nav aria-label="Change date" className="flex flex-wrap items-center gap-2 text-[13px]">
      {canPrev ? (
        <Link href={`/?date=${prev}`} className={btn}>
          {"‹"} {shortDay(prev)}
        </Link>
      ) : null}
      {day !== today ? (
        <Link href="/" className={btn}>
          Today
        </Link>
      ) : null}
      {canNext ? (
        <Link href={`/?date=${next}`} className={btn}>
          {shortDay(next)} {"›"}
        </Link>
      ) : null}
      <form action="/" method="get" className="flex items-center gap-1.5">
        <label htmlFor="pick-date" className="sr-only">
          Pick a date this season
        </label>
        <input
          id="pick-date"
          type="date"
          name="date"
          defaultValue={day}
          min={range?.first}
          max={range?.last}
          required
          className="rounded border border-line-strong bg-panel px-2 py-[3px] text-ink"
        />
        <button type="submit" className={`${btn} bg-transparent`}>
          Go
        </button>
      </form>
    </nav>
  );
}
