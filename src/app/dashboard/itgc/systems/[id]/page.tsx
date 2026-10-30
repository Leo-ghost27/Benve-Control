import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { CATEGORY_LABELS, CRITICALITY, DEPENDENCY_TYPES, RELEVANCE } from "@/lib/phase2/itgc";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, cardClass, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { addDependencyAction, removeDependencyAction, saveSystemAction } from "@/lib/actions/itgc";

type SP = { notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function SystemDetail({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  if (!can(ctx.role, "itgc.view_internal")) return <PermissionDenied />;

  const supabase = await createClient();
  const { data: sys, error } = await supabase.from("itgc_systems").select("*").eq("id", params.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (error) return <ErrorState message={error.message} />;
  if (!sys) notFound();

  const [members, { data: itgcs }, { data: autos }, { data: deps }, { data: controls }, { data: log }] = await Promise.all([
    loadMembers(supabase, ctx.org.id).catch(() => []),
    supabase.from("itgc_controls").select("id, control_ref, category, status, test_plan_id, control_id, controls(code)").eq("organization_id", ctx.org.id).eq("system_id", sys.id).order("category").order("control_ref"),
    supabase.from("automated_controls").select("id, control_ref, status, test_plan_id, linked_sox_control_id").eq("organization_id", ctx.org.id).eq("system_id", sys.id).order("control_ref"),
    supabase.from("control_system_dependencies").select("id, dependency_type, notes, control_id, controls(code, title)").eq("organization_id", ctx.org.id).eq("system_id", sys.id),
    supabase.from("controls").select("id, code, title").eq("organization_id", ctx.org.id).order("code"),
    supabase.from("audit_log").select("id, action, actor_id, metadata, created_at").eq("organization_id", ctx.org.id).eq("entity_type", "itgc_systems").eq("entity_id", sys.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const canManage = can(ctx.role, "itgc.manage");
  const here = `/dashboard/itgc/systems/${sys.id}`;
  const byCat = (c: string) => (itgcs ?? []).filter((i) => i.category === c);

  return (
    <div>
      <Link href="/dashboard/itgc/systems" className="mb-3 inline-block text-xs text-mute hover:text-paper">← All systems</Link>
      <PageHeader eyebrow={`System · ${sys.system_type ?? "type not set"}`} title={sys.name} subtitle={sys.description ?? undefined} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <section className={cardClass}>
            {canManage ? (
              <form action={saveSystemAction} className="grid grid-cols-2 gap-3">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={sys.id} />
                <div><label className={labelClass} htmlFor="name">Name *</label><input id="name" name="name" required defaultValue={sys.name} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="system_type">System type</label><input id="system_type" name="system_type" defaultValue={sys.system_type ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="system_owner_user_id">System owner</label><select id="system_owner_user_id" name="system_owner_user_id" defaultValue={sys.system_owner_user_id ?? ""} className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={sys.status} className={inputClass}>{["in_progress", "complete", "inactive"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="financial_reporting_relevance">Financial-reporting relevance</label><select id="financial_reporting_relevance" name="financial_reporting_relevance" defaultValue={sys.financial_reporting_relevance ?? ""} className={inputClass}><option value="">—</option>{RELEVANCE.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="criticality">Criticality</label><select id="criticality" name="criticality" defaultValue={sys.criticality ?? ""} className={inputClass}><option value="">—</option>{CRITICALITY.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="description">Description</label><input id="description" name="description" defaultValue={sys.description ?? ""} className={inputClass} /></div>
                <label className="flex items-center gap-2 text-sm text-paper"><input type="checkbox" name="in_scope" defaultChecked={sys.in_scope} /> In scope for ICFR</label>
                <div><button className={primaryBtn} type="submit">Save system</button></div>
              </form>
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-mute">Owner</dt><dd className="mt-1 text-paper">{memberName(members, sys.system_owner_user_id)}</dd></div>
                <div><dt className="text-xs text-mute">Relevance / criticality</dt><dd className="mt-1 text-paper">{label(sys.financial_reporting_relevance)} / {label(sys.criticality)}</dd></div>
              </dl>
            )}
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">ITGCs by category</h2>
            <div className="grid grid-cols-3 gap-4">
              {(["access", "change", "operations"] as const).map((c) => (
                <div key={c} className="rounded-md border border-line p-3">
                  <p className="mb-2 text-xs font-medium text-mute">{CATEGORY_LABELS[c]}</p>
                  {byCat(c).length === 0 ? <p className="text-sm text-amber-300">None recorded</p> : (
                    <ul className="space-y-1.5 text-sm">{byCat(c).map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2"><Link className="text-signal hover:underline" href={`/dashboard/itgc/controls/${i.id}`}>{i.control_ref}</Link><span className="text-[11px] text-mute">{i.test_plan_id ? "Test plan" : "Untested"}</span></li>
                    ))}</ul>
                  )}
                </div>
              ))}
            </div>
            <h3 className="mb-2 mt-5 text-xs font-medium text-mute">Automated controls on this system</h3>
            {(autos ?? []).length === 0 ? <p className="text-sm text-mute">None recorded.</p> : (
              <ul className="space-y-1.5 text-sm">{(autos ?? []).map((a) => <li key={a.id} className="flex items-center justify-between"><Link className="text-signal hover:underline" href={`/dashboard/itgc/automated-controls/${a.id}`}>{a.control_ref}</Link><StatusBadge value={a.status} /></li>)}</ul>
            )}
          </section>

          <section className={cardClass}>
            <h2 className="mb-1 text-sm font-semibold text-paper">Financial controls that rely on this system</h2>
            <p className="mb-3 text-xs text-mute">These dependencies show which controls are exposed if the system&apos;s ITGCs fail.</p>
            {(deps ?? []).length === 0 ? <p className="mb-3 text-sm text-mute">No dependencies recorded.</p> : (
              <ul className="mb-4 divide-y divide-line text-sm">{(deps ?? []).map((d) => {
                const c = one(d.controls as { code: string; title: string } | { code: string; title: string }[] | null);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <div><Link className="text-signal hover:underline" href={`/dashboard/controls/${d.control_id}`}>{c?.code} — {c?.title}</Link><p className="text-xs text-mute">{label(d.dependency_type)}{d.notes ? ` · ${d.notes}` : ""}</p></div>
                    {canManage && <form action={removeDependencyAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={d.id} /><button className={secondaryBtn} type="submit">Remove</button></form>}
                  </li>
                );
              })}</ul>
            )}
            {canManage && (
              <form action={addDependencyAction} className="grid grid-cols-4 items-end gap-3 border-t border-line pt-4">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="system_id" value={sys.id} />
                <div className="col-span-2"><label className={labelClass} htmlFor="dep_c">Financial control</label><select id="dep_c" name="control_id" required className={inputClass}><option value="">Choose…</option>{(controls ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="dep_t">Dependency</label><select id="dep_t" name="dependency_type" className={inputClass}>{DEPENDENCY_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
                <div><button className={secondaryBtn} type="submit">Add</button></div>
                <div className="col-span-4"><input name="notes" placeholder="Notes (optional)" aria-label="Notes" className={inputClass} /></div>
              </form>
            )}
          </section>
        </div>
        <div className="space-y-5">
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Activity</h2>
            {(log ?? []).length === 0 ? <p className="text-sm text-mute">No activity recorded.</p> : (
              <ol className="space-y-3 border-l border-line pl-4">{(log ?? []).map((l) => {
                const m = (l.metadata ?? {}) as { from?: string; to?: string; changed_fields?: string[] };
                return <li key={l.id} className="text-xs"><p className="text-paper">{l.action === "status_changed" ? `Status: ${label(m.from)} → ${label(m.to)}` : label(l.action)}{l.action === "updated" && m.changed_fields ? ` (${m.changed_fields.join(", ")})` : ""}</p><p className="text-mute">{memberName(members, l.actor_id)} · {fmtDateTime(l.created_at)}</p></li>;
              })}</ol>
            )}
          </section>
          <LastUpdated at={sys.updated_at} />
        </div>
      </div>
    </div>
  );
}
