import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { ASSERTIONS, CATEGORIES, CATEGORY_LABELS, FREQUENCIES } from "@/lib/phase2/itgc";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, cardClass, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { createItgcTestPlanAction, saveItgcControlAction } from "@/lib/actions/itgc";

type SP = { notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function ItgcControlDetail({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  if (!can(ctx.role, "itgc.view_internal")) return <PermissionDenied />;

  const supabase = await createClient();
  const { data: c, error } = await supabase.from("itgc_controls").select("*, itgc_systems(name), controls(code, title)").eq("id", params.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (error) return <ErrorState message={error.message} />;
  if (!c) notFound();

  const [members, { data: systems }, { data: fcs }, { data: evidence }, planRes, stepsRes, { data: excs }, { data: log }] = await Promise.all([
    loadMembers(supabase, ctx.org.id).catch(() => []),
    supabase.from("itgc_systems").select("id, name").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("controls").select("id, code, title").eq("organization_id", ctx.org.id).order("code"),
    supabase.from("evidence").select("id, file_name").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(200),
    c.test_plan_id ? supabase.from("test_plans").select("id, name, status, test_type, sampling_approach, sample_size").eq("id", c.test_plan_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    c.test_plan_id ? supabase.from("test_steps").select("id, step_number, description, status, actual_result, evidence_reference, draft_conclusion").eq("test_plan_id", c.test_plan_id).order("step_number") : Promise.resolve({ data: [], error: null }),
    supabase.from("itgc_exceptions").select("id, status, description, deficiency_id, raised_at").eq("organization_id", ctx.org.id).eq("itgc_control_id", c.id).order("raised_at", { ascending: false }),
    supabase.from("audit_log").select("id, action, actor_id, metadata, created_at").eq("organization_id", ctx.org.id).eq("entity_type", "itgc_controls").eq("entity_id", c.id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (planRes.error || stepsRes.error) return <ErrorState message={(planRes.error ?? stepsRes.error)!.message} />;
  const steps = stepsRes.data ?? [];
  const stepIds = steps.map((s) => s.id);
  const { data: links } = stepIds.length
    ? await supabase.from("test_step_evidence").select("test_step_id, evidence(file_name)").in("test_step_id", stepIds)
    : { data: [] as { test_step_id: string; evidence: { file_name: string } | { file_name: string }[] | null }[] };
  const evByStep = new Map<string, string[]>();
  (links ?? []).forEach((l) => { const e = one(l.evidence as { file_name: string } | { file_name: string }[] | null); if (e) evByStep.set(l.test_step_id, [...(evByStep.get(l.test_step_id) ?? []), e.file_name]); });

  const canManage = can(ctx.role, "itgc.manage");
  const here = `/dashboard/itgc/controls/${c.id}`;
  const plan = planRes.data;
  const sys = one(c.itgc_systems as { name: string } | { name: string }[] | null);
  const fc = one(c.controls as { code: string; title: string } | { code: string; title: string }[] | null);
  const pass = steps.filter((s) => s.status === "pass").length;
  const exc = steps.filter((s) => s.status === "exception").length;

  return (
    <div>
      <Link href="/dashboard/itgc/controls" className="mb-3 inline-block text-xs text-mute hover:text-paper">← All ITGC controls</Link>
      <PageHeader eyebrow={`ITGC · ${label(c.category)} · ${sys?.name ?? "no system"}`} title={c.control_ref ?? "ITGC"} subtitle={c.description ?? undefined} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <section className={cardClass}>
            <div className="mb-3 flex items-center gap-3"><StatusBadge value={c.status} /><span className="text-xs text-mute">Financial control: {fc ? <Link className="text-signal hover:underline" href={`/dashboard/controls/${c.control_id}`}>{fc.code} — {fc.title}</Link> : <span className="text-amber-300">not mapped</span>}</span></div>
            {canManage ? (
              <form action={saveItgcControlAction} className="grid grid-cols-3 gap-3">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={c.id} />
                <div><label className={labelClass} htmlFor="control_ref">Reference *</label><input id="control_ref" name="control_ref" required defaultValue={c.control_ref ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="category">Category *</label><select id="category" name="category" required defaultValue={c.category ?? ""} className={inputClass}>{CATEGORIES.map((x) => <option key={x} value={x}>{CATEGORY_LABELS[x]}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="system_id">System</label><select id="system_id" name="system_id" defaultValue={c.system_id ?? ""} className={inputClass}><option value="">None</option>{(systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                <div className="col-span-3"><label className={labelClass} htmlFor="description">Description</label><input id="description" name="description" defaultValue={c.description ?? ""} className={inputClass} /></div>
                <div className="col-span-3"><label className={labelClass} htmlFor="risk">Risk addressed</label><input id="risk" name="risk" defaultValue={c.risk ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="control_id">Mapped financial control</label><select id="control_id" name="control_id" defaultValue={c.control_id ?? ""} className={inputClass}><option value="">Not mapped</option>{(fcs ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.title}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="frequency">Frequency</label><select id="frequency" name="frequency" defaultValue={c.frequency ?? ""} className={inputClass}><option value="">—</option>{FREQUENCIES.map((f) => <option key={f} value={f}>{label(f)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="owner_user_id">Owner</label><select id="owner_user_id" name="owner_user_id" defaultValue={c.owner_user_id ?? ""} className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="test_approach">Test approach</label><input id="test_approach" name="test_approach" defaultValue={c.test_approach ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="sample_size">Sample size</label><input id="sample_size" name="sample_size" type="number" min={0} defaultValue={c.sample_size ?? ""} className={inputClass} /></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="assertions">Assertions supported</label><select id="assertions" name="assertions" multiple size={4} defaultValue={c.assertions ?? []} className={inputClass}>{ASSERTIONS.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="evidence_id">Design evidence</label><select id="evidence_id" name="evidence_id" defaultValue={c.evidence_id ?? ""} className={inputClass}><option value="">None</option>{(evidence ?? []).map((e) => <option key={e.id} value={e.id}>{e.file_name}</option>)}</select></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={c.status} className={inputClass}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                <div className="flex items-end"><button className={primaryBtn} type="submit">Save ITGC</button></div>
              </form>
            ) : (
              <dl className="grid grid-cols-3 gap-4 text-sm"><div><dt className="text-xs text-mute">Owner</dt><dd className="mt-1 text-paper">{memberName(members, c.owner_user_id)}</dd></div><div><dt className="text-xs text-mute">Frequency</dt><dd className="mt-1 text-paper">{label(c.frequency)}</dd></div><div><dt className="text-xs text-mute">Assertions</dt><dd className="mt-1 text-paper">{(c.assertions ?? []).map(label).join(", ") || "—"}</dd></div></dl>
            )}
          </section>

          <section className={cardClass}>
            <div className="mb-3 flex items-center justify-between">
              <div><h2 className="text-sm font-semibold text-paper">Testing (existing testing engine)</h2><p className="text-xs text-mute">Steps, results, evidence and conclusions are recorded on the standard test-plan page, exactly as for any financial control.</p></div>
              {plan && <Link className={primaryBtn} href={`/dashboard/test-plans/${plan.id}`}>Open test plan</Link>}
            </div>
            {!plan ? (
              c.control_id ? (
                can(ctx.role, "itgc.test.create") ? (
                  <form action={createItgcTestPlanAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="kind" value="itgc" />
                    <div><label className={labelClass} htmlFor="tt">Test type</label><select id="tt" name="test_type" className={inputClass}><option value="test_of_effectiveness">Test of effectiveness</option><option value="test_of_design">Test of design</option></select></div>
                    <button className={primaryBtn} type="submit">Create test plan with starter steps</button>
                  </form>
                ) : <p className="text-sm text-mute">No test plan yet. Your role cannot create one.</p>
              ) : <p className="text-sm text-amber-300">Map this ITGC to a financial control above before creating a test plan; the testing engine plans tests per financial control.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-paper">{plan.name} <StatusBadge value={plan.status} /> <span className="ml-3 text-xs text-mute">{pass} passed · {exc} exception(s) · {steps.length - pass - exc} outstanding</span></p>
                <ol className="space-y-3 text-sm">
                  {steps.map((s) => (
                    <li key={s.id} className="rounded-md border border-line p-3">
                      <div className="flex items-start justify-between gap-3"><p className="text-paper">{s.step_number}. {s.description}</p><StatusBadge value={s.status} /></div>
                      {s.actual_result && <p className="mt-1 text-xs text-mute">Result: {s.actual_result}</p>}
                      <p className="mt-1 text-xs text-mute">Evidence: {[...(evByStep.get(s.id) ?? []), ...(s.evidence_reference ? [s.evidence_reference] : [])].join("; ") || "none attached"}</p>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Exceptions routed for review</h2>
            {(excs ?? []).length === 0 ? <p className="text-sm text-mute">No exceptions. A failed test step is routed here automatically.</p> : (
              <ul className="divide-y divide-line text-sm">{(excs ?? []).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-2"><div><p className="text-paper">{e.description ?? "Exception"}</p><p className="text-xs text-mute">Raised {fmtDateTime(e.raised_at)}{e.deficiency_id && <> · <Link className="text-signal hover:underline" href={`/dashboard/deficiencies/${e.deficiency_id}`}>Deficiency</Link></>}</p></div><StatusBadge value={e.status} /></li>
              ))}</ul>
            )}
            <Link href="/dashboard/itgc/exceptions" className={`${secondaryBtn} mt-3 inline-block`}>Open exception review</Link>
          </section>
        </div>
        <div className="space-y-5">
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Activity</h2>
            {(log ?? []).length === 0 ? <p className="text-sm text-mute">No activity recorded.</p> : (
              <ol className="space-y-3 border-l border-line pl-4">{(log ?? []).map((l) => {
                const m = (l.metadata ?? {}) as { changed_fields?: string[] };
                return <li key={l.id} className="text-xs"><p className="text-paper">{label(l.action)}{l.action === "updated" && m.changed_fields ? ` (${m.changed_fields.join(", ")})` : ""}</p><p className="text-mute">{memberName(members, l.actor_id)} · {fmtDateTime(l.created_at)}</p></li>;
              })}</ol>
            )}
          </section>
          <LastUpdated at={c.updated_at} />
        </div>
      </div>
    </div>
  );
}
