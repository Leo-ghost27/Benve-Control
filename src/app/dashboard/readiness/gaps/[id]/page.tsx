import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { WORKFLOW_TRANSITIONS } from "@/lib/phase2/workflow";
import { EDITABLE_STATUSES } from "@/lib/phase2/readiness-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, cardClass, fmtDate, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { addRoadmapActionAction, saveGapAction, setRoadmapStatusAction, transitionGapAction } from "@/lib/actions/readiness";
import { addCommentAction, addFollowUpAction } from "@/lib/actions/ccm";

type SP = { period?: string; assessment?: string; notice?: string; error?: string };

export default async function GapDetail({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  const internal = can(ctx.role, "readiness.view_internal");
  if (!internal && !can(ctx.role, "readiness.view_approved")) return <PermissionDenied />;

  const supabase = await createClient();
  const { data: gap, error } = await supabase.from("readiness_gaps").select("*, readiness_areas(area_name)").eq("id", params.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (error) return <ErrorState message={error.message} />;
  if (!gap) notFound();

  const [members, { data: controls }, { data: defs }, { data: evidence }, { data: actions }, { data: fus }, { data: comments }, { data: log }] = await Promise.all([
    internal ? loadMembers(supabase, ctx.org.id).catch(() => []) : Promise.resolve([]),
    internal ? supabase.from("controls").select("id, code, title").eq("organization_id", ctx.org.id).order("code") : Promise.resolve({ data: [] }),
    internal ? supabase.from("deficiencies").select("id, title").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    internal ? supabase.from("evidence").select("id, file_name").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    supabase.from("readiness_roadmap_actions").select("id, action_ref, description, owner_user_id, target_date, status, priority").eq("organization_id", ctx.org.id).eq("gap_id", gap.id).order("target_date"),
    internal ? supabase.from("follow_ups").select("id, description, owner_user_id, due_date, status").eq("organization_id", ctx.org.id).eq("readiness_gap_id", gap.id).order("due_date") : Promise.resolve({ data: [] }),
    supabase.from("workpaper_comments").select("id, body, visibility, author_id, created_at").eq("organization_id", ctx.org.id).eq("target_type", "readiness_gap").eq("target_id", gap.id).order("created_at", { ascending: false }),
    internal ? supabase.from("audit_log").select("id, action, actor_id, metadata, created_at").eq("organization_id", ctx.org.id).eq("entity_type", "readiness_gaps").eq("entity_id", gap.id).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
  ]);

  const area = Array.isArray(gap.readiness_areas) ? gap.readiness_areas[0] : gap.readiness_areas;
  const canPrepare = can(ctx.role, "readiness.prepare");
  const canReview = can(ctx.role, "readiness.review");
  const editable = EDITABLE_STATUSES.includes(gap.status) && canPrepare;
  const next = WORKFLOW_TRANSITIONS[gap.status] ?? [];
  const here = withParams(`/dashboard/readiness/gaps/${gap.id}`, { period: searchParams.period, assessment: searchParams.assessment });
  const ctl = (controls ?? []).find((c) => c.id === gap.related_control_id);
  const def = (defs ?? []).find((d) => d.id === gap.related_deficiency_id);
  const ev = (evidence ?? []).find((e) => e.id === gap.evidence_id);

  return (
    <div>
      <Link href={withParams("/dashboard/readiness/gaps", { period: searchParams.period, assessment: searchParams.assessment })} className="mb-3 inline-block text-xs text-mute hover:text-paper">← All gaps</Link>
      <PageHeader eyebrow={`Readiness gap · ${area?.area_name ?? "No area"}`} title={gap.requirement ?? "Readiness gap"} subtitle={gap.description ?? undefined} />
      <Banner notice={searchParams.notice} error={searchParams.error} />

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <section className={cardClass}>
            <div className="mb-4 flex items-center gap-3"><StatusBadge value={gap.status} /><StatusBadge value={gap.gap_severity} /></div>
            {gap.review_note && gap.status !== "approved" && <p className="mb-3 rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-300">Reviewer note: {gap.review_note}</p>}
            {editable ? (
              <form action={saveGapAction} className="grid grid-cols-2 gap-3">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={gap.id} /><input type="hidden" name="area_id" value={gap.area_id ?? ""} />
                <div className="col-span-2"><label className={labelClass} htmlFor="requirement">Requirement</label><input id="requirement" name="requirement" defaultValue={gap.requirement ?? ""} className={inputClass} /></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="description">Description *</label><textarea id="description" name="description" rows={2} defaultValue={gap.description ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="gap_severity">Priority</label><select id="gap_severity" name="gap_severity" defaultValue={gap.gap_severity ?? ""} className={inputClass}><option value="">—</option>{["high", "medium", "low"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="target_date">Target date</label><input id="target_date" name="target_date" type="date" defaultValue={gap.target_date ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="owner_user_id">Owner</label><select id="owner_user_id" name="owner_user_id" defaultValue={gap.owner_user_id ?? ""} className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="evidence_id">Evidence</label><select id="evidence_id" name="evidence_id" defaultValue={gap.evidence_id ?? ""} className={inputClass}><option value="">None</option>{(evidence ?? []).map((e) => <option key={e.id} value={e.id}>{e.file_name}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="related_control_id">Related control</label><select id="related_control_id" name="related_control_id" defaultValue={gap.related_control_id ?? ""} className={inputClass}><option value="">None</option>{(controls ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="related_deficiency_id">Related deficiency</label><select id="related_deficiency_id" name="related_deficiency_id" defaultValue={gap.related_deficiency_id ?? ""} className={inputClass}><option value="">None</option>{(defs ?? []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="remediation_action">Remediation action (required to submit)</label><textarea id="remediation_action" name="remediation_action" rows={2} defaultValue={gap.remediation_action ?? ""} className={inputClass} /></div>
                <div><button className={primaryBtn} type="submit">Save gap</button></div>
              </form>
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-mute">Owner</dt><dd className="mt-1 text-paper">{internal ? memberName(members, gap.owner_user_id) : "—"}</dd></div>
                <div><dt className="text-xs text-mute">Target date</dt><dd className="mt-1 text-paper">{fmtDate(gap.target_date)}</dd></div>
                <div><dt className="text-xs text-mute">Related control</dt><dd className="mt-1 text-paper">{ctl ? `${ctl.code} — ${ctl.title}` : "—"}</dd></div>
                <div><dt className="text-xs text-mute">Related deficiency</dt><dd className="mt-1 text-paper">{def ? <Link className="text-signal hover:underline" href={`/dashboard/deficiencies/${def.id}`}>{def.title}</Link> : "—"}</dd></div>
                <div><dt className="text-xs text-mute">Evidence</dt><dd className="mt-1 text-paper">{ev ? ev.file_name : gap.evidence_id ? "Linked" : "—"}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-mute">Remediation action</dt><dd className="mt-1 whitespace-pre-wrap text-paper">{gap.remediation_action ?? "—"}</dd></div>
              </dl>
            )}
            {internal && (
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <span className="text-xs text-mute">Workflow:</span>
                {next.map((to) => {
                  const review = ["approved", "returned", "reopened"].includes(to);
                  if (review ? !canReview : !canPrepare) return null;
                  const needsNote = to === "returned" || to === "reopened";
                  return (
                    <form key={to} action={transitionGapAction} className="flex items-center gap-2">
                      <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={gap.id} /><input type="hidden" name="from" value={gap.status} /><input type="hidden" name="to" value={to} />
                      {needsNote && <input name="review_note" required minLength={5} placeholder="Review note (required)" className={`${inputClass} w-56`} />}
                      <button className={to === "approved" ? primaryBtn : secondaryBtn} type="submit">{to === "prepared" ? "Mark prepared" : to === "submitted" ? "Submit for review" : label(to)}</button>
                    </form>
                  );
                })}
              </div>
            )}
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Roadmap actions</h2>
            {(actions ?? []).length === 0 ? <p className="mb-3 text-sm text-mute">No roadmap actions yet.</p> : (
              <ul className="mb-4 divide-y divide-line text-sm">
                {(actions ?? []).map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-4 py-2">
                    <div><p className="text-paper">{a.action_ref ? `${a.action_ref} · ` : ""}{a.description}</p><p className="text-xs text-mute">{internal ? memberName(members, a.owner_user_id) : ""} · target {fmtDate(a.target_date)} · {label(a.priority)}</p></div>
                    <div className="flex items-center gap-2"><StatusBadge value={a.status} />
                      {canPrepare && a.status !== "complete" && <form action={setRoadmapStatusAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value={a.status === "not_started" ? "in_progress" : "complete"} /><button className={secondaryBtn} type="submit">{a.status === "not_started" ? "Start" : "Complete"}</button></form>}</div>
                  </li>
                ))}
              </ul>
            )}
            {canPrepare && (
              <form action={addRoadmapActionAction} className="grid grid-cols-4 gap-3 border-t border-line pt-4">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="gap_id" value={gap.id} />
                <div className="col-span-4"><label className={labelClass} htmlFor="ra_d">Action *</label><input id="ra_d" name="description" required className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="ra_o">Owner</label><select id="ra_o" name="owner_user_id" className={inputClass}><option value="">—</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="ra_t">Target date</label><input id="ra_t" name="target_date" type="date" className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="ra_p">Priority</label><select id="ra_p" name="priority" className={inputClass}><option value="">—</option>{["high", "medium", "low"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
                <div className="flex items-end"><button className={secondaryBtn} type="submit">Add action</button></div>
              </form>
            )}
          </section>

          {internal && (
            <section className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-paper">Follow-ups</h2>
              {(fus ?? []).length === 0 ? <p className="mb-3 text-sm text-mute">No follow-ups linked to this gap.</p> : (
                <ul className="mb-4 divide-y divide-line text-sm">{(fus ?? []).map((f) => <li key={f.id} className="flex justify-between gap-4 py-2"><div><p className="text-paper">{f.description}</p><p className="text-xs text-mute">{memberName(members, f.owner_user_id)} · due {fmtDate(f.due_date)}</p></div><StatusBadge value={f.status} /></li>)}</ul>
              )}
              {can(ctx.role, "ccm.followup.write") && (
                <form action={addFollowUpAction} className="grid grid-cols-3 gap-3 border-t border-line pt-4">
                  <input type="hidden" name="return_to" value={here} /><input type="hidden" name="readiness_gap_id" value={gap.id} />
                  <div className="col-span-3"><label className={labelClass} htmlFor="f_desc">Action *</label><input id="f_desc" name="description" required className={inputClass} /></div>
                  <div><label className={labelClass} htmlFor="f_owner">Owner *</label><select id="f_owner" name="owner_user_id" required className={inputClass}><option value="">Choose…</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
                  <div><label className={labelClass} htmlFor="f_due">Due date *</label><input id="f_due" name="due_date" type="date" required className={inputClass} /></div>
                  <div className="flex items-end"><button className={primaryBtn} type="submit">Add follow-up</button></div>
                </form>
              )}
            </section>
          )}
        </div>

        <div className="space-y-5">
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Notes</h2>
            {(comments ?? []).length === 0 ? <p className="text-sm text-mute">No notes yet.</p> : (
              <ul className="mb-4 space-y-3">{(comments ?? []).map((c) => (
                <li key={c.id} className="rounded-md border border-line bg-panel p-3 text-sm"><div className="mb-1 flex justify-between text-[11px] text-mute"><span>{internal ? memberName(members, c.author_id) : "Team"} · {fmtDateTime(c.created_at)}</span><span className={c.visibility === "internal" ? "text-amber-300" : "text-emerald-300"}>{c.visibility === "internal" ? "Internal only" : "Shareable"}</span></div><p className="whitespace-pre-wrap text-paper">{c.body}</p></li>
              ))}</ul>
            )}
            {(can(ctx.role, "comment.shareable")) && (
              <form action={addCommentAction} className="space-y-2">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="target_type" value="readiness_gap" /><input type="hidden" name="target_id" value={gap.id} />
                <textarea name="body" required rows={3} placeholder="Add a note" aria-label="Note" className={inputClass} />
                <select name="visibility" defaultValue={internal ? "internal" : "shareable"} aria-label="Visibility" className={inputClass}>
                  {internal && <option value="internal">Internal only (never shown to external auditors)</option>}
                  <option value="shareable">Shareable with external auditors</option>
                </select>
                <button className={secondaryBtn} type="submit">Add note</button>
              </form>
            )}
          </section>
          {internal && (
            <section className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-paper">Activity</h2>
              {(log ?? []).length === 0 ? <p className="text-sm text-mute">No activity recorded.</p> : (
                <ol className="space-y-3 border-l border-line pl-4">{(log ?? []).map((l) => {
                  const m = (l.metadata ?? {}) as { from?: string; to?: string; changed_fields?: string[] };
                  return <li key={l.id} className="text-xs"><p className="text-paper">{l.action === "status_changed" ? `Status: ${label(m.from)} → ${label(m.to)}` : label(l.action)}{l.action === "updated" && m.changed_fields ? ` (${m.changed_fields.join(", ")})` : ""}</p><p className="text-mute">{memberName(members, l.actor_id)} · {fmtDateTime(l.created_at)}</p></li>;
                })}</ol>
              )}
            </section>
          )}
          <LastUpdated at={gap.updated_at} />
        </div>
      </div>
    </div>
  );
}
