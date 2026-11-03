import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-[1280px] gap-4 px-4 py-20 sm:px-8">
      <h1 className="display text-[64px] leading-none">Not found</h1>
      <p className="max-w-[60ch] text-ink-2">There is no page at this address.</p>
      <p>
        <Link href="/">Go to today&apos;s slate</Link>
      </p>
    </main>
  );
}
