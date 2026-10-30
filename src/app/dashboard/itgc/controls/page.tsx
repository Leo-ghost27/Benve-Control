import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { ASSERTIONS, CATEGORIES, CATEGORY_LABELS, FREQUENCIES } from "@/lib/phase2/itgc";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, TableShell, Th, cardClass, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { saveItgcControlAction } from "@/lib/actions/itgc";

type SP = { q?: string; category?: string; system?: string; tested?: string; mapped?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function ItgcControlsPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="ITGC & automated-control assurance" title="ITGC controls" subtitle={p2?.ctx.org.name} />;
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  if (!can(ctx.role, "itgc.view_internal")) return <>{header}<PermissionDenied /></>;

  const supabase = await createClient();
  let query = supabase.from("itgc_controls").select("id, control_ref, category, description, frequency, status, test_plan_id, control_id, owner_user_id, system_id, updated_at, itgc_systems(name), controls(code), test_plans(status)").eq("organization_id", ctx.org.id).order("control_ref");
  if (searchParams.category) query = query.eq("category", searchParams.category);
  if (searchParams.system) query = query.eq("system_id", searchParams.system);
  if (searchParams.tested === "yes") query = query.not("test_plan_id", "is", null);
  if (searchParams.tested === "no") query = query.is("test_plan_id", null);
  if (searchParams.mapped === "no") query = query.is("control_id", null);
  if (searchParams.q) { const s = searchParams.q.replace(/[%,()]/g, " "); query = query.or(`control_ref.ilike.%${s}%,description.ilike.%${s}%`); }
  const [{ data, error }, members, { data: systems }, { data: fcs }, { data: evidence }] = await Promise.all([
    query,
    loadMembers(supabase, ctx.org.id).catch(() => []),
    supabase.from("itgc_systems").select("id, name").eq("organization_id", ctx.org.id).neq("status", "inactive").order("name"),
    supabase.from("controls").select("id, code, title").eq("organization_id", ctx.org.id).order("code"),
    supabase.from("evidence").select("id, file_name").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = data ?? [];
  const canManage = can(ctx.role, "itgc.manage");
  const active = (["q", "category", "system", "tested", "mapped"] as const).filter((k) => searchParams[k]);
  const here = withParams("/dashboard/itgc/controls", Object.fromEntries(active.map((k) => [k, searchParams[k]])));

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <form method="get" action="/dashboard/itgc/controls" className="mb-4 flex flex-wrap items-end gap-3">
        <div><label className={labelClass} htmlFor="q">Search</label><input id="q" name="q" defaultValue={searchParams.q} className={`${inputClass} w-48`} placeholder="Reference or description" /></div>
        <div><label className={labelClass} htmlFor="category">Category</label><select id="category" name="category" defaultValue={searchParams.category ?? ""} className={inputClass}><option value="">All</option>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="system">System</label><select id="system" name="system" defaultValue={searchParams.system ?? ""} className={inputClass}><option value="">All</option>{(systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="tested">Tested</label><select id="tested" name="tested" defaultValue={searchParams.tested ?? ""} className={inputClass}><option value="">All</option><option value="yes">Has test plan</option><option value="no">No test plan</option></select></div>
        <label className="flex items-center gap-2 pb-2 text-sm text-paper"><input type="checkbox" name="mapped" value="no" defaultChecked={searchParams.mapped === "no"} /> Unmapped to a financial control</label>
        <button className={secondaryBtn} type="submit">Apply</button>
        {active.length > 0 && <Link className={secondaryBtn} href="/dashboard/itgc/controls">Clear</Link>}
        <a className={`${secondaryBtn} ml-auto`} href="/dashboard/itgc/export?kind=controls">Export (CSV)</a>
      </form>

      {canManage && (
        <details className={`${cardClass} mb-5`}>
          <summary className="cursor-pointer text-sm font-semibold text-paper">Add an ITGC</summary>
          <form action={saveItgcControlAction} className="mt-4 grid grid-cols-3 gap-3">
            <input type="hidden" name="return_to" value={here} />
            <div><label className={labelClass} htmlFor="c_ref">Reference *</label><input id="c_ref" name="control_ref" required placeholder="e.g. ITGC-AC-01" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="c_cat">Category *</label><select id="c_cat" name="category" required className={inputClass}><option value="">Choose…</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="c_sys">System</label><select id="c_sys" name="system_id" className={inputClass}><option value="">None</option>{(systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="col-span-3"><label className={labelClass} htmlFor="c_desc">Description</label><input id="c_desc" name="description" className={inputClass} /></div>
            <div className="col-span-3"><label className={labelClass} htmlFor="c_risk">Risk addressed</label><input id="c_risk" name="risk" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="c_fc">Mapped financial control</label><select id="c_fc" name="control_id" className={inputClass}><option value="">Not mapped yet</option>{(fcs ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="c_freq">Frequency</label><select id="c_freq" name="frequency" className={inputClass}><option value="">—</option>{FREQUENCIES.map((f) => <option key={f} value={f}>{label(f)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="c_own">Control owner</label><select id="c_own" name="owner_user_id" className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
            <div className="col-span-2"><label className={labelClass} htmlFor="c_ta">Test approach</label><input id="c_ta" name="test_approach" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="c_ss">Sample size</label><input id="c_ss" name="sample_size" type="number" min={0} className={inputClass} /></div>
            <div className="col-span-2"><label className={labelClass} htmlFor="c_as">Assertions supported</label><select id="c_as" name="assertions" multiple size={4} className={inputClass}>{ASSERTIONS.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="c_ev">Design evidence</label><select id="c_ev" name="evidence_id" className={inputClass}><option value="">None</option>{(evidence ?? []).map((e) => <option key={e.id} value={e.id}>{e.file_name}</option>)}</select></div>
            <div className="col-span-3"><button className={primaryBtn} type="submit">Add ITGC</button></div>
          </form>
        </details>
      )}

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No ITGCs match these filters" : "No ITGCs recorded yet"} description={active.length ? "Clear the filters to see all ITGCs." : canManage ? "Add access, change-management and operations controls for each in-scope system." : "An owner, admin, CFO, controller or internal auditor can add ITGCs."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Reference</Th><Th>System</Th><Th>Category</Th><Th>Financial control</Th><Th>Frequency</Th><Th>Owner</Th><Th>Testing</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((r) => {
              const sys = one(r.itgc_systems as { name: string } | { name: string }[] | null);
              const fc = one(r.controls as { code: string } | { code: string }[] | null);
              const tp = one(r.test_plans as { status: string } | { status: string }[] | null);
              return (
                <tr key={r.id} className="align-top hover:bg-panel/50">
                  <td className="px-3 py-2"><Link href={`/dashboard/itgc/controls/${r.id}`} className="text-signal hover:underline">{r.control_ref}</Link><p className="max-w-xs text-xs text-mute">{r.description}</p></td>
                  <td className="px-3 py-2 text-mute">{sys?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-mute">{label(r.category)}</td>
                  <td className="px-3 py-2">{fc?.code ?? <span className="text-xs text-amber-300">Not mapped</span>}</td>
                  <td className="px-3 py-2 text-mute">{label(r.frequency)}</td>
                  <td className="px-3 py-2 text-mute">{memberName(members, r.owner_user_id)}</td>
                  <td className="px-3 py-2">{r.test_plan_id ? <StatusBadge value={tp?.status ?? "not_started"} /> : <span className="text-xs text-amber-300">No test plan</span>}</td>
                  <td className="px-3 py-2"><StatusBadge value={r.status} /></td>
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
