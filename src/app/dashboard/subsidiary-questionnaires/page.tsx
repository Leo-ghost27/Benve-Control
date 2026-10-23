import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { OUTCOME_LABELS } from "@/lib/phase2/questionnaire";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDate, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { createQuestionnaireAction } from "@/lib/actions/group";

type SP = { period?: string; status?: string; entity?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function QuestionnairesPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="Multi-entity / group ICFR" title="Subsidiary questionnaires" subtitle={p2?.ctx.org.name} />;
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx, periods, period } = p2;
  const internal = can(ctx.role, "group.view_internal");
  if (!internal && !can(ctx.role, "group.view_approved")) return <>{header}<PermissionDenied /></>;
  if (!period) return <>{header}<Banner notice={searchParams.notice} error={searchParams.error} /><NoPeriod canCreate={can(ctx.role, "group.review")} returnTo="/dashboard/subsidiary-questionnaires" /></>;

  const supabase = await createClient();
  let query = supabase.from("subsidiary_questionnaires").select("id, entity_id, status, group_review_status, prepared_by, submitted_at, approved_at, updated_at, entities(name, local_owner_user_id)").eq("organization_id", ctx.org.id).eq("reporting_period_id", period.id).order("updated_at", { ascending: false });
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.entity) query = query.eq("entity_id", searchParams.entity);
  const [{ data, error }, { data: entities }, members] = await Promise.all([
    query,
    supabase.from("entities").select("id, name, is_parent, local_owner_user_id").eq("organization_id", ctx.org.id).eq("in_scope", true).neq("status", "inactive").order("name"),
    internal ? loadMembers(supabase, ctx.org.id).catch(() => []) : Promise.resolve([]),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = data ?? [];
  const canCreate = can(ctx.role, "questionnaire.prepare");
  const existing = new Set((await supabase.from("subsidiary_questionnaires").select("entity_id").eq("organization_id", ctx.org.id).eq("reporting_period_id", period.id)).data?.map((r) => r.entity_id) ?? []);
  const available = (entities ?? []).filter((e) => !e.is_parent && !existing.has(e.id));
  const active = (["status", "entity"] as const).filter((k) => searchParams[k]);
  const here = withParams("/dashboard/subsidiary-questionnaires", { period: period.id, ...Object.fromEntries(active.map((k) => [k, searchParams[k]])) });

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/subsidiary-questionnaires" keep={Object.fromEntries(active.map((k) => [k, searchParams[k]]))} />
      {!internal && <p className="mb-4 text-xs text-mute">You are viewing approved questionnaires only. Drafts and questionnaires under review are not shared.</p>}

      {internal && (
        <form method="get" action="/dashboard/subsidiary-questionnaires" className="mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="period" value={period.id} />
          <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={searchParams.status ?? ""} className={inputClass}><option value="">All</option>{["draft", "prepared", "submitted", "returned", "approved", "reopened", "archived"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
          <div><label className={labelClass} htmlFor="entity">Entity</label><select id="entity" name="entity" defaultValue={searchParams.entity ?? ""} className={inputClass}><option value="">All</option>{(entities ?? []).filter((e) => !e.is_parent).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
          <button className={secondaryBtn} type="submit">Apply</button>
          {active.length > 0 && <a className={secondaryBtn} href={withParams("/dashboard/subsidiary-questionnaires", { period: period.id })}>Clear</a>}
        </form>
      )}

      {canCreate && (
        <section className={`${cardClass} mb-5`}>
          <h2 className="mb-1 text-sm font-semibold text-paper">Start a questionnaire for {period.label}</h2>
          <p className="mb-3 text-xs text-mute">Internal auditors, admins and owners can prepare any entity&apos;s questionnaire. A controller or CFO can prepare it only for entities where they are the assigned local owner.</p>
          {available.length === 0 ? <p className="text-sm text-mute">Every in-scope subsidiary already has a questionnaire for this period.</p> : (
            <form action={createQuestionnaireAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="return_to" value={here} /><input type="hidden" name="reporting_period_id" value={period.id} />
              <div><label className={labelClass} htmlFor="entity_id">Entity</label><select id="entity_id" name="entity_id" required className={`${inputClass} min-w-[14rem]`}><option value="">Choose…</option>{available.map((e) => <option key={e.id} value={e.id}>{e.name}{e.local_owner_user_id === ctx.userId ? " (you are local owner)" : ""}</option>)}</select></div>
              <button className={primaryBtn} type="submit">Create with standard questions</button>
            </form>
          )}
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No questionnaires match these filters" : `No questionnaires for ${period.label}`} description={active.length ? "Clear the filters to see all questionnaires." : internal ? "Start one above for each in-scope subsidiary." : "No approved questionnaires have been shared for this period."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Entity</Th><Th>Status</Th><Th>Group review</Th><Th>Prepared by</Th><Th>Submitted</Th><Th>Approved</Th></tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((r) => {
              const ent = one(r.entities as { name: string } | { name: string }[] | null);
              return (
                <tr key={r.id} className="align-top hover:bg-panel/50">
                  <td className="px-3 py-2"><Link className="text-signal hover:underline" href={withParams(`/dashboard/subsidiary-questionnaires/${r.id}`, { period: period.id })}>{ent?.name ?? "Entity"}</Link></td>
                  <td className="px-3 py-2"><StatusBadge value={r.status} /></td>
                  <td className="px-3 py-2 text-mute">{OUTCOME_LABELS[r.group_review_status] ?? label(r.group_review_status)}</td>
                  <td className="px-3 py-2 text-mute">{internal ? memberName(members, r.prepared_by) : "—"}</td>
                  <td className="px-3 py-2 text-mute">{fmtDate(r.submitted_at)}</td>
                  <td className="px-3 py-2 text-mute">{fmtDate(r.approved_at)}</td>
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
