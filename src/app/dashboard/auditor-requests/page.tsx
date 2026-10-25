import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Banner, PageHeader, StatusBadge, TableShell, Th, cardClass, fmtDate, inputClass, label, labelClass, primaryBtn } from "@/components/phase2/ui";
import { createAuditorRequestAction } from "@/lib/actions/auditor-requests";

type Row = { id: string; title: string; status: string; priority: string; due_date: string | null; assigned_to: string | null; created_at: string };

export default async function AuditorRequests({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const role = ctx.role ?? "";
  if (!["owner", "admin", "cfo", "controller", "internal_auditor", "adviser", "external_auditor"].includes(role))
    return <EmptyState title="Auditor requests are not available for your role" description="They are shared between the external auditor and the engagement team." />;
  const supabase = await createClient();
  const { data } = await supabase.from("auditor_requests")
    .select("id, title, status, priority, due_date, assigned_to, created_at").eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];
  const today = new Date().toISOString().slice(0, 10);
  const open = rows.filter((r) => r.status === "open" || r.status === "responded");
  const awaitingMgmt = rows.filter((r) => r.status === "open").length;
  const awaitingAuditor = rows.filter((r) => r.status === "responded").length;
  const canRaise = ["external_auditor", "owner", "admin"].includes(role);
  return (
    <div className="p-8">
      <PageHeader eyebrow="External audit" title="Auditor requests" subtitle={`${ctx.org.name} — requests from the external auditor and management's responses. Each side's words are kept separate and attributed.`} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {([["Open items", open.length], ["Awaiting management", awaitingMgmt], ["Awaiting auditor to close", awaitingAuditor]] as const).map(([t, n]) => (
          <div key={t} className={cardClass}><p className="text-xs text-mute">{t}</p><p className="mt-1 text-2xl font-semibold text-paper">{n}</p></div>
        ))}
      </div>
      {rows.length === 0 ? <p className="mb-6 text-sm text-mute">No requests yet.</p> : (
        <div className="mb-6"><TableShell>
          <thead className="bg-panel text-xs text-mute"><tr><Th>Request</Th><Th>Status</Th><Th>Priority</Th><Th>Due</Th><Th>Raised</Th></tr></thead>
          <tbody>{rows.map((r) => {
            const late = r.due_date && r.due_date < today && (r.status === "open" || r.status === "responded");
            return (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2"><Link className="text-paper underline-offset-2 hover:underline" href={`/dashboard/auditor-requests/${r.id}`}>{r.title}</Link></td>
                <td className="px-3 py-2"><StatusBadge value={r.status === "responded" ? "in_review" : r.status === "withdrawn" ? "rejected" : r.status === "closed" ? "approved" : "requested"} /> <span className="text-xs text-mute">{r.status}</span></td>
                <td className="px-3 py-2">{label(r.priority)}</td>
                <td className={`px-3 py-2 ${late ? "text-rose-300" : ""}`}>{fmtDate(r.due_date)}{late ? " · overdue" : ""}</td>
                <td className="px-3 py-2">{fmtDate(r.created_at)}</td>
              </tr>
            );
          })}</tbody>
        </TableShell></div>
      )}
      {canRaise && (
        <form action={createAuditorRequestAction} className={`${cardClass} grid gap-3 sm:grid-cols-2`}>
          <input type="hidden" name="org_id" value={ctx.org.id} />
          <h2 className="text-sm font-semibold text-paper sm:col-span-2">Raise a request</h2>
          <div className="sm:col-span-2"><label className={labelClass} htmlFor="ar-title">Title</label><input id="ar-title" name="title" required className={inputClass} /></div>
          <div className="sm:col-span-2"><label className={labelClass} htmlFor="ar-desc">What is needed</label><textarea id="ar-desc" name="description" rows={3} className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="ar-due">Due date</label><input id="ar-due" name="due_date" type="date" className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="ar-pri">Priority</label><select id="ar-pri" name="priority" defaultValue="normal" className={inputClass}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></div>
          <button className={`${primaryBtn} w-fit`} type="submit">Raise request</button>
        </form>
      )}
    </div>
  );
}
