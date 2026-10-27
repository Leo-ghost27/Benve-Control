import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Banner, PageHeader, StatusBadge, cardClass, fmtDate, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { createRemediationTaskAction, updateRemediationTaskAction } from "@/lib/actions/registers";
import Link from "next/link";

type Task = { id: string; deficiency_id: string; title: string; description: string | null; assigned_to: string | null; due_date: string | null; status: string; root_cause: string | null; retest_result: string | null };
type Member = { user_id: string; role: string; full_name: string | null; email: string | null };

export default async function Remediation({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const supabase = await createClient();
  const orgId = ctx.org.id;
  const internal = ["owner", "admin", "cfo", "controller", "internal_auditor", "adviser"].includes(ctx.role ?? "");
  const [{ data: tr }, { data: dr }] = await Promise.all([
    supabase.from("remediation_tasks").select("id, deficiency_id, title, description, assigned_to, due_date, status, root_cause, retest_result").eq("organization_id", orgId).order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("deficiencies").select("id, title").eq("organization_id", orgId).order("title"),
  ]);
  const tasks = (tr ?? []) as Task[]; const defs = (dr ?? []) as { id: string; title: string }[];
  const defName = new Map(defs.map((d) => [d.id, d.title]));
  const { data: mr } = internal ? await supabase.rpc("p2_org_members", { p_org: orgId }) : { data: [] };
  const members = ((mr ?? []) as Member[]).filter((m) => ["owner", "admin", "cfo", "controller", "internal_auditor"].includes(m.role));
  const who = (id: string | null) => { const m = members.find((x) => x.user_id === id); return m ? (m.full_name || m.email) : id ? "Team member" : "Unassigned"; };
  const today = new Date().toISOString().slice(0, 10);
  const canManage = ["owner", "admin", "internal_auditor"].includes(ctx.role ?? "");
  const open = tasks.filter((t) => t.status !== "complete");
  const overdue = open.filter((t) => t.due_date && t.due_date < today).length;
  const needsRetest = tasks.filter((t) => t.status === "complete" && !t.retest_result).length;

  return (
    <div className="p-8">
      <PageHeader eyebrow="Deficiency follow-through" title="Remediation" subtitle={`${ctx.org.name} — fixes for identified deficiencies, who owns them, and whether the fix was retested.`} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {([["Tasks", tasks.length], ["Open", open.length], ["Overdue", overdue], ["Complete, not retested", needsRetest]] as const).map(([t, n]) => (
          <div key={t} className={cardClass}><p className="text-xs text-mute">{t}</p><p className={`mt-1 text-2xl font-semibold ${(t === "Overdue" || t.startsWith("Complete")) && n > 0 ? "text-amber-300" : "text-paper"}`}>{n}</p></div>
        ))}
      </div>
      {tasks.length === 0 ? <p className="mb-6 text-sm text-mute">No remediation tasks yet.</p> : (
        <ul className="mb-8 space-y-3">{tasks.map((t) => {
          const mine = t.assigned_to === ctx.userId;
          const editable = canManage || mine;
          const late = t.due_date && t.due_date < today && t.status !== "complete";
          return (
            <li key={t.id} className={cardClass}>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-paper">{t.title}</h3>
                <StatusBadge value={t.status === "complete" ? "approved" : t.status === "in_progress" ? "in_progress" : "draft"} /><span className="text-xs text-mute">{label(t.status)}</span>
                {late && <span className="text-xs text-rose-300">overdue</span>}
              </div>
              <p className="mt-1 text-xs text-mute">Deficiency: <Link className="text-paper hover:underline" href={`/dashboard/deficiencies/${t.deficiency_id}`}>{defName.get(t.deficiency_id) ?? "View"}</Link> · {who(t.assigned_to)} · due {fmtDate(t.due_date)}</p>
              {t.description && <p className="mt-2 text-sm text-paper">{t.description}</p>}
              {editable ? (
                <form action={updateRemediationTaskAction} className="mt-3 grid gap-2 sm:grid-cols-4 sm:items-end">
                  <input type="hidden" name="task_id" value={t.id} />
                  <div><label className={labelClass} htmlFor={`st-${t.id}`}>Status</label><select id={`st-${t.id}`} name="status" defaultValue={t.status} className={inputClass}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="complete">Complete</option></select></div>
                  <div><label className={labelClass} htmlFor={`as-${t.id}`}>Assigned to</label>
                    <select id={`as-${t.id}`} name="assigned_to" defaultValue={t.assigned_to ?? ""} disabled={!canManage} className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}</select></div>
                  <div><label className={labelClass} htmlFor={`du-${t.id}`}>Due</label><input id={`du-${t.id}`} name="due_date" type="date" defaultValue={t.due_date ?? ""} className={inputClass} /></div>
                  <div className="sm:col-span-2"><label className={labelClass} htmlFor={`rc-${t.id}`}>Root cause</label><input id={`rc-${t.id}`} name="root_cause" defaultValue={t.root_cause ?? ""} className={inputClass} /></div>
                  <div className="sm:col-span-2"><label className={labelClass} htmlFor={`rt-${t.id}`}>Retest result</label><input id={`rt-${t.id}`} name="retest_result" defaultValue={t.retest_result ?? ""} className={inputClass} placeholder="e.g. Passed on re-test 2026-11-20" /></div>
                  <button className={secondaryBtn} type="submit">Save</button>
                </form>
              ) : (
                <p className="mt-2 text-xs text-mute">Root cause: {t.root_cause ?? "—"} · Retest: {t.retest_result ?? "—"}</p>
              )}
            </li>);
        })}</ul>
      )}
      {canManage && (
        <form action={createRemediationTaskAction} className={`${cardClass} grid gap-3 sm:grid-cols-2`}>
          <h2 className="text-sm font-semibold text-paper sm:col-span-2">New remediation task</h2>
          <div className="sm:col-span-2"><label className={labelClass} htmlFor="nt-def">Deficiency</label><select id="nt-def" name="deficiency_id" required defaultValue="" className={inputClass}><option value="" disabled>Select a deficiency</option>{defs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></div>
          <div className="sm:col-span-2"><label className={labelClass} htmlFor="nt-title">Task</label><input id="nt-title" name="title" required className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="nt-as">Assign to</label><select id="nt-as" name="assigned_to" defaultValue="" className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}</select></div>
          <div><label className={labelClass} htmlFor="nt-due">Due date</label><input id="nt-due" name="due_date" type="date" className={inputClass} /></div>
          <div className="sm:col-span-2"><label className={labelClass} htmlFor="nt-rc">Root cause (if known)</label><input id="nt-rc" name="root_cause" className={inputClass} /></div>
          <button className={`${primaryBtn} w-fit`} type="submit">Create task</button>
        </form>
      )}
    </div>
  );
}
