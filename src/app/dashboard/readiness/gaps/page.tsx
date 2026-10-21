import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { memberName } from "@/lib/phase2/ccm-queries";
import { EDITABLE_STATUSES, loadReadinessBase } from "@/lib/phase2/readiness-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDate, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { saveGapAction } from "@/lib/actions/readiness";

type SP = { period?: string; assessment?: string; status?: string; severity?: string; owner?: string; area?: string; overdue?: string; q?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function GapsPage({ searchParams }: { searchParams: SP }) {
  let base;
  try { base = await loadReadinessBase(searchParams); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="Pre-IPO readiness" title="Readiness gaps" subtitle={base?.p2.ctx.org.name} />;
  if (!base) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { p2, assessments, assessment, members } = base;
  const { ctx, periods, period } = p2;
  const internal = can(ctx.role, "readiness.view_internal");
  if (!internal && !can(ctx.role, "readiness.view_approved")) return <>{header}<PermissionDenied /></>;
  if (!period) return <>{header}<NoPeriod canCreate={can(ctx.role, "readiness.review")} returnTo="/dashboard/readiness/gaps" /></>;
  if (!assessment) return <>{header}<PeriodBar periods={periods} current={period} action="/dashboard/readiness/gaps" /><EmptyState title="No readiness assessment for this period" description={internal ? "Create an assessment on the Overview tab first; gaps belong to an assessment." : "No approved assessment has been shared for this period."} action={internal ? { label: "Go to Overview", href: withParams("/dashboard/readiness", { period: period.id }) } : undefined} /></>;

  const supabase = await createClient();
  let query = supabase
    .from("readiness_gaps")
    .select("id, requirement, description, gap_severity, status, target_date, owner_user_id, area_id, updated_at, readiness_areas(area_name), controls:related_control_id(code)")
    .eq("organization_id", ctx.org.id)
    .eq("readiness_assessment_id", assessment.id)
    .order("target_date", { ascending: true, nullsFirst: false });
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.severity) query = query.eq("gap_severity", searchParams.severity);
  if (searchParams.owner) query = query.eq("owner_user_id", searchParams.owner);
  if (searchParams.area) query = query.eq("area_id", searchParams.area);
  if (searchParams.overdue === "1") query = query.lt("target_date", new Date().toISOString().slice(0, 10)).neq("status", "archived");
  if (searchParams.q) { const s = searchParams.q.replace(/[%,()]/g, " "); query = query.or(`description.ilike.%${s}%,requirement.ilike.%${s}%`); }

  const [{ data, error }, { data: areas }] = await Promise.all([
    query,
    supabase.from("readiness_areas").select("id, area_name").eq("organization_id", ctx.org.id).eq("assessment_id", assessment.id).order("area_name"),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = data ?? [];
  const canPrepare = can(ctx.role, "readiness.prepare");
  const keys = ["status", "severity", "owner", "area", "overdue", "q"] as const;
  const active = keys.filter((k) => searchParams[k]);
  const activeParams = Object.fromEntries(active.map((k) => [k, searchParams[k]]));
  const here = withParams("/dashboard/readiness/gaps", { period: period.id, assessment: assessment.id, ...activeParams });
  const locked = !EDITABLE_STATUSES.includes(assessment.status);

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/readiness/gaps" keep={{ assessment: assessment.id, ...activeParams }} />
      <p className="mb-4 text-xs text-mute">Assessment: <span className="text-paper">{assessment.target_milestone}</span> <StatusBadge value={assessment.status} />{assessments.length > 1 && " · switch assessment on the Overview tab"}</p>

      <form method="get" action="/dashboard/readiness/gaps" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="period" value={period.id} /><input type="hidden" name="assessment" value={assessment.id} />
        <div><label className={labelClass} htmlFor="q">Search</label><input id="q" name="q" defaultValue={searchParams.q} className={`${inputClass} w-48`} placeholder="Requirement or description" /></div>
        <div><label className={labelClass} htmlFor="severity">Severity</label><select id="severity" name="severity" defaultValue={searchParams.severity ?? ""} className={inputClass}><option value="">All</option>{["high", "medium", "low"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={searchParams.status ?? ""} className={inputClass}><option value="">All</option>{["draft", "prepared", "submitted", "returned", "approved", "reopened", "archived"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="area">Area</label><select id="area" name="area" defaultValue={searchParams.area ?? ""} className={inputClass}><option value="">All</option>{(areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.area_name}</option>)}</select></div>
        {internal && <div><label className={labelClass} htmlFor="owner">Owner</label><select id="owner" name="owner" defaultValue={searchParams.owner ?? ""} className={inputClass}><option value="">All</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>}
        <label className="flex items-center gap-2 pb-2 text-sm text-paper"><input type="checkbox" name="overdue" value="1" defaultChecked={searchParams.overdue === "1"} /> Past target date</label>
        <button className={secondaryBtn} type="submit">Apply</button>
        {active.length > 0 && <a className={secondaryBtn} href={withParams("/dashboard/readiness/gaps", { period: period.id, assessment: assessment.id })}>Clear</a>}
      </form>

      {canPrepare && !locked && (
        <details className={`${cardClass} mb-5`}>
          <summary className="cursor-pointer text-sm font-semibold text-paper">Create a gap</summary>
          <form action={saveGapAction} className="mt-4 grid grid-cols-3 gap-3">
            <input type="hidden" name="return_to" value={here} /><input type="hidden" name="readiness_assessment_id" value={assessment.id} />
            <div><label className={labelClass} htmlFor="g_req">Requirement</label><input id="g_req" name="requirement" className={inputClass} placeholder="e.g. COSO Principle 16 — monitoring" /></div>
            <div><label className={labelClass} htmlFor="g_area">Area</label><select id="g_area" name="area_id" className={inputClass}><option value="">—</option>{(areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.area_name}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="g_sev">Priority *</label><select id="g_sev" name="gap_severity" required className={inputClass}><option value="">Choose…</option>{["high", "medium", "low"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
            <div className="col-span-3"><label className={labelClass} htmlFor="g_desc">Description *</label><textarea id="g_desc" name="description" required rows={2} className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="g_own">Owner</label><select id="g_own" name="owner_user_id" className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="g_td">Target date</label><input id="g_td" name="target_date" type="date" className={inputClass} /></div>
            <div className="flex items-end"><button className={primaryBtn} type="submit">Create draft gap</button></div>
          </form>
        </details>
      )}
      {canPrepare && locked && <p className="mb-4 text-xs text-amber-300">This assessment is {assessment.status}; gaps can be added again after it is returned or reopened.</p>}

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No gaps match these filters" : "No gaps recorded"} description={active.length ? "Clear the filters to see all gaps." : canPrepare ? "Create the first gap above." : "No approved gaps have been shared for this assessment."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Requirement / description</Th><Th>Area</Th><Th>Priority</Th><Th>Owner</Th><Th>Target</Th><Th>Control</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((g) => {
              const area = one(g.readiness_areas as { area_name: string } | { area_name: string }[] | null);
              const ctl = one(g.controls as { code: string } | { code: string }[] | null);
              const od = g.target_date && g.target_date < new Date().toISOString().slice(0, 10) && g.status !== "archived";
              return (
                <tr key={g.id} className="align-top hover:bg-panel/50">
                  <td className="max-w-md px-3 py-2"><Link className="text-signal hover:underline" href={withParams(`/dashboard/readiness/gaps/${g.id}`, { period: period.id, assessment: assessment.id })}>{g.requirement ?? "Gap"}</Link><p className="mt-0.5 text-xs text-mute">{g.description}</p></td>
                  <td className="px-3 py-2 text-mute">{area?.area_name ?? "—"}</td>
                  <td className="px-3 py-2"><StatusBadge value={g.gap_severity} /></td>
                  <td className="px-3 py-2 text-mute">{memberName(members, g.owner_user_id)}</td>
                  <td className={`px-3 py-2 ${od ? "text-rose-300" : "text-mute"}`}>{fmtDate(g.target_date)}</td>
                  <td className="px-3 py-2 text-mute">{ctl?.code ?? "—"}</td>
                  <td className="px-3 py-2"><StatusBadge value={g.status} /></td>
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
