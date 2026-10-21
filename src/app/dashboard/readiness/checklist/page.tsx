import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { memberName } from "@/lib/phase2/ccm-queries";
import { EDITABLE_STATUSES, loadReadinessBase } from "@/lib/phase2/readiness-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { addChecklistItemAction, updateChecklistItemAction } from "@/lib/actions/readiness";

type SP = { period?: string; assessment?: string; status?: string; area?: string; q?: string; notice?: string; error?: string };
const STATUSES = ["not_started", "in_progress", "complete", "not_applicable"];
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function ChecklistPage({ searchParams }: { searchParams: SP }) {
  let base;
  try { base = await loadReadinessBase(searchParams); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="Pre-IPO readiness" title="Readiness checklist" subtitle={base?.p2.ctx.org.name} />;
  if (!base) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { p2, assessment, members } = base;
  const { ctx, periods, period } = p2;
  const internal = can(ctx.role, "readiness.view_internal");
  if (!internal && !can(ctx.role, "readiness.view_approved")) return <>{header}<PermissionDenied /></>;
  if (!period) return <>{header}<NoPeriod canCreate={can(ctx.role, "readiness.review")} returnTo="/dashboard/readiness/checklist" /></>;
  if (!assessment) return <>{header}<PeriodBar periods={periods} current={period} action="/dashboard/readiness/checklist" /><EmptyState title="No readiness assessment for this period" description="Create an assessment on the Overview tab first." action={internal ? { label: "Go to Overview", href: withParams("/dashboard/readiness", { period: period.id }) } : undefined} /></>;

  const supabase = await createClient();
  let query = supabase.from("readiness_checklist_items").select("*, readiness_areas(area_name), evidence(file_name)").eq("organization_id", ctx.org.id).eq("assessment_id", assessment.id).order("created_at");
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.area) query = query.eq("area_id", searchParams.area);
  if (searchParams.q) query = query.ilike("item", `%${searchParams.q.replace(/[%,()]/g, " ")}%`);
  const [{ data, error }, { data: areas }, { data: evidence }] = await Promise.all([
    query,
    supabase.from("readiness_areas").select("id, area_name").eq("organization_id", ctx.org.id).eq("assessment_id", assessment.id).order("area_name"),
    internal ? supabase.from("evidence").select("id, file_name").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = data ?? [];
  const canEdit = can(ctx.role, "readiness.prepare") && EDITABLE_STATUSES.includes(assessment.status);
  const active = (["status", "area", "q"] as const).filter((k) => searchParams[k]);
  const here = withParams("/dashboard/readiness/checklist", { period: period.id, assessment: assessment.id, ...Object.fromEntries(active.map((k) => [k, searchParams[k]])) });
  const done = rows.filter((r) => r.status === "complete").length;
  const applicable = rows.filter((r) => r.status !== "not_applicable").length;

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/readiness/checklist" keep={{ assessment: assessment.id }} />
      <p className="mb-4 text-xs text-mute">Assessment: <span className="text-paper">{assessment.target_milestone}</span> <StatusBadge value={assessment.status} /> · {done} of {applicable} applicable items complete</p>

      <form method="get" action="/dashboard/readiness/checklist" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="period" value={period.id} /><input type="hidden" name="assessment" value={assessment.id} />
        <div><label className={labelClass} htmlFor="q">Search</label><input id="q" name="q" defaultValue={searchParams.q} className={`${inputClass} w-52`} /></div>
        <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={searchParams.status ?? ""} className={inputClass}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="area">Area</label><select id="area" name="area" defaultValue={searchParams.area ?? ""} className={inputClass}><option value="">All</option>{(areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.area_name}</option>)}</select></div>
        <button className={secondaryBtn} type="submit">Apply</button>
        {active.length > 0 && <a className={secondaryBtn} href={withParams("/dashboard/readiness/checklist", { period: period.id, assessment: assessment.id })}>Clear</a>}
      </form>

      {canEdit && (
        <details className={`${cardClass} mb-5`}>
          <summary className="cursor-pointer text-sm font-semibold text-paper">Add a checklist item</summary>
          <form action={addChecklistItemAction} className="mt-4 grid grid-cols-3 gap-3">
            <input type="hidden" name="return_to" value={here} /><input type="hidden" name="assessment_id" value={assessment.id} />
            <div className="col-span-2"><label className={labelClass} htmlFor="c_item">Item *</label><input id="c_item" name="item" required placeholder="e.g. Board-approved ICFR charter" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="c_ref">Requirement reference</label><input id="c_ref" name="requirement_ref" placeholder="e.g. SOX 404(a)" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="c_area">Area</label><select id="c_area" name="area_id" className={inputClass}><option value="">—</option>{(areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.area_name}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="c_ev">Evidence</label><select id="c_ev" name="evidence_id" className={inputClass}><option value="">None yet</option>{(evidence ?? []).map((e) => <option key={e.id} value={e.id}>{e.file_name}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="c_own">Owner</label><select id="c_own" name="owner_user_id" className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
            <div className="col-span-3"><button className={primaryBtn} type="submit">Add item</button></div>
          </form>
        </details>
      )}

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No items match these filters" : "No checklist items yet"} description={active.length ? "Clear the filters to see all items." : canEdit ? "Add the first item above." : "No checklist has been shared for this assessment."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Item</Th><Th>Area</Th><Th>Evidence</Th><Th>Owner</Th><Th>Status</Th>{canEdit && <Th>Update</Th>}</tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((r) => {
              const area = one(r.readiness_areas as { area_name: string } | { area_name: string }[] | null);
              const ev = one(r.evidence as { file_name: string } | { file_name: string }[] | null);
              return (
                <tr key={r.id} className="align-top">
                  <td className="max-w-md px-3 py-2 text-paper">{r.item}{r.requirement_ref && <span className="ml-2 text-xs text-mute">{r.requirement_ref}</span>}{r.notes && <p className="mt-0.5 text-xs text-mute">{r.notes}</p>}</td>
                  <td className="px-3 py-2 text-mute">{area?.area_name ?? "—"}</td>
                  <td className="px-3 py-2 text-mute">{ev?.file_name ?? (r.evidence_id ? "Linked" : "—")}</td>
                  <td className="px-3 py-2 text-mute">{memberName(members, r.owner_user_id)}</td>
                  <td className="px-3 py-2"><StatusBadge value={r.status} /></td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <form action={updateChecklistItemAction} className="flex flex-col gap-1.5">
                        <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={r.id} />
                        <select name="status" defaultValue={r.status} aria-label="Status" className={inputClass}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
                        <select name="evidence_id" defaultValue={r.evidence_id ?? ""} aria-label="Evidence" className={inputClass}><option value="">No evidence</option>{(evidence ?? []).map((e) => <option key={e.id} value={e.id}>{e.file_name}</option>)}</select>
                        <button className={secondaryBtn} type="submit">Save</button>
                      </form>
                    </td>
                  )}
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
