import Link from "next/link";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

type ActionItem = {
  id: string;
  label: string;
  context: string;
  href: string;
  urgency: "overdue" | "attention" | "normal";
};

const urgencyStyles: Record<ActionItem["urgency"], string> = {
  overdue: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  attention: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  normal: "border-line text-mute",
};

const urgencyLabel: Record<ActionItem["urgency"], string> = {
  overdue: "Overdue",
  attention: "Needs attention",
  normal: "Open",
};

export default async function DashboardHomePage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to get started."
        />
      </div>
    );
  }

  const supabase = await createClient();

  const [
    { data: isAdmin },
    { data: deficiencies },
    { data: communications },
    { data: evidenceRequests },
    { data: ccmExceptions },
    { data: icfrReports },
    { data: certifications },
    { data: testPlans },
    { data: controlsAll },
    { data: recentActivity },
  ] = await Promise.all([
    supabase.rpc("is_platform_admin"),
    supabase
      .from("deficiencies")
      .select("id, title, review_status, draft_classification, status")
      .eq("organization_id", ctx.org.id),
    supabase
      .from("communications")
      .select("id, comm_ref, audience, status")
      .eq("organization_id", ctx.org.id)
      .in("status", ["draft", "approved"]),
    supabase
      .from("evidence_requests")
      .select("id, title, owner_name, due_date, status")
      .eq("organization_id", ctx.org.id)
      .in("status", ["sent", "submitted", "clarification_requested"]),
    supabase
      .from("ccm_exceptions")
      .select("id, exception_ref, status")
      .eq("organization_id", ctx.org.id)
      .eq("status", "open"),
    supabase
      .from("icfr_reports")
      .select("id, as_of_date, status")
      .eq("organization_id", ctx.org.id)
      .in("status", ["draft", "under_review"]),
    supabase
      .from("certifications")
      .select("id, period, status")
      .eq("organization_id", ctx.org.id)
      .in("status", ["draft", "under_review"]),
    supabase
      .from("test_plans")
      .select("id, name, status")
      .eq("organization_id", ctx.org.id)
      .eq("status", "ready_for_review"),
    supabase.from("controls").select("id, status").eq("organization_id", ctx.org.id),
    supabase
      .from("audit_log")
      .select("id, action, entity_type, created_at")
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  let contractItems: { id: string; client_name: string; status: string }[] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from("contracts")
      .select("id, client_name, status")
      .eq("status", "sent");
    contractItems = data ?? [];
  }

  // ---- Build the "needs attention" list ----
  const actionItems: ActionItem[] = [];

  for (const d of deficiencies ?? []) {
    if (d.review_status === "awaiting_review") {
      actionItems.push({
        id: `def-review-${d.id}`,
        label: d.title,
        context: "Awaiting Engagement Lead review",
        href: `/dashboard/deficiencies/${d.id}`,
        urgency: "attention",
      });
    } else if (d.status === "open" && !d.draft_classification) {
      actionItems.push({
        id: `def-classify-${d.id}`,
        label: d.title,
        context: "Needs severity assessment",
        href: `/dashboard/deficiencies/${d.id}`,
        urgency: "normal",
      });
    }
  }

  for (const c of communications ?? []) {
    actionItems.push({
      id: `comm-${c.id}`,
      label: c.comm_ref || `Communication (${c.audience || "unspecified"})`,
      context: c.status === "draft" ? "Draft — needs approval" : "Approved — ready to issue",
      href: `/dashboard/communications/${c.id}`,
      urgency: c.status === "approved" ? "attention" : "normal",
    });
  }

  for (const r of evidenceRequests ?? []) {
    const overdue = r.due_date ? (daysUntil(r.due_date) ?? 0) < 0 : false;
    actionItems.push({
      id: `evreq-${r.id}`,
      label: r.title || "Evidence request",
      context:
        r.status === "submitted"
          ? "Client submitted — needs your review"
          : overdue
          ? `Overdue — was due ${r.due_date}`
          : `Awaiting ${r.owner_name || "client"}${r.due_date ? ` · due ${r.due_date}` : ""}`,
      href: `/dashboard/evidence-requests/${r.id}`,
      urgency: r.status === "submitted" ? "attention" : overdue ? "overdue" : "normal",
    });
  }

  for (const e of ccmExceptions ?? []) {
    actionItems.push({
      id: `ccm-${e.id}`,
      label: e.exception_ref || "CCM exception",
      context: "Open exception — needs triage",
      href: "/dashboard/ccm",
      urgency: "attention",
    });
  }

  for (const r of icfrReports ?? []) {
    actionItems.push({
      id: `icfr-${r.id}`,
      label: `ICFR Report${r.as_of_date ? ` (as of ${r.as_of_date})` : ""}`,
      context: r.status === "under_review" ? "Under review" : "Draft in progress",
      href: `/dashboard/icfr-report?id=${r.id}`,
      urgency: "normal",
    });
  }

  for (const c of certifications ?? []) {
    actionItems.push({
      id: `cert-${c.id}`,
      label: `${c.period} Certification`,
      context: c.status === "under_review" ? "Under review" : "Draft in progress",
      href: `/dashboard/certification?id=${c.id}`,
      urgency: "normal",
    });
  }

  for (const t of testPlans ?? []) {
    actionItems.push({
      id: `tp-${t.id}`,
      label: t.name,
      context: "Ready for review",
      href: `/dashboard/test-plans/${t.id}`,
      urgency: "attention",
    });
  }

  for (const c of contractItems) {
    actionItems.push({
      id: `contract-${c.id}`,
      label: c.client_name,
      context: "Contract sent — awaiting client signature",
      href: `/admin/contracts/${c.id}`,
      urgency: "normal",
    });
  }

  const urgencyOrder = { overdue: 0, attention: 1, normal: 2 };
  actionItems.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  // ---- Programme snapshot ----
  const totalControls = controlsAll?.length ?? 0;
  const testedControls = (controlsAll ?? []).filter((c) => c.status === "completed").length;
  const openDeficiencies = (deficiencies ?? []).filter((d) => d.status === "open").length;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          {ctx.org.name}
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-mute">
          Signed in as {ctx.userEmail} · {formatLabel(ctx.role)}
        </p>
      </div>

      {/* Programme snapshot strip */}
      <div className="mb-8 grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-line bg-panel p-4">
          <p className="text-xl font-bold text-paper">{totalControls}</p>
          <p className="text-xs text-mute">Controls in scope</p>
        </div>
        <div className="rounded-xl border border-line bg-panel p-4">
          <p className="text-xl font-bold text-paper">{testedControls}</p>
          <p className="text-xs text-mute">Controls tested</p>
        </div>
        <div className="rounded-xl border border-line bg-panel p-4">
          <p className="text-xl font-bold text-paper">{openDeficiencies}</p>
          <p className="text-xs text-mute">Open deficiencies</p>
        </div>
        <div className="rounded-xl border border-line bg-panel p-4">
          <p className="text-xl font-bold text-paper">{actionItems.length}</p>
          <p className="text-xs text-mute">Items needing action</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Needs your attention */}
        <div className="col-span-2 rounded-xl border border-line bg-ink p-6">
          <h2 className="mb-4 text-sm font-semibold text-paper">Needs Your Attention</h2>
          {actionItems.length > 0 ? (
            <ul className="divide-y divide-line">
              {actionItems.map((item) => (
                <li key={item.id} className="py-3">
                  <Link href={item.href} className="group flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-paper group-hover:text-signal">
                        {item.label}
                      </p>
                      <p className="text-xs text-mute">{item.context}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${urgencyStyles[item.urgency]}`}
                    >
                      {urgencyLabel[item.urgency]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">
              Nothing needs your attention right now — everything is up to date.
            </p>
          )}
        </div>

        {/* Recent activity */}
        <div className="rounded-xl border border-line bg-ink p-6">
          <h2 className="mb-4 text-sm font-semibold text-paper">Recent Activity</h2>
          {recentActivity && recentActivity.length > 0 ? (
            <ul className="space-y-3">
              {recentActivity.map((entry) => (
                <li key={entry.id} className="text-xs">
                  <p className="text-paper">
                    {formatLabel(entry.entity_type)} {entry.action}
                  </p>
                  <p className="text-mute">{new Date(entry.created_at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">No activity recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
