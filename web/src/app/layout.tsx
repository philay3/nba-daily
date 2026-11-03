import "@fontsource-variable/archivo/wdth";
import "@fontsource-variable/big-shoulders-display/wght";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { SiteNav } from "@/components/ui/SiteNav";

export const metadata: Metadata = {
  title: { default: "NBA Daily", template: "%s | NBA Daily" },
  description: "Tonight's slate, last night's box scores, team ratings and post-ready graphics.",
};

export const viewport: Viewport = {
  themeColor: "#0b1624",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:bg-panel focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="border-b border-line bg-arena/95 backdrop-blur sticky top-0 z-40">
          <div className="mx-auto flex max-w-[1280px] items-center gap-4 px-4 sm:px-8 h-14">
            <Link href="/" className="display flex items-center gap-2 text-[26px] tracking-[0.02em] no-underline shrink-0" aria-label="NBA Daily home">
              <span aria-hidden className="block h-5 w-2 rounded-[1px] bg-clock" />
              NBA Daily
            </Link>
            <SiteNav />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1280px] px-4 sm:px-8 pb-20">
          {children}
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto max-w-[1280px] px-4 sm:px-8 py-8 note grid gap-2">
            <p className="max-w-[72ch]">
              Box scores and schedule: ESPN through the hoopR data mirror. Lines and injuries: ESPN. Ratings are per 100
              possessions, with possessions estimated from shots, offensive rebounds, turnovers and free throws. Regular
              season only.
            </p>
            <p>No team logos or player photos are used. Team names and colors identify teams.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
