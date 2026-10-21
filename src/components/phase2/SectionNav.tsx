"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type Tab = { href: string; label: string; exact?: boolean };

/** Section tabs that carry the selected reporting period and assessment between pages. */
export function SectionNav({ tabs, label = "Sections", carry = ["period", "assessment"] }: { tabs: Tab[]; label?: string; carry?: string[] }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <nav aria-label={label} className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        const next = new URLSearchParams();
        carry.forEach((k) => { const v = sp.get(k); if (v) next.set(k, v); });
        const qs = next.toString();
        return (
          <Link
            key={t.href}
            href={qs ? `${t.href}?${qs}` : t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${active ? "border-signal text-paper" : "border-transparent text-mute hover:text-paper"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
