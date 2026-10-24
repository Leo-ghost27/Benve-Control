import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader, StatusBadge, TableShell, Th, fmtDate } from "@/components/phase2/ui";

type R = { id: string; record_id: string; record_version: number; status: string; submitted_at: string; decided_at: string | null };

export default async function ReviewQueue() {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  if (!["owner", "admin", "cfo", "controller", "internal_auditor", "adviser"].includes(ctx.role ?? ""))
    return <EmptyState title="The review queue is for the audit team" description="External reviewers see approved workpapers and shared comments." />;
  const supabase = await createClient();
  const { data } = await supabase.from("workpaper_reviews").select("id, record_id, record_version, status, submitted_at, decided_at")
    .eq("organization_id", ctx.org.id).eq("record_type", "test_plan").order("submitted_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as R[];
  const { data: plans } = rows.length ? await supabase.from("test_plans").select("id, name").in("id", rows.map((r) => r.record_id)) : { data: [] };
  const names = new Map((plans ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
  const waiting = rows.filter((r) => r.status === "submitted");
  const done = rows.filter((r) => r.status !== "submitted");
  const table = (list: R[]) => (
    <TableShell>
      <thead className="bg-panel text-xs text-mute"><tr><Th>Workpaper</Th><Th>Version</Th><Th>Status</Th><Th>Submitted</Th><Th>Decided</Th></tr></thead>
      <tbody>{list.map((r) => (
        <tr key={r.id} className="border-t border-line">
          <td className="px-3 py-2"><Link className="text-paper underline-offset-2 hover:underline" href={`/dashboard/test-plans/${r.record_id}`}>{names.get(r.record_id) ?? "Test plan"}</Link></td>
          <td className="px-3 py-2">v{r.record_version}</td>
          <td className="px-3 py-2"><StatusBadge value={r.status === "submitted" ? "in_review" : r.status === "superseded" ? "rejected" : r.status} /> <span className="text-xs text-mute">{r.status}</span></td>
          <td className="px-3 py-2">{fmtDate(r.submitted_at)}</td><td className="px-3 py-2">{fmtDate(r.decided_at)}</td>
        </tr>
      ))}</tbody>
    </TableShell>
  );
  return (
    <div className="p-8">
      <PageHeader eyebrow="Review" title="Review queue" subtitle={`${ctx.org.name} — workpapers submitted for review. Deciding requires explicit review-approval authority, assigned by the engagement lead.`} />
      <h2 className="mb-2 font-display text-lg font-semibold text-paper">Awaiting review ({waiting.length})</h2>
      {waiting.length === 0 ? <p className="mb-6 text-sm text-mute">Nothing is waiting for review.</p> : <div className="mb-6">{table(waiting)}</div>}
      <h2 className="mb-2 font-display text-lg font-semibold text-paper">Recent decisions and history</h2>
      {done.length === 0 ? <p className="text-sm text-mute">No review history yet.</p> : table(done)}
    </div>
  );
}
