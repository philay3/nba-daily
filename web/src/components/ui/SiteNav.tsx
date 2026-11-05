"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/teams", label: "Teams" },
  { href: "/players", label: "Players" },
  { href: "/standings", label: "Standings" },
  { href: "/ratings", label: "Ratings" },
  { href: "/model", label: "Model" },
  { href: "/injuries", label: "Injuries" },
  { href: "/stories", label: "Stories" },
  { href: "/studio", label: "Studio" },
];

export function SiteNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/games") : path.startsWith(href));
  return (
    <nav aria-label="Sections" className="min-w-0 flex-1 overflow-x-auto">
      <ul className="flex items-center gap-1 text-[14px] whitespace-nowrap">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active(l.href) ? "page" : undefined}
              className={
                "block rounded px-2.5 py-1.5 no-underline transition-colors " +
                (active(l.href) ? "text-ink bg-panel-2" : "text-muted hover:text-ink")
              }
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
