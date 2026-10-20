import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { isOverdue } from "@/lib/phase2/workflow";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, fmtDate, fmtDateTime, inputClass, label, labelClass, secondaryBtn } from "@/components/phase2/ui";
import { escalationAction, setFollowUpStatusAction } from "@/lib/actions/ccm";

type SP = { period?: string; status?: string; overdue?: string; escalation?: string; owner?: string; q?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function FollowUpsPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx, periods, period } = p2;
  const header = <PageHeader eyebrow="Continuous Controls Monitoring" title="Follow-up actions" subtitle={ctx.org.name} />;
  if (!can(ctx.role, "ccm.view_internal")) return <>{header}<PermissionDenied message="Follow-ups are internal workpapers. External auditors and viewers see approved CCM summaries on the Overview tab." /></>;
  if (!period) return <>{header}<NoPeriod canCreate={can(ctx.role, "ccm.summary.review")} returnTo="/dashboard/ccm/follow-ups" /></>;

  const supabase = await createClient();
  let query = supabase
    .from("follow_ups")
    .select("id, description, owner_user_id, due_date, status, escalation_status, completed_at, updated_at, ccm_exception_id, deficiency_id, ccm_exceptions!inner(id, source_record_ref, reporting_period_id), deficiencies(id, title)")
    .eq("organization_id", ctx.org.id)
    .eq("ccm_exceptions.reporting_period_id", period.id)
    .order("due_date", { ascending: true });
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.escalation) query = query.eq("escalation_status", searchParams.escalation);
  if (searchParams.owner) query = query.eq("owner_user_id", searchParams.owner);
  if (searchParams.q) query = query.ilike("description", `%${searchParams.q.replace(/[%,()]/g, " ")}%`);
  if (searchParams.overdue === "1") query = query.neq("status", "closed").lt("due_date", new Date().toISOString().slice(0, 10));

  const [{ data, error }, members] = await Promise.all([query, loadMembers(supabase, ctx.org.id).catch(() => [])]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = data ?? [];
  const canWrite = can(ctx.role, "ccm.followup.write");
  const canApprove = can(ctx.role, "ccm.escalation.approve");
  const keys = ["status", "overdue", "escalation", "owner", "q"] as const;
  const active = keys.filter((k) => searchParams[k]);
  const activeParams = Object.fromEntries(active.map((k) => [k, searchParams[k]]));
  const here = withParams("/dashboard/ccm/follow-ups", { period: period.id, ...activeParams });
  const overdueCount = rows.filter((r) => isOverdue(r.due_date, r.status)).length;

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/ccm/follow-ups" keep={activeParams} />
      <form method="get" action="/dashboard/ccm/follow-ups" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="period" value={period.id} />
        <div><label className={labelClass} htmlFor="q">Search</label><input id="q" name="q" defaultValue={searchParams.q} className={`${inputClass} w-52`} placeholder="Action text" /></div>
        <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={searchParams.status ?? ""} className={inputClass}><option value="">All</option>{["open", "in_progress", "closed"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="escalation">Escalation</label><select id="escalation" name="escalation" defaultValue={searchParams.escalation ?? ""} className={inputClass}><option value="">All</option>{["none", "requested", "approved", "rejected"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="owner">Owner</label><select id="owner" name="owner" defaultValue={searchParams.owner ?? ""} className={inputClass}><option value="">All</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
        <label className="flex items-center gap-2 pb-2 text-sm text-paper"><input type="checkbox" name="overdue" value="1" defaultChecked={searchParams.overdue === "1"} /> Overdue only</label>
        <button className={secondaryBtn} type="submit">Apply</button>
        {active.length > 0 && <a className={secondaryBtn} href={withParams("/dashboard/ccm/follow-ups", { period: period.id })}>Clear</a>}
        <a className={`${secondaryBtn} ml-auto`} href={withParams("/dashboard/ccm/export", { kind: "follow-ups", period: period.id, ...activeParams })}>Export these results (CSV)</a>
      </form>
      <p className="mb-3 text-sm text-mute">{rows.length} follow-up{rows.length === 1 ? "" : "s"} · <span className={overdueCount ? "text-rose-300" : ""}>{overdueCount} overdue</span></p>

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No follow-ups match these filters" : `No follow-ups for ${period.label}`} description={active.length ? "Clear the filters to see everything." : "Follow-ups are created from an exception's detail page."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Action</Th><Th>Exception</Th><Th>Owner</Th><Th>Due</Th><Th>Status</Th><Th>Escalation</Th><Th>Actions</Th></tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((r) => {
              const ex = one(r.ccm_exceptions as { id: string; source_record_ref: string | null } | { id: string; source_record_ref: string | null }[] | null);
              const od = isOverdue(r.due_date, r.status);
              return (
                <tr key={r.id} className={`align-top ${od ? "bg-rose-950/10" : ""}`}>
                  <td className="max-w-sm px-3 py-2 text-paper">{r.description ?? "—"}</td>
                  <td className="px-3 py-2">{ex ? <Link className="text-signal hover:underline" href={withParams(`/dashboard/ccm/exceptions/${ex.id}`, { period: period.id })}>{ex.source_record_ref ?? ex.id.slice(0, 8)}</Link> : "—"}</td>
                  <td className="px-3 py-2 text-mute">{memberName(members, r.owner_user_id)}</td>
                  <td className="px-3 py-2">{fmtDate(r.due_date)} {od && <StatusBadge value="overdue" />}</td>
                  <td className="px-3 py-2"><StatusBadge value={r.status} />{r.completed_at && <p className="mt-1 text-[11px] text-mute">Completed {fmtDateTime(r.completed_at)}</p>}</td>
                  <td className="px-3 py-2">{r.escalation_status === "none" ? <span className="text-mute">—</span> : <StatusBadge value={r.escalation_status} />}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {canWrite && r.status !== "closed" && (["open", "in_progress", "closed"] as const).filter((s) => s !== r.status).map((to) => (
                        <form key={to} action={setFollowUpStatusAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="to" value={to} /><button className={secondaryBtn} type="submit">{to === "closed" ? "Complete" : label(to)}</button></form>
                      ))}
                      {canWrite && r.status !== "closed" && ["none", "rejected"].includes(r.escalation_status) && (
                        <form action={escalationAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="to" value="requested" /><button className={secondaryBtn} type="submit">Request escalation</button></form>
                      )}
                      {canApprove && r.escalation_status === "requested" && (["approved", "rejected"] as const).map((to) => (
                        <form key={to} action={escalationAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="to" value={to} /><button className={secondaryBtn} type="submit">{to === "approved" ? "Approve escalation" : "Reject escalation"}</button></form>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <div className="mt-3"><LastUpdated at={rows.map((r) => r.updated_at as string).sort().pop()} /></div>
    </>
  );
}
