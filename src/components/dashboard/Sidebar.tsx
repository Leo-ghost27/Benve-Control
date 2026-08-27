"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
};

const icon = (path: string) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-[18px] w-[18px]"
    aria-hidden="true"
  >
    <path d={path} />
  </svg>
);

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: icon("M3 10.5 10 4l7 6.5M5 9v7h10V9"),
  },
  {
    label: "Controls",
    href: "/dashboard/controls",
    icon: icon("M4 4h12v12H4z M4 8h12 M8 4v12"),
  },
  {
    label: "Test Plans",
    href: "/dashboard/test-plans",
    icon: icon("M5 3h7l3 3v11H5z M12 3v3h3 M8 10h4 M8 13h4"),
  },
  {
    label: "Evidence",
    href: "/dashboard/evidence",
    icon: icon("M6 3h6l3 3v11H6z M12 3v3h3 M8 12l1.5 1.5L12 10"),
  },
  {
    label: "Deficiencies",
    href: "/dashboard/deficiencies",
    icon: icon("M10 4 3 16h14z M10 8.5v3.2 M10 14v.01"),
  },
  {
    label: "Reports",
    href: "/dashboard/reports",
    icon: icon("M5 4h10v12H5z M8 8h4 M8 11h4 M8 14h2"),
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: icon(
      "M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M4 10a6 6 0 0 1 .3-1.9L2.9 6.9l1.2-2 1.7.7A6 6 0 0 1 8.1 4.3L8.4 2.4h3.2l.3 1.9a6 6 0 0 1 2.3 1.3l1.7-.7 1.2 2-1.4 1.2A6 6 0 0 1 16 10a6 6 0 0 1-.3 1.9l1.4 1.2-1.2 2-1.7-.7a6 6 0 0 1-2.3 1.3l-.3 1.9H8.4l-.3-1.9a6 6 0 0 1-2.3-1.3l-1.7.7-1.2-2 1.4-1.2A6 6 0 0 1 4 10z"
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard navigation"
      className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-panel"
    >
      <div className="flex h-16 items-center gap-2 border-b border-line px-5">
        <span className="h-2 w-2 rounded-full bg-signal" aria-hidden="true" />
        <span className="font-display text-sm font-bold tracking-tight text-paper">
          Benve Control
        </span>
      </div>

      <ul className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href || pathname?.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-signal/15 text-paper"
                    : "text-mute hover:bg-line/40 hover:text-paper"
                }`}
              >
                <span className={isActive ? "text-signal" : "text-mute"}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-mute">
          Auditor workspace
        </p>
      </div>
    </nav>
  );
}
