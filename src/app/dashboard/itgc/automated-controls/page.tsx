import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { ASSERTIONS, FREQUENCIES } from "@/lib/phase2/itgc";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, TableShell, Th, cardClass, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { saveAutomatedControlAction } from "@/lib/actions/itgc";

type SP = { q?: string; system?: string; config?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function AutomatedControlsPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="ITGC & automated-control assurance" title="Automated application controls" subtitle={p2?.ctx.org.name} />;
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  const internal = can(ctx.role, "itgc.view_internal");
  if (!internal && !can(ctx.role, "itgc.view_approved")) return <>{header}<PermissionDenied /></>;

  const supabase = await createClient();

  // External auditors / viewers: approved configuration conclusions only (RLS enforces this too)
  if (!internal) {
    const { data, error } = await supabase.from("automated_control_configurations").select("id, version, configuration_summary, conclusion, decided_at, automated_control_id").eq("organization_id", ctx.org.id).eq("status", "approved").order("decided_at", { ascending: false });
    if (error) return <>{header}<ErrorState message={error.message} /></>;
    return (
      <>
        {header}
        <p className="mb-4 text-xs text-mute">You are viewing approved configuration conclusions only. Each was entered by a preparer and approved by a different authorised user; none is validated automatically.</p>
        {(data ?? []).length === 0 ? <EmptyState title="No approved configuration conclusions" description="Management hasn't approved any automated-control configuration conclusions yet." /> : (
          <div className="space-y-4">{(data ?? []).map((c) => (
            <section key={c.id} className={cardClass}><p className="text-xs text-mute">Version {c.version} · approved {c.decided_at?.slice(0, 10)}</p><p className="mt-2 text-sm text-paper">{c.configuration_summary}</p><p className="mt-2 whitespace-pre-wrap text-sm text-mute">{c.conclusion}</p></section>
          ))}</div>
        )}
      </>
    );
  }

  let query = supabase.from("automated_controls").select("id, control_ref, description, frequency, status, test_plan_id, linked_sox_control_id, system_id, owner_user_id, updated_at, itgc_systems(name), controls:linked_sox_control_id(code)").eq("organization_id", ctx.org.id).order("control_ref");
  if (searchParams.system) query = query.eq("system_id", searchParams.system);
  if (searchParams.q) { const s = searchParams.q.replace(/[%,()]/g, " "); query = query.or(`control_ref.ilike.%${s}%,description.ilike.%${s}%`); }
  const [{ data, error }, members, { data: systems }, { data: fcs }, { data: itgcs }, { data: cfgs }] = await Promise.all([
    query,
    loadMembers(supabase, ctx.org.id).catch(() => []),
    supabase.from("itgc_systems").select("id, name").eq("organization_id", ctx.org.id).neq("status", "inactive").order("name"),
    supabase.from("controls").select("id, code, title").eq("organization_id", ctx.org.id).order("code"),
    supabase.from("itgc_controls").select("id, control_ref, category").eq("organization_id", ctx.org.id).order("control_ref"),
    supabase.from("automated_control_configurations").select("automated_control_id, status").eq("organization_id", ctx.org.id),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const approved = new Set((cfgs ?? []).filter((c) => c.status === "approved").map((c) => c.automated_control_id));
  const pending = new Set((cfgs ?? []).filter((c) => c.status === "submitted").map((c) => c.automated_control_id));
  let rows = data ?? [];
  if (searchParams.config === "approved") rows = rows.filter((r) => approved.has(r.id));
  if (searchParams.config === "missing") rows = rows.filter((r) => !approved.has(r.id));
  const canManage = can(ctx.role, "itgc.manage");
  const active = (["q", "system", "config"] as const).filter((k) => searchParams[k]);
  const here = withParams("/dashboard/itgc/automated-controls", Object.fromEntries(active.map((k) => [k, searchParams[k]])));

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <p className="mb-4 rounded-md border border-line bg-panel px-4 py-2 text-xs text-mute">A configuration is never treated as validated automatically. Each conclusion is entered by a preparer, linked to evidence, and approved by a different controller or CFO against the exact version reviewed.</p>
      <form method="get" action="/dashboard/itgc/automated-controls" className="mb-4 flex flex-wrap items-end gap-3">
        <div><label className={labelClass} htmlFor="q">Search</label><input id="q" name="q" defaultValue={searchParams.q} className={`${inputClass} w-48`} /></div>
        <div><label className={labelClass} htmlFor="system">System</label><select id="system" name="system" defaultValue={searchParams.system ?? ""} className={inputClass}><option value="">All</option>{(systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="config">Configuration</label><select id="config" name="config" defaultValue={searchParams.config ?? ""} className={inputClass}><option value="">All</option><option value="approved">Approved conclusion</option><option value="missing">No approved conclusion</option></select></div>
        <button className={secondaryBtn} type="submit">Apply</button>
        {active.length > 0 && <Link className={secondaryBtn} href="/dashboard/itgc/automated-controls">Clear</Link>}
        <a className={`${secondaryBtn} ml-auto`} href="/dashboard/itgc/export?kind=controls">Export (CSV)</a>
      </form>

      {canManage && (
        <details className={`${cardClass} mb-5`}>
          <summary className="cursor-pointer text-sm font-semibold text-paper">Add an automated control</summary>
          <form action={saveAutomatedControlAction} className="mt-4 grid grid-cols-3 gap-3">
            <input type="hidden" name="return_to" value={here} />
            <div><label className={labelClass} htmlFor="a_ref">Control code *</label><input id="a_ref" name="control_ref" required placeholder="e.g. AUTO-3WAY" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="a_sys">System</label><select id="a_sys" name="system_id" className={inputClass}><option value="">None</option>{(systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="a_fc">Linked financial control</label><select id="a_fc" name="linked_sox_control_id" className={inputClass}><option value="">Not linked yet</option>{(fcs ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></div>
            <div className="col-span-3"><label className={labelClass} htmlFor="a_desc">Description</label><input id="a_desc" name="description" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="a_freq">Frequency</label><select id="a_freq" name="frequency" className={inputClass}><option value="">—</option>{FREQUENCIES.map((f) => <option key={f} value={f}>{label(f)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="a_own">Owner</label><select id="a_own" name="owner_user_id" className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="a_dep">Depends on change ITGC</label><select id="a_dep" name="depends_on_itgc_id" className={inputClass}><option value="">—</option>{(itgcs ?? []).map((i) => <option key={i.id} value={i.id}>{i.control_ref} ({i.category})</option>)}</select></div>
            <div className="col-span-3"><label className={labelClass} htmlFor="a_cd">Change dependency (how it relies on change management)</label><input id="a_cd" name="change_dependency" className={inputClass} /></div>
            <div className="col-span-2"><label className={labelClass} htmlFor="a_ta">Testing approach</label><input id="a_ta" name="testing_approach" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="a_as">Assertions</label><select id="a_as" name="financial_assertions" multiple size={4} className={inputClass}>{ASSERTIONS.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select></div>
            <div className="col-span-3"><button className={primaryBtn} type="submit">Add automated control</button></div>
          </form>
        </details>
      )}

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No automated controls match these filters" : "No automated controls yet"} description={active.length ? "Clear the filters to see all automated controls." : canManage ? "Add the application controls (matching, limits, validations) that financial controls rely on." : "An owner, admin, CFO, controller or internal auditor can add automated controls."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Code</Th><Th>System</Th><Th>Financial control</Th><Th>Frequency</Th><Th>Owner</Th><Th>Configuration conclusion</Th><Th>Testing</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((r) => {
              const sys = one(r.itgc_systems as { name: string } | { name: string }[] | null);
              const fc = one(r.controls as { code: string } | { code: string }[] | null);
              return (
                <tr key={r.id} className="align-top hover:bg-panel/50">
                  <td className="px-3 py-2"><Link href={`/dashboard/itgc/automated-controls/${r.id}`} className="text-signal hover:underline">{r.control_ref}</Link><p className="max-w-xs text-xs text-mute">{r.description}</p></td>
                  <td className="px-3 py-2 text-mute">{sys?.name ?? "—"}</td>
                  <td className="px-3 py-2">{fc?.code ?? <span className="text-xs text-amber-300">Not linked</span>}</td>
                  <td className="px-3 py-2 text-mute">{label(r.frequency)}</td>
                  <td className="px-3 py-2 text-mute">{memberName(members, r.owner_user_id)}</td>
                  <td className="px-3 py-2">{approved.has(r.id) ? <StatusBadge value="approved" /> : pending.has(r.id) ? <StatusBadge value="submitted" /> : <span className="text-xs text-amber-300">None approved</span>}</td>
                  <td className="px-3 py-2">{r.test_plan_id ? <span className="text-xs text-paper">Test plan</span> : <span className="text-xs text-amber-300">None</span>}</td>
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
