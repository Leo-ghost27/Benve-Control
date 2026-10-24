import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { WORKFLOW_TRANSITIONS } from "@/lib/phase2/workflow";
import { OUTCOME_LABELS } from "@/lib/phase2/questionnaire";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, cardClass, fmtDate, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { addQuestionAction, createQuestionnaireFollowUpAction, saveResponseAction, transitionQuestionnaireAction } from "@/lib/actions/group";
import { addCommentAction } from "@/lib/actions/ccm";

type SP = { period?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const EDITABLE = ["draft", "prepared", "returned", "reopened"];

export default async function QuestionnaireDetail({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  const internal = can(ctx.role, "group.view_internal");
  if (!internal && !can(ctx.role, "group.view_approved")) return <PermissionDenied />;

  const supabase = await createClient();
  const { data: q, error } = await supabase.from("subsidiary_questionnaires").select("*, entities(id, name, local_owner_user_id), reporting_periods(label)").eq("id", params.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (error) return <ErrorState message={error.message} />;
  if (!q) notFound();

  const [members, { data: responses }, { data: evidence }, { data: fus }, { data: comments }, { data: log }] = await Promise.all([
    internal ? loadMembers(supabase, ctx.org.id).catch(() => []) : Promise.resolve([]),
    supabase.from("subsidiary_questionnaire_responses").select("*, evidence(file_name)").eq("organization_id", ctx.org.id).eq("questionnaire_id", q.id).order("sort_order").order("question"),
    internal ? supabase.from("evidence").select("id, file_name").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    internal ? supabase.from("follow_ups").select("id, description, owner_user_id, due_date, status").eq("organization_id", ctx.org.id).eq("questionnaire_id", q.id).order("due_date") : Promise.resolve({ data: [] }),
    supabase.from("workpaper_comments").select("id, body, visibility, author_id, created_at").eq("organization_id", ctx.org.id).eq("target_type", "subsidiary_questionnaire").eq("target_id", q.id).order("created_at", { ascending: false }),
    internal ? supabase.from("audit_log").select("id, action, actor_id, metadata, created_at").eq("organization_id", ctx.org.id).eq("entity_type", "subsidiary_questionnaires").eq("entity_id", q.id).order("created_at", { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
  ]);

  const ent = one(q.entities as { id: string; name: string; local_owner_user_id: string | null } | { id: string; name: string; local_owner_user_id: string | null }[] | null);
  const per = one(q.reporting_periods as { label: string } | { label: string }[] | null);
  const isLocalOwner = ent?.local_owner_user_id === ctx.userId;
  const canPrepare = can(ctx.role, "questionnaire.prepare") && (["owner", "admin", "internal_auditor"].includes(ctx.role ?? "") || isLocalOwner);
  const canReview = can(ctx.role, "group.review");
  const editable = EDITABLE.includes(q.status) && canPrepare;
  const next = WORKFLOW_TRANSITIONS[q.status] ?? [];
  const here = withParams(`/dashboard/subsidiary-questionnaires/${q.id}`, { period: searchParams.period });
  const answered = (responses ?? []).filter((r) => (r.response ?? "").trim() !== "").length;

  const transitionForm = (to: string) => {
    const review = ["approved", "returned", "reopened"].includes(to);
    if (review ? !canReview : !canPrepare) return null;
    const hidden = (<><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={q.id} /><input type="hidden" name="from" value={q.status} /><input type="hidden" name="to" value={to} /></>);
    if (to === "approved") return (
      <form key={to} action={transitionQuestionnaireAction} className="flex items-center gap-2">{hidden}
        <select name="outcome" required aria-label="Outcome" className={`${inputClass} w-56`}><option value="accepted">Accept</option><option value="accepted_with_follow_up">Accept with follow-up</option></select>
        <button className={primaryBtn} type="submit">Record decision</button></form>);
    if (to === "returned") return (
      <form key={to} action={transitionQuestionnaireAction} className="flex items-center gap-2">{hidden}
        <select name="outcome" required aria-label="Outcome" className={`${inputClass} w-56`}><option value="clarification_requested">Request clarification</option><option value="returned">Return</option></select>
        <input name="review_note" required minLength={5} placeholder="Note to preparer (required)" className={`${inputClass} w-64`} />
        <button className={secondaryBtn} type="submit">Send back</button></form>);
    if (to === "reopened") return (
      <form key={to} action={transitionQuestionnaireAction} className="flex items-center gap-2">{hidden}
        <input name="review_note" required minLength={5} placeholder="Reason for reopening (required)" className={`${inputClass} w-64`} />
        <button className={secondaryBtn} type="submit">Reopen</button></form>);
    return (<form key={to} action={transitionQuestionnaireAction}>{hidden}<button className={secondaryBtn} type="submit">{to === "prepared" ? "Mark prepared" : to === "submitted" ? "Submit for group review" : label(to)}</button></form>);
  };

  return (
    <div>
      <Link href={withParams("/dashboard/subsidiary-questionnaires", { period: searchParams.period })} className="mb-3 inline-block text-xs text-mute hover:text-paper">← All questionnaires</Link>
      <PageHeader eyebrow={`Subsidiary questionnaire · ${per?.label ?? "Period"}`} title={ent?.name ?? "Entity"} subtitle={`Local owner: ${internal ? memberName(members, ent?.local_owner_user_id) : "—"}`} />
      <Banner notice={searchParams.notice} error={searchParams.error} />

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <section className={cardClass}>
            <div className="mb-3 flex flex-wrap items-center gap-3"><StatusBadge value={q.status} /><span className="text-xs text-mute">Group review: <span className="text-paper">{OUTCOME_LABELS[q.group_review_status] ?? label(q.group_review_status)}</span></span><span className="text-xs text-mute">{answered} of {(responses ?? []).length} answered</span></div>
            {q.review_note && q.status !== "approved" && <p className="mb-3 rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-300">Reviewer note: {q.review_note}</p>}
            {internal && (
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <span className="text-xs text-mute">Workflow:</span>
                {next.map((to) => transitionForm(to))}
                {next.length === 0 && <span className="text-xs text-mute">No further transitions.</span>}
              </div>
            )}
            <p className="mt-3 text-[11px] text-mute">{q.submitted_at && <>Submitted {fmtDateTime(q.submitted_at)} by {internal ? memberName(members, q.submitted_by) : "entity management"}. </>}{q.approved_at && <>Decision recorded {fmtDateTime(q.approved_at)}{internal ? ` by ${memberName(members, q.reviewed_by)}` : ""}.</>}</p>
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Responses</h2>
            {(responses ?? []).length === 0 ? <p className="text-sm text-mute">No questions.</p> : (
              <ol className="space-y-5">
                {(responses ?? []).map((r, i) => {
                  const ev = one(r.evidence as { file_name: string } | { file_name: string }[] | null);
                  const fu = (fus ?? []).find((f) => f.id === r.follow_up_id);
                  return (
                    <li key={r.id} className="border-b border-line pb-5 last:border-0">
                      <p className="mb-2 text-sm font-medium text-paper">{i + 1}. {r.question}</p>
                      {editable ? (
                        <form action={saveResponseAction} className="grid grid-cols-2 gap-3">
                          <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={r.id} />
                          <div className="col-span-2"><label className={labelClass} htmlFor={`resp-${r.id}`}>Response *</label><textarea id={`resp-${r.id}`} name="response" rows={2} defaultValue={r.response ?? ""} className={inputClass} /></div>
                          <div className="col-span-2"><label className={labelClass} htmlFor={`com-${r.id}`}>Comments / supporting detail</label><textarea id={`com-${r.id}`} name="evidence_comments" rows={2} defaultValue={r.evidence_comments ?? ""} className={inputClass} /></div>
                          <div><label className={labelClass} htmlFor={`ev-${r.id}`}>Evidence</label><select id={`ev-${r.id}`} name="evidence_id" defaultValue={r.evidence_id ?? ""} className={inputClass}><option value="">None</option>{(evidence ?? []).map((e) => <option key={e.id} value={e.id}>{e.file_name}</option>)}</select></div>
                          <label className="flex items-center gap-2 pt-6 text-sm text-paper"><input type="checkbox" name="follow_up_required" defaultChecked={r.follow_up_required} /> Follow-up required</label>
                          <div><button className={secondaryBtn} type="submit">Save answer</button></div>
                        </form>
                      ) : (
                        <div className="space-y-1 text-sm">
                          <p className="whitespace-pre-wrap text-paper">{r.response ?? <span className="text-mute">No response</span>}</p>
                          {r.evidence_comments && <p className="whitespace-pre-wrap text-mute">{r.evidence_comments}</p>}
                          <p className="text-xs text-mute">{ev ? `Evidence: ${ev.file_name}` : r.evidence_id ? "Evidence linked" : "No evidence linked"}{r.follow_up_required && " · Follow-up required"}{fu && ` · Follow-up: ${fu.description}`}</p>
                        </div>
                      )}
                      {internal && canReview && ["submitted", "approved"].includes(q.status) && r.follow_up_required && !r.follow_up_id && (
                        <form action={createQuestionnaireFollowUpAction} className="mt-3 grid grid-cols-4 items-end gap-2 rounded-md border border-line bg-panel p-3">
                          <input type="hidden" name="return_to" value={here} /><input type="hidden" name="questionnaire_id" value={q.id} /><input type="hidden" name="response_id" value={r.id} />
                          <div className="col-span-4"><label className={labelClass} htmlFor={`fd-${r.id}`}>Raise a follow-up for this answer</label><input id={`fd-${r.id}`} name="description" required className={inputClass} /></div>
                          <select name="owner_user_id" required aria-label="Owner" className={inputClass}><option value="">Owner…</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select>
                          <input name="due_date" type="date" required aria-label="Due date" className={inputClass} />
                          <button className={secondaryBtn} type="submit">Create follow-up</button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {editable && (
              <form action={addQuestionAction} className="mt-4 flex items-end gap-3 border-t border-line pt-4">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="questionnaire_id" value={q.id} />
                <div className="flex-1"><label className={labelClass} htmlFor="new_q">Add a question</label><input id="new_q" name="question" className={inputClass} /></div>
                <button className={secondaryBtn} type="submit">Add</button>
              </form>
            )}
          </section>

          {internal && (
            <section className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-paper">Follow-ups</h2>
              {(fus ?? []).length === 0 ? <p className="text-sm text-mute">No follow-ups linked to this questionnaire.{q.group_review_status === "accepted_with_follow_up" ? "" : " Accepting “with follow-up” requires one."}</p> : (
                <ul className="divide-y divide-line text-sm">{(fus ?? []).map((f) => <li key={f.id} className="flex justify-between gap-4 py-2"><div><p className="text-paper">{f.description}</p><p className="text-xs text-mute">{memberName(members, f.owner_user_id)} · due {fmtDate(f.due_date)}</p></div><StatusBadge value={f.status} /></li>)}</ul>
              )}
              {canReview && !["approved", "archived"].includes(q.status) && (
                <form action={createQuestionnaireFollowUpAction} className="mt-4 grid grid-cols-4 items-end gap-3 border-t border-line pt-4">
                  <input type="hidden" name="return_to" value={here} /><input type="hidden" name="questionnaire_id" value={q.id} />
                  <div className="col-span-4"><label className={labelClass} htmlFor="qf_d">New follow-up *</label><input id="qf_d" name="description" required className={inputClass} /></div>
                  <select name="owner_user_id" required aria-label="Owner" className={`${inputClass} col-span-2`}><option value="">Owner…</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select>
                  <input name="due_date" type="date" required aria-label="Due date" className={inputClass} />
                  <button className={primaryBtn} type="submit">Add</button>
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
            {can(ctx.role, "comment.shareable") && (
              <form action={addCommentAction} className="space-y-2">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="target_type" value="subsidiary_questionnaire" /><input type="hidden" name="target_id" value={q.id} />
                <textarea name="body" required rows={3} placeholder="Add a note" aria-label="Note" className={inputClass} />
                <select name="visibility" defaultValue={internal ? "internal" : "shareable"} aria-label="Visibility" className={inputClass}>{internal && <option value="internal">Internal only (never shown to external auditors)</option>}<option value="shareable">Shareable with external auditors</option></select>
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
          <LastUpdated at={q.updated_at} />
        </div>
      </div>
    </div>
  );
}
