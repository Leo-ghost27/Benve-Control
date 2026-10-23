import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { saveEntityAction } from "@/lib/actions/group";

type SP = { period?: string; q?: string; status?: string; scope?: string; notice?: string; error?: string };

export default async function EntitiesPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="Multi-entity / group ICFR" title="Entities" subtitle={p2?.ctx.org.name} />;
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx, periods, period } = p2;
  if (!can(ctx.role, "group.view_internal")) return <>{header}<PermissionDenied message="The entity structure is an internal workpaper. External auditors and viewers see approved group summaries on the Group ICFR tab." /></>;

  const supabase = await createClient();
  let query = supabase.from("entities").select("*").eq("organization_id", ctx.org.id).order("is_parent", { ascending: false }).order("name");
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.scope === "in") query = query.eq("in_scope", true);
  if (searchParams.scope === "out") query = query.eq("in_scope", false);
  if (searchParams.q) { const s = searchParams.q.replace(/[%,()]/g, " "); query = query.or(`name.ilike.%${s}%,legal_name.ilike.%${s}%,jurisdiction.ilike.%${s}%`); }
  const [{ data: entities, error }, members, { data: all }, { data: qs }] = await Promise.all([
    query,
    loadMembers(supabase, ctx.org.id).catch(() => []),
    supabase.from("entities").select("id, name, is_parent, parent_entity_id").eq("organization_id", ctx.org.id).order("name"),
    period ? supabase.from("subsidiary_questionnaires").select("id, entity_id, status, group_review_status").eq("organization_id", ctx.org.id).eq("reporting_period_id", period.id) : Promise.resolve({ data: [] }),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = entities ?? [];
  const nameById = new Map((all ?? []).map((e) => [e.id, e.name]));
  const qByEntity = new Map((qs ?? []).map((q) => [q.entity_id, q]));
  const canManage = can(ctx.role, "entity.manage");
  const active = (["q", "status", "scope"] as const).filter((k) => searchParams[k]);
  const here = withParams("/dashboard/entities", { period: period?.id, ...Object.fromEntries(active.map((k) => [k, searchParams[k]])) });
  const hasParent = (all ?? []).some((e) => e.is_parent);

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      {periods.length > 0 && <PeriodBar periods={periods} current={period} action="/dashboard/entities" keep={Object.fromEntries(active.map((k) => [k, searchParams[k]]))} />}

      <form method="get" action="/dashboard/entities" className="mb-4 flex flex-wrap items-end gap-3">
        {period && <input type="hidden" name="period" value={period.id} />}
        <div><label className={labelClass} htmlFor="q">Search</label><input id="q" name="q" defaultValue={searchParams.q} placeholder="Name, legal name, jurisdiction" className={`${inputClass} w-60`} /></div>
        <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={searchParams.status ?? ""} className={inputClass}><option value="">All</option>{["in_progress", "complete", "inactive"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="scope">Scope</label><select id="scope" name="scope" defaultValue={searchParams.scope ?? ""} className={inputClass}><option value="">All</option><option value="in">In scope</option><option value="out">Out of scope</option></select></div>
        <button className={secondaryBtn} type="submit">Apply</button>
        {active.length > 0 && <a className={secondaryBtn} href={withParams("/dashboard/entities", { period: period?.id })}>Clear</a>}
      </form>

      {canManage && (
        <details className={`${cardClass} mb-5`}>
          <summary className="cursor-pointer text-sm font-semibold text-paper">Create an entity</summary>
          <form action={saveEntityAction} className="mt-4 grid grid-cols-3 gap-3">
            <input type="hidden" name="return_to" value={here} />
            <div><label className={labelClass} htmlFor="n_name">Display name *</label><input id="n_name" name="name" required className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="n_legal">Legal name</label><input id="n_legal" name="legal_name" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="n_jur">Jurisdiction</label><input id="n_jur" name="jurisdiction" className={inputClass} placeholder="e.g. Ireland" /></div>
            <div><label className={labelClass} htmlFor="n_par">Parent entity</label><select id="n_par" name="parent_entity_id" className={inputClass}><option value="">None</option>{(all ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="n_cons">Consolidation method</label><select id="n_cons" name="consolidation_method" className={inputClass}><option value="">—</option>{["full", "proportional", "equity_method", "not_consolidated"].map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="n_own">Local entity owner</label><select id="n_own" name="local_owner_user_id" className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)} ({label(m.role)})</option>)}</select></div>
            <div className="col-span-3"><label className={labelClass} htmlFor="n_fs">Functional scope</label><input id="n_fs" name="functional_scope" className={inputClass} placeholder="e.g. Sales and distribution; shared finance services" /></div>
            <label className="flex items-center gap-2 text-sm text-paper"><input type="checkbox" name="in_scope" defaultChecked /> In scope for ICFR</label>
            {!hasParent && <label className="flex items-center gap-2 text-sm text-paper"><input type="checkbox" name="is_parent" /> This is the group parent</label>}
            <div className="col-span-3"><button className={primaryBtn} type="submit">Create entity</button></div>
          </form>
        </details>
      )}

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No entities match these filters" : "No entities yet"} description={active.length ? "Clear the filters to see all entities." : canManage ? "Create the group parent first, then each subsidiary." : "An owner, admin, CFO, controller or internal auditor can create entities."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Entity</Th><Th>Jurisdiction</Th><Th>Parent</Th><Th>Consolidation</Th><Th>Local owner</Th><Th>In scope</Th><Th>Status</Th>{period && <Th>Questionnaire ({period.label})</Th>}</tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((e) => {
              const q = qByEntity.get(e.id);
              return (
                <tr key={e.id} className="align-top hover:bg-panel/50">
                  <td className="px-3 py-2"><Link className="text-signal hover:underline" href={withParams(`/dashboard/entities/${e.id}`, { period: period?.id })}>{e.name}</Link>{e.is_parent && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-[10px] text-mute">Group parent</span>}{e.legal_name && <p className="text-xs text-mute">{e.legal_name}</p>}</td>
                  <td className="px-3 py-2 text-mute">{e.jurisdiction ?? "—"}</td>
                  <td className="px-3 py-2 text-mute">{e.parent_entity_id ? nameById.get(e.parent_entity_id) ?? "—" : "—"}</td>
                  <td className="px-3 py-2 text-mute">{label(e.consolidation_method)}</td>
                  <td className="px-3 py-2 text-mute">{memberName(members, e.local_owner_user_id)}</td>
                  <td className="px-3 py-2 text-mute">{e.in_scope ? "Yes" : "No"}</td>
                  <td className="px-3 py-2"><StatusBadge value={e.status} /></td>
                  {period && <td className="px-3 py-2">{e.is_parent ? <span className="text-xs text-mute">Not required</span> : q ? <Link href={withParams(`/dashboard/subsidiary-questionnaires/${q.id}`, { period: period.id })}><StatusBadge value={q.status} /></Link> : <span className="text-xs text-mute">None</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <div className="mt-3"><LastUpdated at={rows.map((r) => r.updated_at as string).filter(Boolean).sort().pop()} /></div>
    </>
  );
}
