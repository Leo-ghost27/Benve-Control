import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { Banner, PageHeader, StatusBadge, cardClass, fmtDate, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import {
  addRequestCommentAction, assignAuditorRequestAction, closeAuditorRequestAction, reopenAuditorRequestAction,
  respondAuditorRequestAction, withdrawAuditorRequestAction,
} from "@/lib/actions/auditor-requests";

type Req = { id: string; organization_id: string; title: string; description: string | null; status: string; priority: string; due_date: string | null;
  requested_by: string | null; assigned_to: string | null; auditor_conclusion: string | null; closed_at: string | null; created_at: string };
type Resp = { id: string; kind: string; body: string; author_id: string | null; author_role: string | null; created_at: string };
type Member = { user_id: string; role: string; full_name: string | null; email: string | null };

const KIND: Record<string, string> = { management_response: "Management response", auditor_followup: "Auditor follow-up", status_note: "Status note" };

export default async function AuditorRequestDetail({ params, searchParams }: { params: { id: string }; searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();
  const supabase = await createClient();
  const { data: reqRow } = await supabase.from("auditor_requests").select("*").eq("id", params.id).eq("organization_id", ctx.org!.id).maybeSingle();
  if (!reqRow) notFound();
  const r = reqRow as Req;
  const role = ctx.role ?? "";
  const internal = ["owner", "admin", "cfo", "controller", "internal_auditor", "adviser"].includes(role);
  const isExt = role === "external_auditor";
  const mgmt = ["owner", "admin", "cfo", "controller", "internal_auditor"].includes(role);
  const { data: respRows } = await supabase.from("auditor_request_responses").select("id, kind, body, author_id, author_role, created_at").eq("request_id", r.id).order("created_at");
  const responses = (respRows ?? []) as Resp[];
  const { data: memberRows } = internal ? await supabase.rpc("p2_org_members", { p_org: ctx.org!.id }) : { data: [] };
  const members = (memberRows ?? []) as Member[];
  const who = (id: string | null, fallbackRole: string | null) => {
    const m = members.find((x) => x.user_id === id);
    return m ? (m.full_name || m.email || label(m.role)) : label(fallbackRole ?? "team member");
  };
  const { data: noteRows } = internal
    ? await supabase.from("workpaper_comments").select("id, body, author_id, created_at").eq("organization_id", ctx.org!.id).eq("target_type", "auditor_request").eq("target_id", r.id).eq("visibility", "internal").order("created_at", { ascending: false })
    : { data: [] };
  const notes = (noteRows ?? []) as { id: string; body: string; author_id: string | null; created_at: string }[];
  const open = r.status === "open" || r.status === "responded";
  const assignable = members.filter((m) => ["owner", "admin", "cfo", "controller", "internal_auditor"].includes(m.role));
  const canWithdraw = (r.requested_by === ctx.userId || ["owner", "admin"].includes(role)) && open;

  return (
    <div className="p-8">
      <Link href="/dashboard/auditor-requests" className="text-xs text-mute hover:text-paper">← All requests</Link>
      <PageHeader eyebrow={`Auditor request · ${label(r.priority)} priority`} title={r.title} subtitle={`Raised ${fmtDate(r.created_at)}${r.due_date ? ` · due ${fmtDate(r.due_date)}` : ""}`} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <StatusBadge value={r.status === "responded" ? "in_review" : r.status === "withdrawn" ? "rejected" : r.status === "closed" ? "approved" : "requested"} />
        <span className="text-xs text-mute">{r.status === "open" ? "Waiting for management" : r.status === "responded" ? "Waiting for the auditor to close or follow up" : label(r.status)}</span>
        {r.assigned_to && <span className="text-xs text-mute">Assigned to {who(r.assigned_to, null)}</span>}
      </div>
      {r.description && <div className={`${cardClass} mb-5 text-sm`}><p className="text-xs text-mute">What is needed</p><p className="whitespace-pre-wrap text-paper">{r.description}</p></div>}

      <div className={`${cardClass} mb-5`}>
        <h2 className="mb-3 text-sm font-semibold text-paper">Conversation</h2>
        {responses.length === 0 ? <p className="text-sm text-mute">No responses yet.</p> : (
          <ul className="space-y-2">{responses.map((x) => (
            <li key={x.id} className={`rounded-md border p-3 text-sm ${x.kind === "management_response" ? "border-emerald-900/60" : x.kind === "auditor_followup" ? "border-sky-900/60" : "border-line"}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-mute"><span className="text-paper">{KIND[x.kind] ?? x.kind}</span><span>{who(x.author_id, x.author_role)}</span><span>{fmtDateTime(x.created_at)}</span></div>
              <p className="mt-1 whitespace-pre-wrap text-paper">{x.body}</p>
            </li>
          ))}</ul>
        )}
        {r.auditor_conclusion && (
          <div className="mt-3 rounded-md border border-sky-900/60 p-3 text-sm"><p className="text-xs text-sky-300">Auditor&apos;s conclusion (closed {fmtDate(r.closed_at)})</p><p className="whitespace-pre-wrap text-paper">{r.auditor_conclusion}</p></div>
        )}
        {open && (mgmt || isExt) && (
          <form action={respondAuditorRequestAction} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="request_id" value={r.id} />
            <div><label className={labelClass} htmlFor="resp">{isExt ? "Add a follow-up question or clarification" : "Respond on behalf of management"}</label><textarea id="resp" name="body" rows={2} required className={inputClass} /></div>
            <button className={primaryBtn} type="submit">{isExt ? "Send follow-up" : "Send response"}</button>
          </form>
        )}
      </div>

      {isExt && r.status === "responded" && (
        <form action={closeAuditorRequestAction} className={`${cardClass} mb-5 grid gap-2 border-sky-900/60`}>
          <input type="hidden" name="request_id" value={r.id} />
          <h2 className="text-sm font-semibold text-sky-300">Close with your conclusion</h2>
          <p className="text-xs text-mute">Your conclusion is recorded in your name and role. Management cannot write or edit it.</p>
          <textarea name="conclusion" rows={2} required className={inputClass} aria-label="Auditor conclusion" />
          <button className={`${primaryBtn} w-fit`} type="submit">Close request</button>
        </form>
      )}
      {mgmt && ["owner", "admin", "cfo", "controller"].includes(role) && open && (
        <form action={assignAuditorRequestAction} className={`${cardClass} mb-5 flex flex-wrap items-end gap-3`}>
          <input type="hidden" name="request_id" value={r.id} />
          <div className="min-w-[14rem] flex-1"><label className={labelClass} htmlFor="asg">Assign to</label>
            <select id="asg" name="assigned_to" defaultValue={r.assigned_to ?? ""} className={inputClass}><option value="">Unassigned</option>{assignable.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email} · {label(m.role)}</option>)}</select></div>
          <button className={secondaryBtn} type="submit">Assign</button>
        </form>
      )}
      {(r.status === "closed" || r.status === "withdrawn") && (isExt || ["owner", "admin"].includes(role)) && (
        <form action={reopenAuditorRequestAction} className={`${cardClass} mb-5 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end`}>
          <input type="hidden" name="request_id" value={r.id} />
          <div><label className={labelClass} htmlFor="reo">Reopen (rationale required)</label><input id="reo" name="reason" required minLength={10} className={inputClass} /></div>
          <button className={secondaryBtn} type="submit">Reopen</button>
        </form>
      )}
      {canWithdraw && (
        <form action={withdrawAuditorRequestAction} className="mb-5 flex flex-wrap items-end gap-2">
          <input type="hidden" name="request_id" value={r.id} />
          <div><label className={labelClass} htmlFor="wd">Withdraw this request (reason)</label><input id="wd" name="reason" required minLength={5} className={inputClass} /></div>
          <button className={`${secondaryBtn} text-rose-300`} type="submit">Withdraw</button>
        </form>
      )}

      {internal && (
        <div className={cardClass}>
          <h2 className="mb-1 text-sm font-semibold text-paper">Internal notes</h2>
          <p className="mb-3 text-xs text-mute">Visible to the audit team and management only. The external auditor cannot see these.</p>
          {notes.length > 0 && <ul className="mb-3 space-y-2">{notes.map((n) => <li key={n.id} className="rounded-md border border-amber-900/50 p-3 text-sm"><span className="text-xs text-mute">{who(n.author_id, null)} · {fmtDateTime(n.created_at)}</span><p className="text-paper">{n.body}</p></li>)}</ul>}
          <form action={addRequestCommentAction} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="request_id" value={r.id} /><input type="hidden" name="org_id" value={ctx.org!.id} />
            <input name="body" required className={inputClass} aria-label="Internal note" /><button className={secondaryBtn} type="submit">Add note</button>
          </form>
        </div>
      )}
    </div>
  );
}
