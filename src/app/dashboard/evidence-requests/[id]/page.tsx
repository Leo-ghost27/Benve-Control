import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { getEvidenceFileSignedUrl } from "@/lib/supabase/admin";
import { ChangeHistory } from "@/components/dashboard/ChangeHistory";
import {
  acceptEvidenceRequestAction,
  requestClarificationAction,
  rejectEvidenceRequestAction,
  linkToTestStepAction,
} from "@/lib/actions/evidence-requests";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export default async function EvidenceRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();

  const supabase = await createClient();

  const { data: request, error } = await supabase
    .from("evidence_requests")
    .select("*, controls(id, code, title)")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();

  if (error || !request) notFound();

  const control = Array.isArray(request.controls) ? request.controls[0] : request.controls;

  const { data: testSteps } = control
    ? await supabase
        .from("test_steps")
        .select("id, step_number, description, test_plan_id")
        .eq("organization_id", ctx.org.id)
        .order("step_number", { ascending: true })
    : { data: [] };

  const fileUrl = request.submitted_file_path
    ? await getEvidenceFileSignedUrl(request.submitted_file_path)
    : null;

  const { data: history } = await supabase
    .from("audit_log")
    .select("id, action, entity_type, metadata, created_at")
    .eq("organization_id", ctx.org.id)
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(30);

  const canReview = request.status === "submitted" || request.status === "under_review";

  return (
    <div className="mx-auto max-w-3xl p-8">
      {control && (
        <Link
          href={`/dashboard/controls/${control.id}`}
          className="text-sm text-mute hover:text-paper"
        >
          &larr; Back to {control.code}
        </Link>
      )}

      <div className="mt-4 mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Auditor Workspace
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          {request.title}
        </h1>
        <p className="mt-1 text-sm text-mute">
          {request.owner_name} ({request.owner_email})
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-line bg-panel p-6 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Related control</p>
          <p className="mt-1 text-paper">{control ? `${control.code} — ${control.title}` : "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Status</p>
          <p className="mt-1 text-paper">{formatLabel(request.status)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Due date</p>
          <p className="mt-1 text-paper">{request.due_date ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Priority</p>
          <p className="mt-1 text-paper">{formatLabel(request.priority)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Evidence period</p>
          <p className="mt-1 text-paper">{request.evidence_period ?? "—"}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs uppercase tracking-wide text-mute">Instructions</p>
          <p className="mt-1 text-paper">{request.instructions ?? "—"}</p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-line bg-panel p-6">
        <h2 className="mb-3 font-display text-lg font-semibold text-paper">Submission</h2>
        {!request.submitted_file_name ? (
          <p className="text-sm text-mute">No submission yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-paper">
              <span className="text-mute">File:</span>{" "}
              {fileUrl ? (
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-signal hover:underline">
                  {request.submitted_file_name}
                </a>
              ) : (
                request.submitted_file_name
              )}{" "}
              <span className="text-mute">({formatBytes(request.submitted_file_size)})</span>
            </p>
            <p className="text-paper">
              <span className="text-mute">Submitted by:</span> {request.submitted_by}
            </p>
            <p className="text-paper">
              <span className="text-mute">Submitted:</span>{" "}
              {request.submitted_at ? new Date(request.submitted_at).toLocaleString() : "—"}
            </p>
            {request.client_note && (
              <p className="text-paper">
                <span className="text-mute">Client note:</span> {request.client_note}
              </p>
            )}
          </div>
        )}
        {request.auditor_comment && (
          <div className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
            <span className="font-medium">Auditor comment:</span> {request.auditor_comment}
          </div>
        )}
      </div>

      {canReview && (
        <div className="mb-6 rounded-xl border border-line bg-panel p-6">
          <h2 className="mb-3 font-display text-lg font-semibold text-paper">Review</h2>

          <form action={acceptEvidenceRequestAction} className="mb-4">
            <input type="hidden" name="requestId" value={request.id} />
            <label className="mb-1.5 block text-xs font-medium text-mute">
              Comment (optional)
            </label>
            <textarea
              name="comment"
              rows={2}
              className="mb-2 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-paper focus:outline-none focus:ring-1 focus:ring-signal"
            />
            <button
              type="submit"
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500/90"
            >
              Accept evidence
            </button>
          </form>

          <form action={requestClarificationAction} className="mb-4">
            <input type="hidden" name="requestId" value={request.id} />
            <label className="mb-1.5 block text-xs font-medium text-mute">
              Comment (required)
            </label>
            <textarea
              name="comment"
              rows={2}
              required
              className="mb-2 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-paper focus:outline-none focus:ring-1 focus:ring-signal"
              placeholder="What's missing or needs clarifying?"
            />
            <button
              type="submit"
              className="rounded-md border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-400/20"
            >
              Request clarification
            </button>
          </form>

          <form action={rejectEvidenceRequestAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <label className="mb-1.5 block text-xs font-medium text-mute">
              Comment (required)
            </label>
            <textarea
              name="comment"
              rows={2}
              required
              className="mb-2 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-paper focus:outline-none focus:ring-1 focus:ring-signal"
              placeholder="Why is this evidence being rejected?"
            />
            <button
              type="submit"
              className="rounded-md border border-rose-400/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-400 transition-colors hover:bg-rose-400/20"
            >
              Reject evidence
            </button>
          </form>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-line bg-panel p-6">
        <h2 className="mb-3 font-display text-lg font-semibold text-paper">Link to test step</h2>
        <form action={linkToTestStepAction} className="flex items-center gap-3">
          <input type="hidden" name="requestId" value={request.id} />
          <select
            name="test_step_id"
            defaultValue={request.test_step_id ?? ""}
            className="flex-1 rounded-md border border-line bg-ink px-3 py-2 text-sm text-paper focus:outline-none focus:ring-1 focus:ring-signal"
          >
            <option value="">None</option>
            {(testSteps ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                Step {s.step_number}: {s.description.slice(0, 60)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-line px-4 py-2 text-sm text-paper transition-colors hover:border-signal"
          >
            Save link
          </button>
        </form>
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-semibold text-paper">History</h2>
        <ChangeHistory entries={history ?? []} />
      </div>

      <p className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-mute">
        Benve helps you submit requested information and track assigned actions. Benve&apos;s
        auditor remains responsible for determining the audit procedures, evaluating evidence,
        and documenting conclusions.
      </p>
    </div>
  );
}
