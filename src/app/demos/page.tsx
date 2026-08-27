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
