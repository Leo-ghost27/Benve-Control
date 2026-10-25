import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { ASSERTIONS, FREQUENCIES } from "@/lib/phase2/itgc";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, cardClass, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { createItgcTestPlanAction, decideConfigurationAction, saveAutomatedControlAction, saveConfigurationAction, submitConfigurationAction } from "@/lib/actions/itgc";

type SP = { notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function AutomatedControlDetail({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  if (!can(ctx.role, "itgc.view_internal")) return <PermissionDenied message="Automated-control workpapers are internal. Approved configuration conclusions are on the Automated controls tab." />;

  const supabase = await createClient();
  const { data: a, error } = await supabase.from("automated_controls").select("*, itgc_systems(name), controls:linked_sox_control_id(code, title)").eq("id", params.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (error) return <ErrorState message={error.message} />;
  if (!a) notFound();

  const [members, { data: systems }, { data: fcs }, { data: itgcs }, { data: evidence }, { data: cfgs }, { data: excs }, planRes, { data: log }] = await Promise.all([
    loadMembers(supabase, ctx.org.id).catch(() => []),
    supabase.from("itgc_systems").select("id, name").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("controls").select("id, code, title").eq("organization_id", ctx.org.id).order("code"),
    supabase.from("itgc_controls").select("id, control_ref, category").eq("organization_id", ctx.org.id).order("control_ref"),
    supabase.from("evidence").select("id, file_name").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("automated_control_configurations").select("*").eq("organization_id", ctx.org.id).eq("automated_control_id", a.id).order("version", { ascending: false }),
    supabase.from("itgc_exceptions").select("id, status, description, deficiency_id, raised_at").eq("organization_id", ctx.org.id).eq("automated_control_id", a.id).order("raised_at", { ascending: false }),
    a.test_plan_id ? supabase.from("test_plans").select("id, name, status").eq("id", a.test_plan_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("audit_log").select("id, action, actor_id, metadata, created_at").eq("organization_id", ctx.org.id).eq("entity_type", "automated_controls").eq("entity_id", a.id).order("created_at", { ascending: false }).limit(30),
  ]);

  const canManage = can(ctx.role, "itgc.manage");
  const canPrepare = can(ctx.role, "itgc.config.prepare");
  const canReview = can(ctx.role, "itgc.config.review");
  const here = `/dashboard/itgc/automated-controls/${a.id}`;
  const sys = one(a.itgc_systems as { name: string } | { name: string }[] | null);
  const fc = one(a.controls as { code: string; title: string } | { code: string; title: string }[] | null);
  const open = (cfgs ?? []).find((c) => ["draft", "returned"].includes(c.status));
  const awaiting = (cfgs ?? []).find((c) => c.status === "submitted");
  const evName = (id: string | null) => (evidence ?? []).find((e) => e.id === id)?.file_name ?? (id ? "Linked evidence" : "none");

  return (
    <div>
      <Link href="/dashboard/itgc/automated-controls" className="mb-3 inline-block text-xs text-mute hover:text-paper">← All automated controls</Link>
      <PageHeader eyebrow={`Automated control · ${sys?.name ?? "no system"}`} title={a.control_ref ?? "Automated control"} subtitle={a.description ?? undefined} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <section className={cardClass}>
            <p className="mb-3 text-xs text-mute">Financial control: {fc ? <Link className="text-signal hover:underline" href={`/dashboard/controls/${a.linked_sox_control_id}`}>{fc.code} — {fc.title}</Link> : <span className="text-amber-300">not linked</span>}</p>
            {canManage ? (
              <form action={saveAutomatedControlAction} className="grid grid-cols-3 gap-3">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={a.id} />
                <div><label className={labelClass} htmlFor="control_ref">Control code *</label><input id="control_ref" name="control_ref" required defaultValue={a.control_ref ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="system_id">System</label><select id="system_id" name="system_id" defaultValue={a.system_id ?? ""} className={inputClass}><option value="">None</option>{(systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="linked_sox_control_id">Linked financial control</label><select id="linked_sox_control_id" name="linked_sox_control_id" defaultValue={a.linked_sox_control_id ?? ""} className={inputClass}><option value="">Not linked</option>{(fcs ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></div>
                <div className="col-span-3"><label className={labelClass} htmlFor="description">Description</label><input id="description" name="description" defaultValue={a.description ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="frequency">Frequency</label><select id="frequency" name="frequency" defaultValue={a.frequency ?? ""} className={inputClass}><option value="">—</option>{FREQUENCIES.map((f) => <option key={f} value={f}>{label(f)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="owner_user_id">Owner</label><select id="owner_user_id" name="owner_user_id" defaultValue={a.owner_user_id ?? ""} className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="depends_on_itgc_id">Depends on change ITGC</label><select id="depends_on_itgc_id" name="depends_on_itgc_id" defaultValue={a.depends_on_itgc_id ?? ""} className={inputClass}><option value="">—</option>{(itgcs ?? []).map((i) => <option key={i.id} value={i.id}>{i.control_ref} ({i.category})</option>)}</select></div>
                <div className="col-span-3"><label className={labelClass} htmlFor="change_dependency">Change dependency</label><input id="change_dependency" name="change_dependency" defaultValue={a.change_dependency ?? ""} className={inputClass} /></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="testing_approach">Testing approach</label><input id="testing_approach" name="testing_approach" defaultValue={a.testing_approach ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="financial_assertions">Assertions</label><select id="financial_assertions" name="financial_assertions" multiple size={4} defaultValue={a.financial_assertions ?? []} className={inputClass}>{ASSERTIONS.map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={a.status} className={inputClass}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                <div className="flex items-end"><button className={primaryBtn} type="submit">Save</button></div>
              </form>
            ) : (
              <dl className="grid grid-cols-3 gap-4 text-sm"><div><dt className="text-xs text-mute">Owner</dt><dd className="mt-1 text-paper">{memberName(members, a.owner_user_id)}</dd></div><div><dt className="text-xs text-mute">Frequency</dt><dd className="mt-1 text-paper">{label(a.frequency)}</dd></div><div><dt className="text-xs text-mute">Change dependency</dt><dd className="mt-1 text-paper">{a.change_dependency ?? "—"}</dd></div></dl>
            )}
          </section>

          <section className={cardClass}>
            <h2 className="mb-1 text-sm font-semibold text-paper">Configuration conclusions</h2>
            <p className="mb-4 text-xs text-mute">Each version records what was inspected, the evidence, and management&apos;s conclusion. Approval is bound to the exact version content; any change creates a new version that must be approved again. Nothing here is validated automatically.</p>

            {awaiting && (
              <div className="mb-4 rounded-md border border-sky-900/50 bg-sky-950/20 p-4">
                <p className="mb-2 text-sm font-medium text-paper">Version {awaiting.version} awaiting decision <StatusBadge value="submitted" /></p>
                <p className="text-sm text-paper">{awaiting.configuration_summary}</p>
                <p className="mt-1 text-xs text-mute">Evidence: {evName(awaiting.configuration_evidence_id)}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-mute">{awaiting.conclusion}</p>
                <p className="mt-2 font-mono text-[10px] text-mute">Version hash {awaiting.content_hash?.slice(0, 16)}… · submitted {fmtDateTime(awaiting.submitted_at)} by {memberName(members, awaiting.submitted_by)}</p>
                {canReview && awaiting.submitted_by !== ctx.userId ? (
                  <form action={decideConfigurationAction} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={awaiting.id} /><input type="hidden" name="expected_hash" value={awaiting.content_hash ?? ""} />
                    <input name="comment" placeholder="Comment (required to return)" aria-label="Comment" className={`${inputClass} w-72`} />
                    <button className={primaryBtn} name="decision" value="approved" type="submit">Approve this version</button>
                    <button className={secondaryBtn} name="decision" value="returned" type="submit">Return to preparer</button>
                  </form>
                ) : <p className="mt-3 text-xs text-mute">{awaiting.submitted_by === ctx.userId ? "You submitted this version; another controller or CFO must decide it." : "Awaiting a controller or CFO."}</p>}
              </div>
            )}

            {open ? (
              canPrepare ? (
                <form action={saveConfigurationAction} className="mb-4 space-y-3 rounded-md border border-line p-4">
                  <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={open.id} />
                  <p className="text-sm font-medium text-paper">Version {open.version} <StatusBadge value={open.status} /></p>
                  {open.decision_note && <p className="rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-300">Reviewer: {open.decision_note}</p>}
                  <div><label className={labelClass} htmlFor="cs">What was inspected (configuration summary)</label><textarea id="cs" name="configuration_summary" rows={3} defaultValue={open.configuration_summary ?? ""} className={inputClass} /></div>
                  <div><label className={labelClass} htmlFor="ce">Configuration evidence (required to submit)</label><select id="ce" name="configuration_evidence_id" defaultValue={open.configuration_evidence_id ?? ""} className={inputClass}><option value="">None</option>{(evidence ?? []).map((e) => <option key={e.id} value={e.id}>{e.file_name}</option>)}</select></div>
                  <div><label className={labelClass} htmlFor="cc">Conclusion (min. 20 characters)</label><textarea id="cc" name="conclusion" rows={3} defaultValue={open.conclusion ?? ""} className={inputClass} /></div>
                  <div className="flex gap-2"><button className={secondaryBtn} type="submit">Save draft</button></div>
                </form>
              ) : <p className="mb-4 text-sm text-mute">Version {open.version} is being prepared.</p>
            ) : !awaiting && canPrepare ? (
              <form action={saveConfigurationAction} className="mb-4 space-y-3 rounded-md border border-line p-4">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="automated_control_id" value={a.id} />
                <p className="text-sm font-medium text-paper">{(cfgs ?? []).length ? "Record a new version" : "Record the first configuration conclusion"}</p>
                <div><label className={labelClass} htmlFor="ncs">What was inspected</label><textarea id="ncs" name="configuration_summary" rows={3} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="nce">Configuration evidence</label><select id="nce" name="configuration_evidence_id" className={inputClass}><option value="">None</option>{(evidence ?? []).map((e) => <option key={e.id} value={e.id}>{e.file_name}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="ncc">Conclusion</label><textarea id="ncc" name="conclusion" rows={3} className={inputClass} /></div>
                <button className={primaryBtn} type="submit">Start draft</button>
              </form>
            ) : null}
            {open && canPrepare && (
              <form action={submitConfigurationAction} className="mb-4"><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={open.id} /><button className={primaryBtn} type="submit">Submit version {open.version} for review</button></form>
            )}

            {(cfgs ?? []).length === 0 ? <p className="text-sm text-mute">No configuration conclusions recorded.</p> : (
              <ul className="divide-y divide-line text-sm">{(cfgs ?? []).map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2"><div><p className="text-paper">Version {c.version} <span className="text-xs text-mute">· {c.decided_at ? `decided ${fmtDateTime(c.decided_at)} by ${memberName(members, c.decided_by)}` : `created ${fmtDateTime(c.created_at)}`}</span></p><p className="max-w-xl text-xs text-mute">{c.configuration_summary}</p></div><StatusBadge value={c.status} /></li>
              ))}</ul>
            )}
          </section>

          <section className={cardClass}>
            <div className="mb-3 flex items-center justify-between">
              <div><h2 className="text-sm font-semibold text-paper">Testing (existing testing engine)</h2><p className="text-xs text-mute">Perform and evidence steps on the standard test-plan page.</p></div>
              {planRes.data && <Link className={primaryBtn} href={`/dashboard/test-plans/${planRes.data.id}`}>Open test plan</Link>}
            </div>
            {planRes.data ? <p className="text-sm text-paper">{planRes.data.name} <StatusBadge value={planRes.data.status} /></p> : a.linked_sox_control_id ? (
              can(ctx.role, "itgc.test.create") ? <form action={createItgcTestPlanAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value="automated" /><button className={primaryBtn} type="submit">Create test plan with starter steps</button></form> : <p className="text-sm text-mute">No test plan yet.</p>
            ) : <p className="text-sm text-amber-300">Link this control to a financial control above before creating a test plan.</p>}
            <h3 className="mb-2 mt-5 text-xs font-medium text-mute">Exceptions routed for review</h3>
            {(excs ?? []).length === 0 ? <p className="text-sm text-mute">None.</p> : (
              <ul className="divide-y divide-line text-sm">{(excs ?? []).map((e) => <li key={e.id} className="flex justify-between gap-3 py-2"><span className="text-paper">{e.description ?? "Exception"}{e.deficiency_id && <> · <Link className="text-signal hover:underline" href={`/dashboard/deficiencies/${e.deficiency_id}`}>Deficiency</Link></>}</span><StatusBadge value={e.status} /></li>)}</ul>
            )}
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
          <LastUpdated at={a.updated_at} />
        </div>
      </div>
    </div>
  );
}
