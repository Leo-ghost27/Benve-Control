"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["Organization", "/dashboard/settings/organization"],
  ["Team & invitations", "/dashboard/settings/team"],
  ["Client access", "/dashboard/settings/clients"],
  ["Reporting periods", "/dashboard/settings/periods"],
  ["Security", "/dashboard/settings/security"],
  ["Notifications", "/dashboard/settings/notifications"],
  ["Billing", "/dashboard/settings/billing"],
  ["Retention & archival", "/dashboard/settings/retention"],
] as const;

/** Navigation only. Hiding or showing a tab is not access control; every page and the database re-check. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-1 border-b border-line pb-3">
      {TABS.map(([label, href]) => {
        const active = pathname === href;
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-signal/15 text-paper" : "text-mute hover:bg-line/40 hover:text-paper"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
