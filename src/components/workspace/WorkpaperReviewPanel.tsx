import { createClient } from "@/lib/supabase/server";
import type { OrgContext } from "@/lib/supabase/org";
import { StatusBadge, cardClass, fmtDate, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import {
  addPlanCommentAction, assignTestPlanAction, decideReviewAction, reopenReviewAction, submitForReviewAction,
} from "@/lib/actions/reviews";

type Review = {
  id: string; record_version: number; content_hash: string; status: string; submitted_by: string | null; submitted_at: string;
  decided_by: string | null; decided_at: string | null; decision_comment: string | null; superseded_reason: string | null;
};
type Member = { user_id: string; role: string; full_name: string | null; email: string | null };
type Comment = { id: string; body: string; visibility: string; author_id: string | null; created_at: string };

export async function WorkpaperReviewPanel({
  ctx, plan,
}: {
  ctx: OrgContext & { org: { id: string; name: string } };
  plan: { id: string; status: string; assigned_to: string | null; due_date: string | null };
}) {
  const supabase = await createClient();
  const orgId = ctx.org.id;
  const role = ctx.role ?? "";
  const internal = ["owner", "admin", "cfo", "controller", "internal_auditor", "adviser"].includes(role);

  const [{ data: reviewRows }, { data: commentRows }, { data: canReviewData }] = await Promise.all([
    supabase.from("workpaper_reviews")
      .select("id, record_version, content_hash, status, submitted_by, submitted_at, decided_by, decided_at, decision_comment, superseded_reason")
      .eq("organization_id", orgId).eq("record_type", "test_plan").eq("record_id", plan.id)
      .order("record_version", { ascending: false }),
    supabase.from("workpaper_comments")
      .select("id, body, visibility, author_id, created_at")
      .eq("organization_id", orgId).eq("target_type", "test_plan").eq("target_id", plan.id)
      .order("created_at", { ascending: false }),
    internal ? supabase.rpc("p2_can_review", { p_org: orgId }) : Promise.resolve({ data: false }),
  ]);
  const reviews = (reviewRows ?? []) as Review[];
  const comments = (commentRows ?? []) as Comment[];
  const canReview = canReviewData === true;
  const { data: memberRows } = internal ? await supabase.rpc("p2_org_members", { p_org: orgId }) : { data: [] };
  const members = (memberRows ?? []) as Member[];
  const name = (id: string | null) => {
    if (!id) return "—";
    const m = members.find((x) => x.user_id === id);
    return m ? (m.full_name || m.email || "Team member") : id === ctx.userId ? "You" : "Team member";
  };
  const { data: settingRow } = internal
    ? await supabase.from("engagement_review_settings").select("require_separate_review").eq("organization_id", orgId).maybeSingle()
    : { data: null };
  const requireSeparate = settingRow?.require_separate_review ?? true;

  const open = reviews.find((r) => r.status === "submitted");
  const approved = reviews.find((r) => r.status === "approved");
  const canPrepare = ["owner", "admin", "internal_auditor"].includes(role);
  const isPreparer = open ? (open.submitted_by === ctx.userId || plan.assigned_to === ctx.userId) : false;
  const mustBeSeparate = requireSeparate && isPreparer;
  const assignable = members.filter((m) => ["owner", "admin", "cfo", "controller", "internal_auditor", "adviser"].includes(m.role));

  return (
    <div className="mb-8 space-y-4">
      <div className={cardClass}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg font-semibold text-paper">Review &amp; approval</h2>
          <StatusBadge value={approved ? "approved" : open ? "in_review" : plan.status === "in_progress" ? "in_progress" : "draft"} />
          <span className="text-xs text-mute">
            {approved ? `Approved version ${approved.record_version}` : open ? `Version ${open.record_version} awaiting review` : "Not under review"}
          </span>
          {open && <span className="font-mono text-[10px] text-mute" title="Fingerprint of the exact content under review">ref {open.content_hash.slice(0, 12)}</span>}
          {approved && <span className="font-mono text-[10px] text-mute" title="Fingerprint of the approved content">ref {approved.content_hash.slice(0, 12)}</span>}
        </div>

        {approved && (
          <p className="mt-3 text-sm text-emerald-300">
            Approved {fmtDateTime(approved.decided_at)} by {name(approved.decided_by)}. Any change to the plan, steps, evidence or samples withdraws this approval automatically.
          </p>
        )}
        {!approved && !open && reviews[0]?.status === "returned" && (
          <p className="mt-3 text-sm text-rose-300">Returned for rework: {reviews[0].decision_comment}</p>
        )}
        {!approved && !open && reviews[0]?.status === "superseded" && (
          <p className="mt-3 text-sm text-amber-300">Previous review withdrawn: {reviews[0].superseded_reason}</p>
        )}

        {canPrepare && !open && !approved && (
          <form action={submitForReviewAction} className="mt-4">
            <input type="hidden" name="plan_id" value={plan.id} />
            <button className={primaryBtn} type="submit">Submit for review</button>
            <span className="ml-3 text-xs text-mute">Fingerprints the current content; the reviewer approves exactly this version.</span>
          </form>
        )}

        {open && canReview && !mustBeSeparate && (
          <form action={decideReviewAction} className="mt-4 grid gap-3 rounded-md border border-sky-900/60 p-4">
            <input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="review_id" value={open.id} />
            <input type="hidden" name="content_hash" value={open.content_hash} />
            <p className="text-sm text-sky-300">Your decision applies to version {open.record_version} exactly as submitted {fmtDateTime(open.submitted_at)} by {name(open.submitted_by)}. If it changes before you submit, the decision is refused.</p>
            <div><label className={labelClass} htmlFor="rv-comment">Comment (required when returning)</label><textarea id="rv-comment" name="comment" rows={2} className={inputClass} /></div>
            <div className="flex gap-2">
              <button name="decision" value="approved" className={primaryBtn} type="submit">Approve this version</button>
              <button name="decision" value="returned" className={`${secondaryBtn} !py-2 text-rose-300`} type="submit">Return for rework</button>
            </div>
          </form>
        )}
        {open && canReview && mustBeSeparate && (
          <p className="mt-4 text-sm text-amber-300">This engagement requires a separate reviewer. You prepared or are assigned to this work, so someone else must decide it.</p>
        )}
        {open && !canReview && (
          <p className="mt-4 text-sm text-mute">Awaiting a reviewer with explicit review-approval authority for this engagement. Roles alone — including CPA/adviser — do not carry it; the engagement lead assigns it under Settings → Team.</p>
        )}

        {approved && (canReview || role === "owner" || role === "admin") && (
          <form action={reopenReviewAction} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="review_id" value={approved.id} />
            <div><label className={labelClass} htmlFor="reopen-reason">Reopen approved work (rationale required)</label><input id="reopen-reason" name="reason" required minLength={10} className={inputClass} /></div>
            <button className={secondaryBtn} type="submit">Reopen</button>
          </form>
        )}
        <p className="mt-3 text-[11px] text-mute">Separate review is {requireSeparate ? "required" : "not required"} for this engagement.</p>
      </div>

      {internal && (
        <div className={cardClass}>
          <h3 className="mb-2 text-sm font-semibold text-paper">Assignment</h3>
          {canPrepare ? (
            <form action={assignTestPlanAction} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <input type="hidden" name="plan_id" value={plan.id} />
              <div><label className={labelClass} htmlFor="assignee">Assigned to</label>
                <select id="assignee" name="assigned_to" defaultValue={plan.assigned_to ?? ""} className={inputClass}>
                  <option value="">Unassigned</option>
                  {assignable.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email} · {label(m.role)}</option>)}
                </select></div>
              <div><label className={labelClass} htmlFor="due">Due date</label><input id="due" name="due_date" type="date" defaultValue={plan.due_date ?? ""} className={inputClass} /></div>
              <button className={secondaryBtn} type="submit">Save</button>
            </form>
          ) : (
            <p className="text-sm text-mute">Assigned to {name(plan.assigned_to)}{plan.due_date ? `, due ${fmtDate(plan.due_date)}` : ""}.</p>
          )}
        </div>
      )}

      <div className={cardClass}>
        <h3 className="mb-2 text-sm font-semibold text-paper">Comments</h3>
        <p className="mb-3 text-xs text-mute">Internal comments are visible to the audit team only. Shareable comments are also visible to the external auditor. Comments cannot be edited or deleted.</p>
        {comments.length === 0 ? <p className="text-sm text-mute">No comments yet.</p> : (
          <ul className="mb-4 space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-md border border-line p-3 text-sm">
                <div className="flex items-center gap-2 text-xs text-mute">
                  <span className={`rounded-full border px-2 py-0.5 ${c.visibility === "internal" ? "border-amber-900/60 text-amber-300" : "border-sky-900/60 text-sky-300"}`}>{c.visibility}</span>
                  <span>{internal ? name(c.author_id) : "Reviewer"}</span><span>{fmtDateTime(c.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-paper">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        {(internal || role === "external_auditor") && (
          <form action={addPlanCommentAction} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
            <input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="org_id" value={orgId} />
            <div><label className={labelClass} htmlFor="c-body">Add a comment</label><input id="c-body" name="body" required className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="c-vis">Visible to</label>
              <select id="c-vis" name="visibility" className={inputClass} defaultValue={internal ? "internal" : "shareable"}>
                {internal && <option value="internal">Audit team only</option>}
                <option value="shareable">Shared with external auditor</option>
              </select></div>
            <button className={secondaryBtn} type="submit">Add</button>
          </form>
        )}
      </div>

      {reviews.length > 0 && (
        <div className={cardClass}>
          <h3 className="mb-2 text-sm font-semibold text-paper">Review history</h3>
          <ul className="space-y-2 text-sm">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-2"><StatusBadge value={r.status === "submitted" ? "in_review" : r.status === "superseded" ? "rejected" : r.status} /><span className="text-paper">Version {r.record_version} · {r.status}</span><span className="font-mono text-[10px] text-mute">ref {r.content_hash.slice(0, 12)}</span></div>
                <p className="mt-1 text-xs text-mute">Submitted {fmtDateTime(r.submitted_at)} by {name(r.submitted_by)}{r.decided_at ? ` · decided ${fmtDateTime(r.decided_at)} by ${name(r.decided_by)}` : ""}</p>
                {r.decision_comment && <p className="mt-1 text-paper">{r.decision_comment}</p>}
                {r.superseded_reason && <p className="mt-1 text-xs text-amber-300">{r.superseded_reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
