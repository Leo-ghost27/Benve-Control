import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { CRITICALITY, RELEVANCE } from "@/lib/phase2/itgc";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, TableShell, Th, cardClass, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { saveSystemAction } from "@/lib/actions/itgc";

type SP = { q?: string; relevance?: string; scope?: string; notice?: string; error?: string };

export default async function SystemsPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="ITGC & automated-control assurance" title="Systems inventory" subtitle={p2?.ctx.org.name} />;
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  if (!can(ctx.role, "itgc.view_internal")) return <>{header}<PermissionDenied /></>;

  const supabase = await createClient();
  let query = supabase.from("itgc_systems").select("*").eq("organization_id", ctx.org.id).order("name");
  if (searchParams.relevance) query = query.eq("financial_reporting_relevance", searchParams.relevance);
  if (searchParams.scope === "in") query = query.eq("in_scope", true);
  if (searchParams.scope === "out") query = query.eq("in_scope", false);
  if (searchParams.q) { const s = searchParams.q.replace(/[%,()]/g, " "); query = query.or(`name.ilike.%${s}%,system_type.ilike.%${s}%`); }
  const [{ data, error }, members, { data: counts }] = await Promise.all([
    query,
    loadMembers(supabase, ctx.org.id).catch(() => []),
    supabase.from("itgc_controls").select("system_id").eq("organization_id", ctx.org.id),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = data ?? [];
  const n = new Map<string, number>();
  (counts ?? []).forEach((c) => c.system_id && n.set(c.system_id, (n.get(c.system_id) ?? 0) + 1));
  const canManage = can(ctx.role, "itgc.manage");
  const active = (["q", "relevance", "scope"] as const).filter((k) => searchParams[k]);
  const here = withParams("/dashboard/itgc/systems", Object.fromEntries(active.map((k) => [k, searchParams[k]])));

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <form method="get" action="/dashboard/itgc/systems" className="mb-4 flex flex-wrap items-end gap-3">
        <div><label className={labelClass} htmlFor="q">Search</label><input id="q" name="q" defaultValue={searchParams.q} className={`${inputClass} w-52`} placeholder="Name or type" /></div>
        <div><label className={labelClass} htmlFor="relevance">Relevance</label><select id="relevance" name="relevance" defaultValue={searchParams.relevance ?? ""} className={inputClass}><option value="">All</option>{RELEVANCE.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="scope">Scope</label><select id="scope" name="scope" defaultValue={searchParams.scope ?? ""} className={inputClass}><option value="">All</option><option value="in">In scope</option><option value="out">Out of scope</option></select></div>
        <button className={secondaryBtn} type="submit">Apply</button>
        {active.length > 0 && <Link className={secondaryBtn} href="/dashboard/itgc/systems">Clear</Link>}
        <a className={`${secondaryBtn} ml-auto`} href="/dashboard/itgc/export?kind=systems">Export (CSV)</a>
      </form>

      {canManage && (
        <details className={`${cardClass} mb-5`}>
          <summary className="cursor-pointer text-sm font-semibold text-paper">Add a system</summary>
          <form action={saveSystemAction} className="mt-4 grid grid-cols-3 gap-3">
            <input type="hidden" name="return_to" value={here} />
            <div><label className={labelClass} htmlFor="s_name">Name *</label><input id="s_name" name="name" required className={inputClass} placeholder="e.g. NetSuite ERP" /></div>
            <div><label className={labelClass} htmlFor="s_type">System type</label><input id="s_type" name="system_type" className={inputClass} placeholder="e.g. ERP, payroll, data warehouse" /></div>
            <div><label className={labelClass} htmlFor="s_own">System owner</label><select id="s_own" name="system_owner_user_id" className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="s_rel">Financial-reporting relevance</label><select id="s_rel" name="financial_reporting_relevance" className={inputClass}><option value="">—</option>{RELEVANCE.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="s_crit">Criticality</label><select id="s_crit" name="criticality" className={inputClass}><option value="">—</option>{CRITICALITY.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></div>
            <label className="flex items-center gap-2 pt-6 text-sm text-paper"><input type="checkbox" name="in_scope" defaultChecked /> In scope for ICFR</label>
            <div className="col-span-3"><label className={labelClass} htmlFor="s_desc">Description</label><input id="s_desc" name="description" className={inputClass} /></div>
            <div className="col-span-3"><button className={primaryBtn} type="submit">Add system</button></div>
          </form>
        </details>
      )}

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No systems match these filters" : "No systems recorded yet"} description={active.length ? "Clear the filters to see all systems." : canManage ? "Add the systems that support financial reporting." : "An owner, admin, CFO, controller or internal auditor can add systems."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>System</Th><Th>Type</Th><Th>Relevance</Th><Th>Criticality</Th><Th>Owner</Th><Th>ITGCs</Th><Th>In scope</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((s) => (
              <tr key={s.id} className="align-top hover:bg-panel/50">
                <td className="px-3 py-2"><Link href={`/dashboard/itgc/systems/${s.id}`} className="text-signal hover:underline">{s.name}</Link></td>
                <td className="px-3 py-2 text-mute">{s.system_type ?? "—"}</td>
                <td className="px-3 py-2"><StatusBadge value={s.financial_reporting_relevance} /></td>
                <td className="px-3 py-2"><StatusBadge value={s.criticality} /></td>
                <td className="px-3 py-2 text-mute">{memberName(members, s.system_owner_user_id)}</td>
                <td className="px-3 py-2 tabular-nums">{n.get(s.id) ?? 0}</td>
                <td className="px-3 py-2 text-mute">{s.in_scope ? "Yes" : "No"}</td>
                <td className="px-3 py-2"><StatusBadge value={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <div className="mt-3"><LastUpdated at={rows.map((r) => r.updated_at as string).filter(Boolean).sort().pop()} /></div>
    </>
  );
}
