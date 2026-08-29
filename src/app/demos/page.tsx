import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product Demos — Benve Control",
  description: "Clickable product demo screens for Benve Control.",
};

const demos = [
  {
    title: "Testing Workbench",
    audience: "Auditor",
    description:
      "The auditor's workpaper for a single control: risk & control detail, test of design, test of effectiveness, evidence, exceptions, and conclusion.",
    href: "/demos/testing-workbench.html",
  },
  {
    title: "Client Action Centre",
    audience: "Client",
    description:
      "The simplified, low-friction view a client sees: action items, evidence upload, remediation submission, and submission history.",
    href: "/demos/client-action-centre.html",
  },
  {
    title: "Quarterly Health Check",
    audience: "Auditor",
    description:
      "A full quarterly cycle: overview, management check-in, auditor review queue, and the quarterly health report.",
    href: "/demos/quarterly-health-check.html",
  },
  {
    title: "Automation Centre",
    audience: "Auditor",
    description:
      "How Benve automates administrative housekeeping — carry-forward, evidence requests, reminders, and completeness checks — while judgment stays with the auditor.",
    href: "/demos/automation-centre.html",
  },
  {
    title: "Deficiency & Remediation Tracker",
    audience: "Auditor + Client",
    description:
      "Auditor identifies an exception, management remediates it, and the auditor reviews closure evidence — full lifecycle from documentation to audit trail.",
    href: "/demos/deficiency-tracker.html",
  },
  {
    title: "Reports & Workpaper Pack",
    audience: "Auditor",
    description:
      "Build a concise management report for a CFO/board audience, or a fully traceable auditor workpaper pack linking risk, control, testing, evidence, and conclusion.",
    href: "/demos/reports.html",
  },
  {
    title: "Pilot Readiness",
    audience: "Auditor",
    description:
      "An end-to-end walkthrough on a demo client workspace — controls, evidence requests, testing, deficiencies, and the quarterly health report, all connected.",
    href: "/demos/pilot-readiness.html",
  },
  {
    title: "SOX Scoping Centre",
    audience: "Auditor",
    description:
      "The first step of a new engagement: intake, draft scope suggestion, materiality planning, and internal audit reliance — all draft-only, pending auditor sign-off.",
    href: "/demos/sox-scoping-centre.html",
  },
  {
    title: "External Auditor Collaboration Portal",
    audience: "External Auditor",
    description:
      "A secure, read-only portal for the client's external auditor: invitation, engagement dashboard, RCM and test results, and a structured audit inquiry channel — no rebuilding workpapers from scratch.",
    href: "/demos/audit-collaboration-portal.html",
  },
  {
    title: "Continuous Controls Monitoring (CCM)",
    audience: "Auditor",
    description:
      "Real-time, population-level testing for high-risk, high-frequency controls: eligibility setup, rule builder, monitoring dashboard, exception detail, and a tamper-evident evidence log. Auditor-only.",
    href: "/demos/ccm-monitoring.html",
  },
  {
    title: "AI-Powered Risk Scoring",
    audience: "Auditor",
    description:
      "AI analyzes exceptions, benchmarks, and company-specific factors to suggest risk ratings and testing frequency changes; the auditor reviews and decides. Includes dynamic frequency configuration and risk trend analysis.",
    href: "/demos/risk-scoring.html",
  },
  {
    title: "Pre-Built Fintech Control Libraries",
    audience: "Auditor",
    description:
      "Deploy industry-specific control templates in minutes — payments, lending, neobank/BaaS, ITGC, and financial close libraries — then tailor and test. Auditor-only.",
    href: "/demos/control-libraries.html",
  },
];

export default function DemosPage() {
  return (
    <main className="min-h-screen bg-ink px-6 py-16 text-paper">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">
          Benve Control
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
          Product demos
        </h1>
        <p className="mt-2 text-mute">
          Clickable walkthroughs using sample data only. No login required.
        </p>

        <div className="mt-10 space-y-4">
          {demos.map((demo) => (
            <a
              key={demo.href}
              href={demo.href}
              className="block rounded-xl border border-line bg-panel p-6 transition-colors hover:border-signal"
            >
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-paper">
                  {demo.title}
                </h2>
                <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-mute">
                  {demo.audience}
                </span>
              </div>
              <p className="mt-2 text-sm text-mute">{demo.description}</p>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
