import Link from "next/link";

import { SiteNav } from "@/components/ui/SiteNav";

export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:bg-panel focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-arena/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-4 sm:px-8">
          <Link href="/" className="display flex shrink-0 items-center gap-2 text-[26px] tracking-[0.02em] no-underline" aria-label="NBA Daily home">
            <span aria-hidden className="block h-5 w-2 rounded-[1px] bg-clock" />
            NBA Daily
          </Link>
          <SiteNav />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1280px] px-4 pb-20 sm:px-8">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="note mx-auto grid max-w-[1280px] gap-2 px-4 py-8 sm:px-8">
          <p className="max-w-[72ch]">
            Box scores and schedule: ESPN through the hoopR data mirror. Lines and injuries: ESPN. Ratings are per 100 possessions, with possessions estimated from
            shots, offensive rebounds, turnovers and free throws. Regular season only.
          </p>
          <p>No team logos or player photos are used. Team names and colors identify teams.</p>
        </div>
      </footer>
    </>
  );
}
