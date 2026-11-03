"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid gap-4 py-20">
      <h1 className="display text-[56px] leading-none">This page could not load</h1>
      <p className="max-w-[64ch] text-ink-2">
        The database query failed. Check that Postgres is running and DATABASE_URL points at it, then try again.
        {error.digest ? <span className="block text-[13px] text-muted">Reference {error.digest}</span> : null}
      </p>
      <p>
        <button type="button" onClick={reset} className="rounded border border-line-strong px-3 py-1.5 text-[14px] hover:border-ink">
          Try again
        </button>
      </p>
    </div>
  );
}
