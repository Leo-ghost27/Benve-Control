import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Banner, PageHeader, StatusBadge, TableShell, Th, cardClass, fmtDate, label } from "@/components/phase2/ui";

type Plan = { id: string; name: string; status: string; due_date: string | null; controls: { code: string | null } | { code: string | null }[] | null };
type Review = { id: string; record_id: string; record_version: number; status: string; submitted_by: string | null; submitted_at: string; decision_comment: string | null };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function MyWork({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const supabase = await createClient();
  const orgId = ctx.org.id;
  const internal = ["owner", "admin", "cfo", "controller", "internal_auditor", "adviser"].includes(ctx.role ?? "");
  if (!internal) return <EmptyState title="My Work is for the audit team" description="External reviewers see approved workpapers and shared comments instead." />;

  const [{ data: planRows }, { data: canReviewData }] = await Promise.all([
    supabase.from("test_plans").select("id, name, status, due_date, controls(code)")
      .eq("organization_id", orgId).eq("assigned_to", ctx.userId).order("due_date", { ascending: true, nullsFirst: false }),
    supabase.rpc("p2_can_review", { p_org: orgId }),
  ]);
  const plans = (planRows ?? []) as unknown as Plan[];
  const canReview = canReviewData === true;
  const planIds = plans.map((p) => p.id);
  const { data: myReviewRows } = planIds.length
    ? await supabase.from("workpaper_reviews").select("id, record_id, record_version, status, submitted_by, submitted_at, decision_comment")
        .eq("organization_id", orgId).eq("record_type", "test_plan").in("record_id", planIds).order("record_version", { ascending: false })
    : { data: [] };
  const latest = new Map<string, Review>();
  for (const r of (myReviewRows ?? []) as Review[]) if (!latest.has(r.record_id)) latest.set(r.record_id, r);

  const { data: queueRows } = canReview
    ? await supabase.from("workpaper_reviews").select("id, record_id, record_version, status, submitted_by, submitted_at, decision_comment")
        .eq("organization_id", orgId).eq("record_type", "test_plan").eq("status", "submitted").order("submitted_at")
    : { data: [] };
  const queue = (queueRows ?? []) as Review[];
  const { data: queuePlans } = queue.length
    ? await supabase.from("test_plans").select("id, name, assigned_to").in("id", queue.map((q) => q.record_id))
    : { data: [] };
  const qp = new Map((queuePlans ?? []).map((p: { id: string; name: string; assigned_to: string | null }) => [p.id, p]));

  const today = new Date().toISOString().slice(0, 10);
  const open = plans.filter((p) => p.status !== "final");
  const overdue = open.filter((p) => p.due_date && p.due_date < today).length;
  const returned = plans.filter((p) => latest.get(p.id)?.status === "returned");

  return (
    <div className="p-8">
      <PageHeader eyebrow="Daily workflow" title="My work" subtitle={`${ctx.org.name} — tests assigned to you, items returned for rework, and work waiting for your review.`} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {([["Assigned to me", plans.length], ["Open", open.length], ["Overdue", overdue], ["Returned for rework", returned.length]] as const).map(([t, n]) => (
          <div key={t} className={cardClass}><p className="text-xs text-mute">{t}</p><p className={`mt-1 text-2xl font-semibold ${t === "Overdue" && n > 0 ? "text-rose-300" : "text-paper"}`}>{n}</p></div>
        ))}
      </div>

      {canReview && (
        <div className="mb-6">
          <h2 className="mb-2 font-display text-lg font-semibold text-paper">Awaiting my review ({queue.length})</h2>
          {queue.length === 0 ? <p className="text-sm text-mute">Nothing waiting.</p> : (
            <TableShell>
              <thead className="bg-panel text-xs text-mute"><tr><Th>Workpaper</Th><Th>Version</Th><Th>Submitted</Th><Th>Note</Th></tr></thead>
              <tbody>{queue.map((r) => {
                const p = qp.get(r.record_id);
                const mine = r.submitted_by === ctx.userId || p?.assigned_to === ctx.userId;
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-3 py-2"><Link className="text-paper underline-offset-2 hover:underline" href={`/dashboard/test-plans/${r.record_id}`}>{p?.name ?? "Test plan"}</Link></td>
                    <td className="px-3 py-2">v{r.record_version}</td><td className="px-3 py-2">{fmtDate(r.submitted_at)}</td>
                    <td className="px-3 py-2 text-xs text-mute">{mine ? "You prepared this: a separate reviewer is required" : ""}</td>
                  </tr>
                );
              })}</tbody>
            </TableShell>
          )}
        </div>
      )}

      <h2 className="mb-2 font-display text-lg font-semibold text-paper">Assigned to me</h2>
      {plans.length === 0 ? <p className="text-sm text-mute">No tests are assigned to you in this workspace. Assignments are set on each test plan.</p> : (
        <TableShell>
          <thead className="bg-panel text-xs text-mute"><tr><Th>Test</Th><Th>Control</Th><Th>Due</Th><Th>Status</Th><Th>Review</Th></tr></thead>
          <tbody>{plans.map((p) => {
            const rv = latest.get(p.id);
            const late = p.due_date && p.due_date < today && p.status !== "final";
            return (
              <tr key={p.id} className="border-t border-line">
                <td className="px-3 py-2"><Link className="text-paper underline-offset-2 hover:underline" href={`/dashboard/test-plans/${p.id}`}>{p.name}</Link></td>
                <td className="px-3 py-2">{one(p.controls)?.code ?? "—"}</td>
                <td className={`px-3 py-2 ${late ? "text-rose-300" : ""}`}>{fmtDate(p.due_date)}{late ? " · overdue" : ""}</td>
                <td className="px-3 py-2"><StatusBadge value={p.status === "final" ? "approved" : p.status === "ready_for_review" ? "in_review" : "in_progress"} /> <span className="text-xs text-mute">{label(p.status)}</span></td>
                <td className="px-3 py-2 text-xs text-mute">{rv ? `v${rv.record_version} ${rv.status}${rv.status === "returned" && rv.decision_comment ? `: ${rv.decision_comment}` : ""}` : "—"}</td>
              </tr>
            );
          })}</tbody>
        </TableShell>
      )}
      <p className="mt-4 text-xs text-mute">Showing the selected workspace only. Use the client selector in the header to see work in another client.</p>
    </div>
  );
}
