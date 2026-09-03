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
  {
    title: "External Auditor AI Summary",
    audience: "Auditor",
    description:
      "AI-drafted summaries of key risks, exceptions, remediation progress, and CCM results for external audit fieldwork — the auditor reviews, approves, and shares. Auditor-only.",
    href: "/demos/external-auditor-ai-summary.html",
  },
  {
    title: "Multi-Framework Mapping",
    audience: "Auditor",
    description:
      "Map SOX controls to SOC 1, SOC 2, ISO 27001, FCA Operational Resilience, and PCI DSS — one control can satisfy multiple requirements. Coverage report and audit-readiness by framework. Auditor-only.",
    href: "/demos/multi-framework-mapping.html",
  },
  {
    title: "Regulatory Intelligence Feed",
    audience: "All users",
    description:
      "Curated updates from SEC, PCAOB, FRC, FCA, OCC, and other regulators with Benve commentary on what it means for fintechs, plus a regulatory deadline calendar.",
    href: "/demos/regulatory-intelligence.html",
  },
  {
    title: "Client Onboarding & Migration Service",
    audience: "Auditor",
    description:
      "A productized 30–60 day implementation programme: phased timeline, migration checklist from legacy spreadsheets, and a training & ongoing-support portal. Auditor-only.",
    href: "/demos/client-onboarding-migration.html",
  },
  {
    title: "Benve Control API & Integrations",
    audience: "Auditor",
    description:
      "API connections to NetSuite, Stripe, Modern Treasury, Okta, and Jira for automated evidence collection and CCM data feeds, plus a developer API reference. Auditor-only.",
    href: "/demos/api-integrations.html",
  },
  {
    title: "AI Control Gap Analysis",
    audience: "Auditor",
    description:
      "AI compares your control portfolio to industry benchmarks and flags missing or redundant controls; the auditor reviews and decides what to deploy or merge. Auditor-only.",
    href: "/demos/ai-gap-analysis.html",
  },
  {
    title: "Predictive Deficiency Detection",
    audience: "Auditor",
    description:
      "AI predicts which controls are likely to fail based on owner changes, system changes, and transaction volumes — early warnings the auditor turns into a prevention plan. Auditor-only.",
    href: "/demos/predictive-deficiency.html",
  },
  {
    title: "Board Reporting Pack Generator",
    audience: "Auditor",
    description:
      "Auto-generates board-ready slides — readiness score, key risks, exceptions, remediation status — from live Benve Control data. Configure once, preview each slide, export to PPTX/PDF. Auditor-only.",
    href: "/demos/board-reporting-pack.html",
  },
  {
    title: "SOX 404 Benchmarking Network",
    audience: "Auditor",
    description:
      "Anonymized peer benchmarking on exception rates, testing cycles, remediation times, and CCM coverage, with opt-in consent and actionable recommendations. Auditor-only.",
    href: "/demos/benchmarking-network.html",
  },
  {
    title: "Benve Control Mobile App",
    audience: "Client",
    description:
      "Client-facing mobile app for control owners: upload evidence, track tasks and remediation, and message the auditor on the go. Auditor workspace stays web-only.",
    href: "/demos/mobile-app.html",
  },
  {
    title: "SOX Readiness Score Dashboard",
    audience: "Auditor",
    description:
      "A board-level 0–100 readiness score with a full breakdown (testing progress, exception rate, remediation, time to audit, documentation) and a prioritized action plan to close the gap.",
    href: "/demos/sox-readiness-score.html",
  },
  {
    title: "SOX 404 Readiness Timeline Planner",
    audience: "Auditor",
    description:
      "A visual IPO readiness timeline from today through IPO target date — three phases, milestone tables, risks and mitigations, and critical-path tracking. Auditor-only.",
    href: "/demos/readiness-timeline.html",
  },
  {
    title: "Control Owner Performance Scorecards",
    audience: "Auditor",
    description:
      "Evidence on-time rate, exception rate, and remediation completion by control owner, with a leaderboard, an individual scorecard, and peer/industry comparisons. Auditor-only.",
    href: "/demos/control-owner-scorecards.html",
  },
  {
    title: "SOX 404 Cost Tracker & Tiered Pricing",
    audience: "Auditor",
    description:
      "Internal cost breakdowns, margin analysis, and ROI vs. Big 4 by client tier (Series A/B/C) — portfolio dashboard plus per-client detail views. Confidential, auditor-only.",
    href: "/demos/cost-tracker.html",
  },
  {
    title: "SOX Change Impact Assessment",
    audience: "Auditor",
    description:
      "Documents how business, process, system, personnel, regulatory, or vendor changes affect SOX 404 / ICFR controls — change register, intake, impacted-controls action plan, and auditor sign-off.",
    href: "/demos/change-impact-assessment.html",
  },
  {
    title: "Evidence Quality Review & PBC Completeness Centre",
    audience: "Auditor",
    description:
      "Manage the full Provided-By-Client evidence process: completeness tracking, quality review workspace, client clarification requests, and testing-readiness sign-off. Auditor-only.",
    href: "/demos/evidence-quality-pbc.html",
  },
  {
    title: "AI Controls Governance & ICFR Impact Register",
    audience: "Auditor",
    description:
      "Inventory AI tools used across the business, assess their potential SOX 404 / ICFR impact, document governance and human oversight, and track required actions. Auditor-only.",
    href: "/demos/ai-governance-icfr.html",
  },
  {
    title: "ICFR Control Decision Graph & Audit Evidence Lineage",
    audience: "Auditor",
    description:
      "The full auditable chain from financial-statement area through risk, control, testing, evidence, exceptions, remediation, and reporting — with a live sample path and open lineage-gap tracking. Auditor-only.",
    href: "/demos/icfr-decision-graph.html",
  },
  {
    title: "Population & Report Reliability Assessment",
    audience: "Auditor",
    description:
      "Document whether a system report or population is appropriate for a specific testing procedure: profile, completeness, accuracy, and reliability review, with auditor conclusion and full lineage. Auditor-only.",
    href: "/demos/population-report-reliability.html",
  },
  {
    title: "SOX Testing Methodology & Sample Planning Centre",
    audience: "Auditor",
    description:
      "Documents the auditor's methodology and professional judgment for SOX 404 / ICFR operating-effectiveness testing: approved test plan, population assessment, sample plan and size rationale, sample selection and results, exception response, and Engagement Lead review. Auditor-only.",
    href: "/demos/sox-testing-methodology.html",
  },
  {
    title: "Deficiency Severity & Aggregation Assessment Centre",
    audience: "Auditor",
    description:
      "Documents the auditor's evaluation of identified control exceptions and deficiencies: factual exception context, potential misstatement, likelihood, compensating controls, aggregation with related deficiencies, and Engagement Lead-reviewed draft classification. Auditor-only.",
    href: "/demos/deficiency-severity-aggregation.html",
  },
  {
    title: "Controlled Deficiency Communication & Remediation Assurance Pack",
    audience: "Auditor",
    description:
      "Prepares, approves, distributes, and tracks controlled communications for approved SOX 404 / ICFR deficiencies — draft communication, Engagement Lead approval, secure distribution, management response, remediation assurance, and a governance-ready audit trail. Auditor-only.",
    href: "/demos/deficiency-communication-assurance.html",
  },
  {
    title: "Management's Annual Report on ICFR (SOX 404(a)) Drafting Centre",
    audience: "Management",
    description:
      "Prepares management's draft Annual Report on ICFR: assessment scope and framework, testing results, deficiency summary, material weakness evaluation, and the draft report with review/approval trail. Does not conclude ICFR effectiveness or file the 10-K.",
    href: "/demos/icfr-annual-report-404a.html",
  },
  {
    title: "SOX 302 Quarterly & Annual Certification Pack",
    audience: "Management",
    description:
      "Prepares the evidence and drafts supporting CEO/CFO SOX 302 certifications: DC&P evaluation, ICFR changes during the period, sub-certifications, and the draft certification pack with review/approval trail. Does not file certifications.",
    href: "/demos/sox302-certification-pack.html",
  },
  {
    title: "External Auditor Attestation & Integrated Audit Coordination Hub",
    audience: "External Auditor",
    description:
      "A controlled, read-only coordination hub for the external auditor's integrated audit under PCAOB AS 2201: ICFR scope and evidence index, walkthroughs, requests for additional evidence with a response workflow, and an audit communications and preliminary findings log.",
    href: "/demos/external-auditor-coordination-hub.html",
  },
  {
    title: "Continuous Controls Monitoring & Exception Intelligence Hub",
    audience: "Management",
    description:
      "Illustrative CCM programme dashboard, exception feed and triage workbench, rule library and control coverage map, and trend analysis with follow-up/escalation and Audit Committee reporting. Sample-based; does not replace SOX 404 testing.",
    href: "/demos/ccm-exception-intelligence-hub.html",
  },
  {
    title: "Pre-IPO / Accelerated Filer Readiness & ICFR Maturity Centre",
    audience: "Management",
    description:
      "Illustrative ICFR maturity model and readiness dashboard, readiness checklist and gap analysis, remediation roadmap with milestones, and board/Audit Committee governance reporting for IPO or increased SOX rigour planning.",
    href: "/demos/pre-ipo-readiness-centre.html",
  },
  {
    title: "Multi-Entity / Group ICFR Roll-Up & Subsidiary Assurance Hub",
    audience: "Management",
    description:
      "Illustrative group-level ICFR dashboard across legal entities, entity-level detail and roll-up logic, a subsidiary assurance questionnaire workflow, and group deficiency/governance reporting. Does not determine scoping requirements.",
    href: "/demos/group-icfr-rollup-hub.html",
  },
  {
    title: "ITGC Depth & Automated Control Assurance Studio",
    audience: "Management",
    description:
      "Structured ITGC workpapers (access, change, IT operations), an automated application control library linked to financial assertions, and illustrative monitoring/reporting. Does not connect to live systems or replace IT audit procedures.",
    href: "/demos/itgc-automated-control-studio.html",
  },
  {
    title: "Landing Page, News Ribbon & Client Onboarding Hub",
    audience: "Client",
    description:
      "Illustrative public-facing marketing site: hero and value proposition, feature/module map, news ribbon and updates page, pricing, and a Stripe-style sign-up and payment flow. Does not process real payments or create real accounts.",
    href: "/demos/landing-page-onboarding-hub.html",
  },
  {
    title: "Admin Console — Client Management, Amendments & Stripe Subscription Portal",
    audience: "Operator",
    description:
      "Illustrative internal operator workspace: client tenant overview, add-new-client onboarding, plan amendments with a Stripe-style subscription view, cancel/delete safeguards, and revenue/usage/churn reporting. Operator-only.",
    href: "/demos/admin-console.html",
  },
];

export default function DemosPage() {
  return (
    <main className="min-h-screen bg-ink px-6 py-16 text-paper">
      <div className="mx-auto max-w-3xl">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-mute transition-colors hover:text-signal"
        >
          ← Back to Benve Control
        </a>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-signal">
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
