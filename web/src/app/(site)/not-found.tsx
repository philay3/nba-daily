import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid gap-4 py-20">
      <h1 className="display text-[64px] leading-none">Not found</h1>
      <p className="max-w-[60ch] text-ink-2">That game, team or player is not in the database. Team pages use codes like LAL or NYK; game pages use ESPN game ids.</p>
      <p>
        <Link href="/">Go to today&apos;s slate</Link>
      </p>
    </div>
  );
}
