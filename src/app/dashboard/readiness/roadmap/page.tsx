import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { memberName } from "@/lib/phase2/ccm-queries";
import { loadReadinessBase } from "@/lib/phase2/readiness-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDate, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { addRoadmapActionAction, setRoadmapStatusAction } from "@/lib/actions/readiness";

type SP = { period?: string; assessment?: string; status?: string; owner?: string; priority?: string; overdue?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function RoadmapPage({ searchParams }: { searchParams: SP }) {
  let base;
  try { base = await loadReadinessBase(searchParams); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="Pre-IPO readiness" title="Remediation roadmap" subtitle={base?.p2.ctx.org.name} />;
  if (!base) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { p2, assessment, members } = base;
  const { ctx, periods, period } = p2;
  const internal = can(ctx.role, "readiness.view_internal");
  if (!internal && !can(ctx.role, "readiness.view_approved")) return <>{header}<PermissionDenied /></>;
  if (!period) return <>{header}<NoPeriod canCreate={can(ctx.role, "readiness.review")} returnTo="/dashboard/readiness/roadmap" /></>;
  if (!assessment) return <>{header}<PeriodBar periods={periods} current={period} action="/dashboard/readiness/roadmap" /><EmptyState title="No readiness assessment for this period" description="Create an assessment on the Overview tab first." /></>;

  const supabase = await createClient();
  const { data: gaps, error: gerr } = await supabase.from("readiness_gaps").select("id, requirement, description, status").eq("organization_id", ctx.org.id).eq("readiness_assessment_id", assessment.id);
  if (gerr) return <>{header}<ErrorState message={gerr.message} /></>;
  const gapIds = (gaps ?? []).map((g) => g.id);
  let query = supabase.from("readiness_roadmap_actions").select("id, gap_id, action_ref, description, owner_user_id, target_date, status, priority, completed_at, updated_at").eq("organization_id", ctx.org.id).in("gap_id", gapIds.length ? gapIds : ["00000000-0000-0000-0000-000000000000"]).order("target_date", { ascending: true, nullsFirst: false });
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.owner) query = query.eq("owner_user_id", searchParams.owner);
  if (searchParams.priority) query = query.eq("priority", searchParams.priority);
  const today = new Date().toISOString().slice(0, 10);
  if (searchParams.overdue === "1") query = query.lt("target_date", today).neq("status", "complete");
  const { data, error } = await query;
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = data ?? [];
  const gapMap = new Map((gaps ?? []).map((g) => [g.id, g]));
  const canEdit = can(ctx.role, "readiness.prepare");
  const active = (["status", "owner", "priority", "overdue"] as const).filter((k) => searchParams[k]);
  const here = withParams("/dashboard/readiness/roadmap", { period: period.id, assessment: assessment.id, ...Object.fromEntries(active.map((k) => [k, searchParams[k]])) });
  const total = rows.length, complete = rows.filter((r) => r.status === "complete").length;

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/readiness/roadmap" keep={{ assessment: assessment.id }} />
      <p className="mb-4 text-xs text-mute">Assessment: <span className="text-paper">{assessment.target_milestone}</span> <StatusBadge value={assessment.status} /> · {complete} of {total} actions complete</p>

      <form method="get" action="/dashboard/readiness/roadmap" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="period" value={period.id} /><input type="hidden" name="assessment" value={assessment.id} />
        <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={searchParams.status ?? ""} className={inputClass}><option value="">All</option>{["not_started", "in_progress", "complete"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="priority">Priority</label><select id="priority" name="priority" defaultValue={searchParams.priority ?? ""} className={inputClass}><option value="">All</option>{["high", "medium", "low"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        {internal && <div><label className={labelClass} htmlFor="owner">Owner</label><select id="owner" name="owner" defaultValue={searchParams.owner ?? ""} className={inputClass}><option value="">All</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>}
        <label className="flex items-center gap-2 pb-2 text-sm text-paper"><input type="checkbox" name="overdue" value="1" defaultChecked={searchParams.overdue === "1"} /> Overdue only</label>
        <button className={secondaryBtn} type="submit">Apply</button>
        {active.length > 0 && <a className={secondaryBtn} href={withParams("/dashboard/readiness/roadmap", { period: period.id, assessment: assessment.id })}>Clear</a>}
      </form>

      {canEdit && (gaps ?? []).length > 0 && (
        <details className={`${cardClass} mb-5`}>
          <summary className="cursor-pointer text-sm font-semibold text-paper">Add a roadmap action</summary>
          <form action={addRoadmapActionAction} className="mt-4 grid grid-cols-4 gap-3">
            <input type="hidden" name="return_to" value={here} />
            <div className="col-span-2"><label className={labelClass} htmlFor="ra_g">Gap *</label><select id="ra_g" name="gap_id" required className={inputClass}><option value="">Choose…</option>{(gaps ?? []).map((g) => <option key={g.id} value={g.id}>{g.requirement ?? g.description}</option>)}</select></div>
            <div className="col-span-2"><label className={labelClass} htmlFor="ra_d">Action *</label><input id="ra_d" name="description" required className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="ra_o">Owner</label><select id="ra_o" name="owner_user_id" className={inputClass}><option value="">—</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="ra_t">Target date</label><input id="ra_t" name="target_date" type="date" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="ra_p">Priority</label><select id="ra_p" name="priority" className={inputClass}><option value="">—</option>{["high", "medium", "low"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
            <div className="flex items-end"><button className={primaryBtn} type="submit">Add action</button></div>
          </form>
        </details>
      )}

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No actions match these filters" : "No roadmap actions yet"} description={active.length ? "Clear the filters to see all actions." : (gaps ?? []).length === 0 ? "Create gaps first; roadmap actions are tied to a gap." : "Add the first action above."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Action</Th><Th>Gap</Th><Th>Owner</Th><Th>Target</Th><Th>Priority</Th><Th>Status</Th>{canEdit && <Th>Update</Th>}</tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((r) => {
              const g = gapMap.get(r.gap_id);
              const od = r.target_date && r.target_date < today && r.status !== "complete";
              return (
                <tr key={r.id} className="align-top">
                  <td className="max-w-md px-3 py-2 text-paper">{r.action_ref ? `${r.action_ref} · ` : ""}{r.description}</td>
                  <td className="px-3 py-2">{g ? <Link className="text-signal hover:underline" href={withParams(`/dashboard/readiness/gaps/${g.id}`, { period: period.id, assessment: assessment.id })}>{g.requirement ?? "Gap"}</Link> : "—"}</td>
                  <td className="px-3 py-2 text-mute">{memberName(members, r.owner_user_id)}</td>
                  <td className={`px-3 py-2 ${od ? "text-rose-300" : "text-mute"}`}>{fmtDate(r.target_date)}</td>
                  <td className="px-3 py-2"><StatusBadge value={r.priority} /></td>
                  <td className="px-3 py-2"><StatusBadge value={r.status} />{od && <span className="ml-1"><StatusBadge value="overdue" /></span>}</td>
                  {canEdit && <td className="px-3 py-2"><div className="flex gap-1.5">{(["not_started", "in_progress", "complete"] as const).filter((s) => s !== r.status).map((to) => <form key={to} action={setRoadmapStatusAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="to" value={to} /><button className={secondaryBtn} type="submit">{to === "complete" ? "Complete" : label(to)}</button></form>)}</div></td>}
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
