"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { href: "/dashboard/ccm", label: "Overview", exact: true },
  { href: "/dashboard/ccm/rules", label: "Rules" },
  { href: "/dashboard/ccm/exceptions", label: "Exceptions" },
  { href: "/dashboard/ccm/follow-ups", label: "Follow-ups" },
  { href: "/dashboard/ccm/import", label: "Import" },
];

export function CcmNav() {
  const pathname = usePathname();
  const period = useSearchParams().get("period");
  return (
    <nav aria-label="CCM sections" className="mb-6 flex gap-1 border-b border-line">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        const href = period ? `${t.href}?period=${period}` : t.href;
        return (
          <Link
            key={t.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              active ? "border-signal text-paper" : "border-transparent text-mute hover:text-paper"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
