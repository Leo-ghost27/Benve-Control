import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import {
  createSubsidiaryQuestionnaireAction,
  updateQuestionnaireResponseAction,
  submitQuestionnaireAction,
  reviewQuestionnaireAction,
} from "@/lib/actions/entities";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const cardClass = "rounded-xl border border-line bg-ink p-6";
const primaryBtn =
  "rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90";
const secondaryBtn =
  "rounded-md border border-line px-4 py-2 text-sm font-medium text-paper transition-colors hover:border-mute";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const statusStyles: Record<string, string> = {
  draft: "border-line text-mute",
  submitted: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  reviewed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();

  const supabase = await createClient();

  const { data: entity, error } = await supabase
    .from("entities")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();

  if (error || !entity) notFound();

  const [{ data: controls }, { data: deficiencies }, { data: questionnaires }] = await Promise.all([
    supabase
      .from("controls")
      .select("id, code, title, status")
      .eq("entity_id", id)
      .eq("organization_id", ctx.org.id),
    supabase
      .from("deficiencies")
      .select("id, title, severity, draft_classification")
      .eq("entity_id", id)
      .eq("organization_id", ctx.org.id),
    supabase
      .from("subsidiary_questionnaires")
      .select("*")
      .eq("entity_id", id)
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: false }),
  ]);

  const latestQuestionnaire = questionnaires?.[0];
  const { data: responses } = latestQuestionnaire
    ? await supabase
        .from("subsidiary_questionnaire_responses")
        .select("*")
        .eq("questionnaire_id", latestQuestionnaire.id)
        .order("id", { ascending: true })
    : { data: [] };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link href="/dashboard/entities" className="text-sm text-mute hover:text-paper">
        &larr; Back to Entities
      </Link>

      <div className="mt-4 mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Entity Detail
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          {entity.name}
        </h1>
        <p className="mt-1 text-sm text-mute">
          {entity.jurisdiction} {entity.is_parent ? "· Parent entity" : ""}
        </p>
      </div>

      <div className="space-y-6">
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Profile &amp; Roll-Up</h2>
          <p className="mb-4 text-sm text-mute">{entity.functional_scope || "No functional scope recorded."}</p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-md border border-line bg-panel p-3">
              <p className="text-2xl font-bold text-paper">{controls?.length ?? 0}</p>
              <p className="text-xs text-mute">Controls scoped to this entity</p>
            </div>
            <div className="rounded-md border border-line bg-panel p-3">
              <p className="text-2xl font-bold text-paper">{deficiencies?.length ?? 0}</p>
              <p className="text-xs text-mute">Deficiencies scoped to this entity</p>
            </div>
          </div>
        </section>

        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Subsidiary Assurance Questionnaire</h2>
          {!latestQuestionnaire ? (
            <form action={createSubsidiaryQuestionnaireAction} className="flex gap-2">
              <input type="hidden" name="entityId" value={entity.id} />
              <input className={inputClass} name="period" placeholder="Period (e.g. Q3 2026)" required />
              <button type="submit" className={primaryBtn}>
                Start Questionnaire
              </button>
            </form>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm text-paper">{latestQuestionnaire.period}</span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    statusStyles[latestQuestionnaire.status] ?? statusStyles.draft
                  }`}
                >
                  {formatLabel(latestQuestionnaire.status)}
                </span>
              </div>

              {responses && responses.length > 0 && (
                <div className="mb-4 space-y-3">
                  {responses.map((r) => (
                    <form
                      key={r.id}
                      action={updateQuestionnaireResponseAction}
                      className="rounded-md border border-line bg-panel p-3"
                    >
                      <input type="hidden" name="responseId" value={r.id} />
                      <input type="hidden" name="entityId" value={entity.id} />
                      <p className="mb-2 text-sm text-paper">{r.question}</p>
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          className={inputClass}
                          name="response"
                          defaultValue={r.response ?? ""}
                          disabled={latestQuestionnaire.status !== "draft"}
                        >
                          <option value="">— Select —</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                        <input
                          className={inputClass}
                          name="evidence_comments"
                          placeholder="Evidence / comments"
                          defaultValue={r.evidence_comments ?? ""}
                          disabled={latestQuestionnaire.status !== "draft"}
                        />
                        <input
                          className={inputClass}
                          name="follow_up_required"
                          placeholder="Follow-up required"
                          defaultValue={r.follow_up_required ?? ""}
                          disabled={latestQuestionnaire.status !== "draft"}
                        />
                      </div>
                      {latestQuestionnaire.status === "draft" && (
                        <button type="submit" className={`${secondaryBtn} mt-2`}>
                          Save
                        </button>
                      )}
                    </form>
                  ))}
                </div>
              )}

              {latestQuestionnaire.status === "draft" && (
                <form action={submitQuestionnaireAction} className="grid grid-cols-3 gap-2">
                  <input type="hidden" name="questionnaireId" value={latestQuestionnaire.id} />
                  <input type="hidden" name="entityId" value={entity.id} />
                  <input className={inputClass} name="prepared_by" placeholder="Prepared by (local)" />
                  <input className={inputClass} name="reviewed_by_local" placeholder="Reviewed by (local)" />
                  <input className={inputClass} name="submitted_to" placeholder="Submitted to (group)" />
                  <button type="submit" className={`${primaryBtn} col-span-3`}>
                    Submit to Group
                  </button>
                </form>
              )}

              {latestQuestionnaire.status === "submitted" && (
                <form action={reviewQuestionnaireAction} className="space-y-2 border-t border-line pt-4">
                  <input type="hidden" name="questionnaireId" value={latestQuestionnaire.id} />
                  <input type="hidden" name="entityId" value={entity.id} />
                  <input className={inputClass} name="group_reviewed_by" placeholder="Reviewed by (group)" />
                  <select className={inputClass} name="group_outcome" defaultValue="Accepted with follow-up">
                    <option>Accepted</option>
                    <option>Accepted with follow-up</option>
                    <option>Returned for clarification</option>
                  </select>
                  <textarea
                    className={inputClass}
                    name="follow_up_actions"
                    rows={2}
                    placeholder="Follow-up actions"
                  />
                  <button type="submit" className={primaryBtn}>
                    Save Group Review
                  </button>
                </form>
              )}

              {latestQuestionnaire.status === "reviewed" && (
                <div className="rounded-md border border-line bg-panel p-3 text-sm">
                  <p className="text-paper">
                    Reviewed by {latestQuestionnaire.group_reviewed_by} on{" "}
                    {latestQuestionnaire.group_review_date} — {latestQuestionnaire.group_outcome}
                  </p>
                  {latestQuestionnaire.follow_up_actions && (
                    <p className="mt-1 text-mute">{latestQuestionnaire.follow_up_actions}</p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
