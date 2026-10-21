import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { EXCEPTION_TRANSITIONS } from "@/lib/phase2/workflow";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, cardClass, fmtDate, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { addCommentAction, addFollowUpAction, assignExceptionAction, referToDeficiencyAction, saveInvestigationNotesAction, transitionExceptionAction } from "@/lib/actions/ccm";

type SP = { period?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function ExceptionDetailPage({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  if (!can(ctx.role, "ccm.view_internal")) return <PermissionDenied message="Individual CCM exceptions are internal workpapers." />;

  const supabase = await createClient();
  const { data: exc, error } = await supabase
    .from("ccm_exceptions")
    .select("*, ccm_rules(rule_code, name), controls(code, title), reporting_periods(label)")
    .eq("id", params.id)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (error) return <ErrorState message={error.message} />;
  if (!exc) notFound();

  const [members, { data: steps }, { data: defs }, { data: fus }, { data: comments }, { data: log }, batch] = await Promise.all([
    loadMembers(supabase, ctx.org.id).catch(() => []),
    supabase.from("test_steps").select("id, step_number, description, status, test_plans(name)").eq("organization_id", ctx.org.id).eq("status", "exception").order("created_at", { ascending: false }).limit(200),
    supabase.from("deficiencies").select("id, title, severity, status").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("follow_ups").select("id, description, owner_user_id, due_date, status, escalation_status").eq("organization_id", ctx.org.id).eq("ccm_exception_id", exc.id).order("due_date"),
    supabase.from("workpaper_comments").select("id, body, visibility, author_id, created_at").eq("organization_id", ctx.org.id).eq("target_type", "ccm_exception").eq("target_id", exc.id).order("created_at", { ascending: false }),
    supabase.from("audit_log").select("id, action, actor_id, metadata, created_at").eq("organization_id", ctx.org.id).eq("entity_type", "ccm_exceptions").eq("entity_id", exc.id).order("created_at", { ascending: false }).limit(50),
    exc.import_batch_id
      ? supabase.from("ccm_import_batches").select("source_system, file_name, imported_at, imported_by, validation_status").eq("id", exc.import_batch_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const rule = one(exc.ccm_rules as { rule_code: string; name: string } | { rule_code: string; name: string }[] | null);
  const ctl = one(exc.controls as { code: string; title: string } | { code: string; title: string }[] | null);
  const per = one(exc.reporting_periods as { label: string } | { label: string }[] | null);
  const canWrite = can(ctx.role, "ccm.exception.write");
  const next = EXCEPTION_TRANSITIONS[exc.status] ?? [];
  const here = withParams(`/dashboard/ccm/exceptions/${exc.id}`, { period: searchParams.period });
  const linkedDef = (defs ?? []).find((d) => d.id === exc.linked_deficiency_id);
  const linkedStep = (steps ?? []).find((s) => s.id === exc.linked_exception_id);

  const hidden = (to?: string) => (
    <>
      <input type="hidden" name="return_to" value={here} />
      <input type="hidden" name="id" value={exc.id} />
      <input type="hidden" name="from" value={exc.status} />
      {to && <input type="hidden" name="to" value={to} />}
    </>
  );

  return (
    <div>
      <Link href={withParams("/dashboard/ccm/exceptions", { period: searchParams.period })} className="mb-3 inline-block text-xs text-mute hover:text-paper">← All exceptions</Link>
      <PageHeader eyebrow={`CCM exception · ${per?.label ?? "No period"}`} title={exc.source_record_ref ?? exc.exception_ref ?? "Exception"} subtitle={exc.description ?? undefined} />
      <Banner notice={searchParams.notice} error={searchParams.error} />

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <section className={cardClass}>
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div><dt className="text-xs text-mute">Status</dt><dd className="mt-1"><StatusBadge value={exc.status} /></dd></div>
              <div><dt className="text-xs text-mute">Severity</dt><dd className="mt-1"><StatusBadge value={exc.severity} /></dd></div>
              <div><dt className="text-xs text-mute">Detected</dt><dd className="mt-1 text-paper">{fmtDateTime(exc.detected_at)}</dd></div>
              <div><dt className="text-xs text-mute">Rule</dt><dd className="mt-1 text-paper">{rule ? `${rule.rule_code} — ${rule.name}` : "—"}</dd></div>
              <div><dt className="text-xs text-mute">Control</dt><dd className="mt-1 text-paper">{ctl ? `${ctl.code} — ${ctl.title}` : "—"}</dd></div>
              <div><dt className="text-xs text-mute">Amount</dt><dd className="mt-1 text-paper">{exc.amount ?? "—"}</dd></div>
              <div><dt className="text-xs text-mute">Owner</dt><dd className="mt-1 text-paper">{memberName(members, exc.assigned_to)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-mute">Origin</dt>
                <dd className="mt-1 text-paper">
                  {exc.source_type === "csv_import" && batch.data
                    ? `CSV import · ${batch.data.source_system} · ${batch.data.file_name ?? "file"} · imported ${fmtDate(batch.data.imported_at)} by ${memberName(members, batch.data.imported_by)} · validation: ${label(batch.data.validation_status)}`
                    : "Manual entry"}
                </dd></div>
            </dl>
            {exc.investigation_notes && <div className="mt-4"><p className="text-xs text-mute">Investigation notes</p><p className="mt-1 whitespace-pre-wrap text-sm text-paper">{exc.investigation_notes}</p></div>}
            {exc.false_positive_reason && <div className="mt-4"><p className="text-xs text-mute">False-positive rationale</p><p className="mt-1 whitespace-pre-wrap text-sm text-paper">{exc.false_positive_reason}</p></div>}
            {(linkedDef || linkedStep) && (
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                {linkedDef && <Link className="text-signal hover:underline" href={`/dashboard/deficiencies/${linkedDef.id}`}>Deficiency: {linkedDef.title}</Link>}
                {linkedStep && <span className="text-paper">Formal test exception: step {linkedStep.step_number} ({one(linkedStep.test_plans as { name: string } | { name: string }[] | null)?.name ?? "test plan"})</span>}
              </div>
            )}
          </section>

          {canWrite && next.length > 0 && (
            <section className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-paper">Workflow</h2>
              <div className="space-y-5">
                <form action={assignExceptionAction} className="flex items-end gap-3">
                    <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={exc.id} />
                    <div className="flex-1"><label className={labelClass} htmlFor="assigned_to">Assign / reassign owner</label>
                      <select id="assigned_to" name="assigned_to" defaultValue={exc.assigned_to ?? ""} className={inputClass}><option value="">Choose…</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)} ({label(m.role)})</option>)}</select></div>
                    <button className={secondaryBtn} type="submit">Assign</button>
                </form>

                {next.includes("in_investigation") && (
                  <form action={transitionExceptionAction} className="space-y-2">
                    {hidden("in_investigation")}
                    <label className={labelClass} htmlFor="inv_notes">{exc.status === "closed" ? "Reopen — reason" : "Start investigation — initial notes (optional)"}</label>
                    <textarea id="inv_notes" name="investigation_notes" rows={2} className={inputClass} />
                    <button className={primaryBtn} type="submit" disabled={!exc.assigned_to} title={exc.assigned_to ? "" : "Assign an owner first"}>{exc.status === "closed" ? "Reopen investigation" : "Start investigation"}</button>
                    {!exc.assigned_to && <p className="text-xs text-amber-300">Assign an owner before investigating.</p>}
                  </form>
                )}

                {exc.status === "in_investigation" && (
                  <form action={saveInvestigationNotesAction} className="space-y-2">
                    <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={exc.id} />
                    <label className={labelClass} htmlFor="upd_notes">Investigation notes</label>
                    <textarea id="upd_notes" name="investigation_notes" required rows={3} defaultValue={exc.investigation_notes ?? ""} className={inputClass} />
                    <button className={secondaryBtn} type="submit">Save notes</button>
                  </form>
                )}

                {next.includes("false_positive") && (
                  <form action={transitionExceptionAction} className="space-y-2 border-t border-line pt-4">
                    {hidden("false_positive")}
                    <label className={labelClass} htmlFor="fp">Mark as false positive — rationale (mandatory, min. 10 characters)</label>
                    <textarea id="fp" name="false_positive_reason" required minLength={10} rows={2} className={inputClass} />
                    <button className={secondaryBtn} type="submit">Mark false positive</button>
                  </form>
                )}

                {next.includes("linked") && (
                  <>
                    <form action={transitionExceptionAction} className="space-y-2 border-t border-line pt-4">
                      {hidden("linked")}
                      <p className="text-xs font-medium text-mute">Link to existing records</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className={labelClass} htmlFor="linked_exception_id">Formal test exception (test step with status “exception”)</label>
                          <select id="linked_exception_id" name="linked_exception_id" className={inputClass}><option value="">None</option>{(steps ?? []).map((s) => <option key={s.id} value={s.id}>{one(s.test_plans as { name: string } | { name: string }[] | null)?.name ?? "Plan"} · step {s.step_number} · {s.status}</option>)}</select></div>
                        <div><label className={labelClass} htmlFor="linked_deficiency_id">Deficiency</label>
                          <select id="linked_deficiency_id" name="linked_deficiency_id" className={inputClass}><option value="">None</option>{(defs ?? []).map((d) => <option key={d.id} value={d.id}>{d.title} ({d.status})</option>)}</select></div>
                      </div>
                      <button className={secondaryBtn} type="submit">Link</button>
                    </form>
                    <form action={referToDeficiencyAction} className="space-y-2 border-t border-line pt-4">
                      <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={exc.id} />
                      <p className="text-xs font-medium text-mute">…or refer as a new deficiency</p>
                      <input name="title" required placeholder="Deficiency title" className={inputClass} />
                      <button className={secondaryBtn} type="submit">Create deficiency referral and link</button>
                    </form>
                  </>
                )}

                {next.includes("closed") && (
                  <form action={transitionExceptionAction} className="border-t border-line pt-4">
                    {hidden("closed")}
                    <button className={secondaryBtn} type="submit">Close exception</button>
                  </form>
                )}
              </div>
            </section>
          )}

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Follow-up actions</h2>
            {(fus ?? []).length === 0 ? <p className="text-sm text-mute">No follow-ups yet.</p> : (
              <ul className="mb-4 divide-y divide-line text-sm">
                {(fus ?? []).map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-4 py-2">
                    <div><p className="text-paper">{f.description}</p><p className="text-xs text-mute">{memberName(members, f.owner_user_id)} · due {fmtDate(f.due_date)}</p></div>
                    <div className="flex gap-2"><StatusBadge value={f.status} />{f.escalation_status !== "none" && <StatusBadge value={f.escalation_status} />}</div>
                  </li>
                ))}
              </ul>
            )}
            {can(ctx.role, "ccm.followup.write") && (
              <form action={addFollowUpAction} className="grid grid-cols-3 gap-3 border-t border-line pt-4">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="ccm_exception_id" value={exc.id} />
                {exc.linked_deficiency_id && <input type="hidden" name="deficiency_id" value={exc.linked_deficiency_id} />}
                <div className="col-span-3"><label className={labelClass} htmlFor="f_desc">Action *</label><input id="f_desc" name="description" required className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="f_owner">Owner *</label><select id="f_owner" name="owner_user_id" required className={inputClass}><option value="">Choose…</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="f_due">Due date *</label><input id="f_due" name="due_date" type="date" required className={inputClass} /></div>
                <div className="flex items-end"><button className={primaryBtn} type="submit">Add follow-up</button></div>
              </form>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Notes</h2>
            {(comments ?? []).length === 0 ? <p className="text-sm text-mute">No notes yet.</p> : (
              <ul className="mb-4 space-y-3">
                {(comments ?? []).map((c) => (
                  <li key={c.id} className="rounded-md border border-line bg-panel p-3 text-sm">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-mute"><span>{memberName(members, c.author_id)} · {fmtDateTime(c.created_at)}</span>
                      <span className={c.visibility === "internal" ? "text-amber-300" : "text-emerald-300"}>{c.visibility === "internal" ? "Internal only" : "Shareable"}</span></div>
                    <p className="whitespace-pre-wrap text-paper">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
            {can(ctx.role, "comment.internal") && (
              <form action={addCommentAction} className="space-y-2">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="target_type" value="ccm_exception" /><input type="hidden" name="target_id" value={exc.id} />
                <textarea name="body" required rows={3} placeholder="Add a note" className={inputClass} aria-label="Note" />
                <select name="visibility" defaultValue="internal" className={inputClass} aria-label="Visibility">
                  <option value="internal">Internal only (never shown to external auditors)</option>
                  <option value="shareable">Shareable with external auditors</option>
                </select>
                <button className={secondaryBtn} type="submit">Add note</button>
              </form>
            )}
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Activity</h2>
            {(log ?? []).length === 0 ? <p className="text-sm text-mute">No activity recorded.</p> : (
              <ol className="space-y-3 border-l border-line pl-4">
                {(log ?? []).map((l) => {
                  const m = (l.metadata ?? {}) as { from?: string; to?: string; changed_fields?: string[] };
                  return (
                    <li key={l.id} className="text-xs">
                      <p className="text-paper">{l.action === "status_changed" ? `Status: ${label(m.from)} → ${label(m.to)}` : label(l.action)}{l.action === "updated" && m.changed_fields ? ` (${m.changed_fields.join(", ")})` : ""}</p>
                      <p className="text-mute">{memberName(members, l.actor_id)} · {fmtDateTime(l.created_at)}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <LastUpdated at={exc.updated_at} />
        </div>
      </div>
    </div>
  );
}
