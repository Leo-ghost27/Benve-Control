"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  external?: boolean;
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
    label: "Quarterly Health Check",
    href: "/demos/quarterly-health-check.html",
    icon: icon("M4 10a6 6 0 1 1 12 0 6 6 0 0 1-12 0z M10 6.5V10l2.5 1.5"),
    external: true,
  },
  {
    label: "Automation Centre",
    href: "/demos/automation-centre.html",
    icon: icon("M10 3v2.2 M10 14.8V17 M3 10h2.2 M14.8 10H17 M5.8 5.8l1.5 1.5 M12.7 12.7l1.5 1.5 M5.8 14.2l1.5-1.5 M12.7 7.3l1.5-1.5 M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"),
    external: true,
  },
  {
    label: "Deficiency Tracker (Demo)",
    href: "/demos/deficiency-tracker.html",
    icon: icon("M10 4 3 16h14z M10 8.5v3.2 M10 14v.01"),
    external: true,
  },
  {
    label: "Reports & Workpapers (Demo)",
    href: "/demos/reports.html",
    icon: icon("M5 4h10v12H5z M8 8h4 M8 11h4 M8 14h2"),
    external: true,
  },
  {
    label: "Pilot Readiness (Demo)",
    href: "/demos/pilot-readiness.html",
    icon: icon("M4 10l4 4 8-8"),
    external: true,
  },
  {
    label: "SOX Scoping Centre (Demo)",
    href: "/demos/sox-scoping-centre.html",
    icon: icon("M4 4h12v3H4z M4 9h8v3H4z M4 14h5v3H4z"),
    external: true,
  },
  {
    label: "External Auditor Portal (Demo)",
    href: "/demos/audit-collaboration-portal.html",
    icon: icon("M10 3l6.5 3v4c0 4.2-2.8 6.9-6.5 8-3.7-1.1-6.5-3.8-6.5-8V6z"),
    external: true,
  },
  {
    label: "CCM Monitoring (Demo)",
    href: "/demos/ccm-monitoring.html",
    icon: icon("M3 15l4-6 3 3 4-7 3 5 M3 4h14v12H3z"),
    external: true,
  },
  {
    label: "AI Risk Scoring (Demo)",
    href: "/demos/risk-scoring.html",
    icon: icon("M10 2l2 5 5 .5-4 3.5 1 5-4-3-4 3 1-5-4-3.5 5-.5z"),
    external: true,
  },
  {
    label: "Control Libraries (Demo)",
    href: "/demos/control-libraries.html",
    icon: icon("M4 4h4v12H4z M8 4h4v12H8z M12 4h4v12h-4z"),
    external: true,
  },
  {
    label: "Ext. Auditor AI Summary (Demo)",
    href: "/demos/external-auditor-ai-summary.html",
    icon: icon("M4 5h12M4 10h12M4 15h8"),
    external: true,
  },
  {
    label: "Multi-Framework Mapping (Demo)",
    href: "/demos/multi-framework-mapping.html",
    icon: icon("M4 4h4v4H4z M12 4h4v4h-4z M4 12h4v4H4z M12 12h4v4h-4z M8 6h4 M8 14h4 M6 8v4 M14 8v4"),
    external: true,
  },
  {
    label: "Regulatory Intelligence (Demo)",
    href: "/demos/regulatory-intelligence.html",
    icon: icon("M10 3v14 M4 6l6-3 6 3 M4 6v8l6 3 6-3V6"),
    external: true,
  },
  {
    label: "Client Onboarding (Demo)",
    href: "/demos/client-onboarding-migration.html",
    icon: icon("M10 4v6l4 2 M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z"),
    external: true,
  },
  {
    label: "API & Integrations (Demo)",
    href: "/demos/api-integrations.html",
    icon: icon("M6 8l-3 2 3 2 M14 8l3 2-3 2 M12 5l-4 10"),
    external: true,
  },
  {
    label: "SOX Readiness Score (Demo)",
    href: "/demos/sox-readiness-score.html",
    icon: icon("M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M10 6v4l3 2"),
    external: true,
  },
  {
    label: "AI Gap Analysis (Demo)",
    href: "/demos/ai-gap-analysis.html",
    icon: icon("M3 10h4l2-5 4 10 2-5h4"),
    external: true,
  },
  {
    label: "Predictive Deficiency (Demo)",
    href: "/demos/predictive-deficiency.html",
    icon: icon("M4 16l4-6 3 4 5-9 M14 5h3v3"),
    external: true,
  },
  {
    label: "Board Reporting Pack (Demo)",
    href: "/demos/board-reporting-pack.html",
    icon: icon("M4 4h12v9H4z M8 16h4 M10 13v3"),
    external: true,
  },
  {
    label: "Benchmarking Network (Demo)",
    href: "/demos/benchmarking-network.html",
    icon: icon("M6 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M14 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M10 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M6 6v4l4 4 M14 6v4l-4 4"),
    external: true,
  },
  {
    label: "Mobile App (Demo)",
    href: "/demos/mobile-app.html",
    icon: icon("M7 3h6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M9 14h2"),
    external: true,
  },
  {
    label: "Readiness Timeline (Demo)",
    href: "/demos/readiness-timeline.html",
    icon: icon("M3 10h14 M6 5v10 M10 5v10 M14 5v10"),
    external: true,
  },
  {
    label: "Owner Scorecards (Demo)",
    href: "/demos/control-owner-scorecards.html",
    icon: icon("M4 16v-4 M9 16V7 M14 16v-9 M4 4h12"),
    external: true,
  },
  {
    label: "Cost Tracker (Demo)",
    href: "/demos/cost-tracker.html",
    icon: icon("M10 3v14 M6 6h5.5a2.5 2.5 0 0 1 0 5H8a2.5 2.5 0 0 0 0 5h6"),
    external: true,
  },
  {
    label: "Change Impact Assessment (Demo)",
    href: "/demos/change-impact-assessment.html",
    icon: icon("M4 6h8 M4 10h12 M4 14h8 M15 4l2 2-2 2"),
    external: true,
  },
  {
    label: "Evidence Quality / PBC (Demo)",
    href: "/demos/evidence-quality-pbc.html",
    icon: icon("M6 3h6l3 3v11H6z M12 3v3h3 M8 12l1.5 1.5L12 10"),
    external: true,
  },
  {
    label: "AI Governance & ICFR (Demo)",
    href: "/demos/ai-governance-icfr.html",
    icon: icon("M10 2l2 5 5 .5-4 3.5 1 5-4-3-4 3 1-5-4-3.5 5-.5z"),
    external: true,
  },
  {
    label: "ICFR Decision Graph (Demo)",
    href: "/demos/icfr-decision-graph.html",
    icon: icon("M4 5a1 1 0 1 0 2 0 1 1 0 0 0-2 0z M14 5a1 1 0 1 0 2 0 1 1 0 0 0-2 0z M4 15a1 1 0 1 0 2 0 1 1 0 0 0-2 0z M14 15a1 1 0 1 0 2 0 1 1 0 0 0-2 0z M6 5h8 M5 6v8 M15 6v8 M6 15h8"),
    external: true,
  },
  {
    label: "Population Reliability (Demo)",
    href: "/demos/population-report-reliability.html",
    icon: icon("M5 4h10v12H5z M8 8h4 M8 11h4 M8 14h2"),
    external: true,
  },
  {
    label: "Testing Methodology & Sampling (Demo)",
    href: "/demos/sox-testing-methodology.html",
    icon: icon("M5 4h10v12H5z M8 8h4 M8 11h4 M8 14h2"),
    external: true,
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

          const linkClassName = `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            isActive
              ? "bg-signal/15 text-paper"
              : "text-mute hover:bg-line/40 hover:text-paper"
          }`;

          if (item.external) {
            return (
              <li key={item.href}>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClassName}
                >
                  <span className="text-mute">{item.icon}</span>
                  {item.label}
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    className="ml-auto h-3 w-3 text-mute"
                    aria-hidden="true"
                  >
                    <path d="M7 13 13 7 M8 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              </li>
            );
          }

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={linkClassName}
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
