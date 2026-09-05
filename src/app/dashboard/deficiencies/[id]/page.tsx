import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { ChangeHistory } from "@/components/dashboard/ChangeHistory";
import {
  updateDeficiencyAssessmentAction,
  updateDeficiencyLikelihoodAction,
  addCompensatingControlAction,
  setAggregationGroupAction,
  submitDeficiencyClassificationAction,
  reviewDeficiencyClassificationAction,
} from "@/lib/actions/deficiencies";
import { createCommunicationAction } from "@/lib/actions/communications";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const labelClass = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-mute";
const cardClass = "rounded-xl border border-line bg-ink p-6";
const primaryBtn =
  "rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90";
const secondaryBtn =
  "rounded-md border border-line px-4 py-2 text-sm font-medium text-paper transition-colors hover:border-mute";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const likelihoodOptions = [
  { value: "remote", label: "Remote" },
  { value: "reasonably_possible", label: "Reasonably possible" },
  { value: "probable", label: "Probable" },
  { value: "further_analysis_required", label: "Further analysis required" },
];

const classificationOptions = [
  { value: "control_deficiency", label: "Control deficiency" },
  { value: "significant_deficiency", label: "Significant deficiency" },
  { value: "material_weakness", label: "Material weakness" },
  { value: "further_evaluation_required", label: "Further evaluation required" },
];

const qualitativeFlagFields = [
  { key: "fraud_risk", label: "Fraud or unauthorised activity risk" },
  { key: "high_volume", label: "High-volume payment/transaction process" },
  { key: "control_change", label: "Control change during period" },
  { key: "management_override", label: "Management override / temporary access risk" },
  { key: "related_party", label: "Related-party transaction" },
  { key: "covenant_impact", label: "Covenant impact" },
  { key: "prior_restatement", label: "Prior restatement" },
];

const reviewStatusStyles: Record<string, string> = {
  draft: "border-line text-mute",
  awaiting_review: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  returned: "border-rose-400/40 bg-rose-400/10 text-rose-300",
};

const commStatusStyles: Record<string, string> = {
  draft: "border-line text-mute",
  approved: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  issued: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

export default async function DeficiencyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();

  const supabase = await createClient();

  const { data: deficiency, error } = await supabase
    .from("deficiencies")
    .select("*, controls(id, code, title, risk_rating)")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();

  if (error || !deficiency) notFound();

  const control = Array.isArray(deficiency.controls)
    ? deficiency.controls[0]
    : deficiency.controls;

  const [
    { data: compensatingControls },
    { data: aggregationGroup },
    { data: siblingDeficiencies },
    { data: communications },
    { data: history },
  ] = await Promise.all([
    supabase
      .from("compensating_controls")
      .select("id, control_ref, description, operating_status, assessment")
      .eq("deficiency_id", id)
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: true }),
    deficiency.aggregation_group_id
      ? supabase
          .from("aggregation_groups")
          .select("id, group_ref, process")
          .eq("id", deficiency.aggregation_group_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    deficiency.aggregation_group_id
      ? supabase
          .from("deficiencies")
          .select("id, title, controls(code)")
          .eq("aggregation_group_id", deficiency.aggregation_group_id)
          .eq("organization_id", ctx.org.id)
          .neq("id", id)
      : Promise.resolve({ data: [] }),
    supabase
      .from("communications")
      .select("id, comm_ref, audience, status, planned_issue_date")
      .eq("deficiency_id", id)
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("audit_log")
      .select("id, action, entity_type, metadata, created_at")
      .eq("organization_id", ctx.org.id)
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const flags = (deficiency.qualitative_flags ?? {}) as Record<string, boolean>;
  const canReview = ctx.role === "owner" || ctx.role === "admin";

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link href="/dashboard/deficiencies" className="text-sm text-mute hover:text-paper">
        &larr; Back to Deficiencies
      </Link>

      <div className="mt-4 mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Deficiency Assessment Workpaper
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          {deficiency.title}
        </h1>
        <p className="mt-1 text-sm text-mute">
          {ctx.org.name}
          {control ? ` · ${control.code} — ${control.title}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              reviewStatusStyles[deficiency.review_status] ?? reviewStatusStyles.draft
            }`}
          >
            {formatLabel(deficiency.review_status)}
          </span>
          {deficiency.draft_classification && (
            <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-paper">
              {formatLabel(deficiency.draft_classification)}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* Section A — Factual context */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            A. Factual Exception and Control Context
          </h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-mute">Related control</dt>
              <dd className="mt-1 text-paper">
                {control ? `${control.code} — ${control.title}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-mute">Risk rating</dt>
              <dd className="mt-1 text-paper">{formatLabel(control?.risk_rating ?? null)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-mute">Description</dt>
              <dd className="mt-1 text-paper">{deficiency.description || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-mute">Identified</dt>
              <dd className="mt-1 text-paper">
                {deficiency.identified_at
                  ? new Date(deficiency.identified_at).toLocaleDateString()
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-mute">Triage severity</dt>
              <dd className="mt-1 text-paper">{formatLabel(deficiency.severity)}</dd>
            </div>
          </dl>
        </section>

        {/* Section B — Potential misstatement considerations */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            B. Potential Misstatement Considerations
          </h2>
          <form action={updateDeficiencyAssessmentAction} className="space-y-4">
            <input type="hidden" name="deficiencyId" value={deficiency.id} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Financial statement area</label>
                <input
                  className={inputClass}
                  name="financial_statement_area"
                  defaultValue={deficiency.financial_statement_area ?? ""}
                />
              </div>
              <div>
                <label className={labelClass}>Assertions (comma-separated)</label>
                <input
                  className={inputClass}
                  name="assertions"
                  defaultValue={(deficiency.assertions ?? []).join(", ")}
                  placeholder="Occurrence, Authorization, Accuracy"
                />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Related risk summary</label>
                <textarea
                  className={inputClass}
                  name="related_risk_summary"
                  rows={2}
                  defaultValue={deficiency.related_risk_summary ?? ""}
                />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Potential error type</label>
                <input
                  className={inputClass}
                  name="potential_error_type"
                  defaultValue={deficiency.potential_error_type ?? ""}
                />
              </div>
              <div>
                <label className={labelClass}>Max reasonably possible exposure</label>
                <input
                  className={inputClass}
                  type="number"
                  step="0.01"
                  name="max_reasonable_exposure"
                  defaultValue={deficiency.max_reasonable_exposure ?? ""}
                />
              </div>
              <div>
                <label className={labelClass}>Identified amount</label>
                <input
                  className={inputClass}
                  type="number"
                  step="0.01"
                  name="identified_amount"
                  defaultValue={deficiency.identified_amount ?? ""}
                />
              </div>
              <div>
                <label className={labelClass}>Planning materiality</label>
                <input
                  className={inputClass}
                  type="number"
                  step="0.01"
                  name="planning_materiality"
                  defaultValue={deficiency.planning_materiality ?? ""}
                />
              </div>
              <div>
                <label className={labelClass}>Performance materiality</label>
                <input
                  className={inputClass}
                  type="number"
                  step="0.01"
                  name="performance_materiality"
                  defaultValue={deficiency.performance_materiality ?? ""}
                />
              </div>
              <div>
                <label className={labelClass}>Clearly trivial threshold</label>
                <input
                  className={inputClass}
                  type="number"
                  step="0.01"
                  name="clearly_trivial_threshold"
                  defaultValue={deficiency.clearly_trivial_threshold ?? ""}
                />
              </div>
            </div>

            <div>
              <span className={labelClass}>Qualitative considerations</span>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-line bg-panel p-3">
                {qualitativeFlagFields.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 text-sm text-paper">
                    <input
                      type="checkbox"
                      name={`flag_${f.key}`}
                      defaultChecked={Boolean(flags[f.key])}
                      className="h-4 w-4 rounded border-line bg-panel accent-signal"
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className={labelClass}>Potential impact analysis</label>
              <textarea
                className={inputClass}
                name="potential_impact_analysis"
                rows={4}
                defaultValue={deficiency.potential_impact_analysis ?? ""}
              />
            </div>

            <button type="submit" className={primaryBtn}>
              Save Assessment
            </button>
          </form>
        </section>

        {/* Section C — Likelihood, compensating controls, aggregation */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            C. Likelihood, Compensating Controls &amp; Aggregation
          </h2>

          <form action={updateDeficiencyLikelihoodAction} className="mb-6">
            <input type="hidden" name="deficiencyId" value={deficiency.id} />
            <label className={labelClass}>Likelihood of potential misstatement</label>
            <div className="flex flex-wrap gap-2">
              {likelihoodOptions.map((opt) => (
                <label
                  key={opt.value}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium ${
                    deficiency.likelihood === opt.value
                      ? "border-signal bg-signal/15 text-paper"
                      : "border-line text-mute hover:text-paper"
                  }`}
                >
                  <input
                    type="radio"
                    name="likelihood"
                    value={opt.value}
                    defaultChecked={deficiency.likelihood === opt.value}
                    className="mr-1.5 hidden"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <button type="submit" className={`${secondaryBtn} mt-3`}>
              Save Likelihood
            </button>
          </form>

          <div className="mb-6">
            <p className={labelClass}>Compensating controls</p>
            {compensatingControls && compensatingControls.length > 0 ? (
              <div className="mb-3 overflow-hidden rounded-md border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
                    <tr>
                      <th className="px-3 py-2 font-medium">Control</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Assessment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line bg-ink">
                    {compensatingControls.map((cc) => (
                      <tr key={cc.id}>
                        <td className="px-3 py-2 font-mono text-xs text-paper">
                          {cc.control_ref || "—"}
                        </td>
                        <td className="px-3 py-2 text-mute">{cc.description || "—"}</td>
                        <td className="px-3 py-2 text-mute">{cc.operating_status || "—"}</td>
                        <td className="px-3 py-2 text-mute">{cc.assessment || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mb-3 text-sm text-mute">No compensating controls recorded yet.</p>
            )}
            <form action={addCompensatingControlAction} className="grid grid-cols-4 gap-2">
              <input type="hidden" name="deficiencyId" value={deficiency.id} />
              <input className={inputClass} name="control_ref" placeholder="Control ID" />
              <input className={inputClass} name="description" placeholder="Description" />
              <input className={inputClass} name="operating_status" placeholder="Operating status" />
              <div className="flex gap-2">
                <input className={inputClass} name="assessment" placeholder="Assessment" />
                <button type="submit" className={secondaryBtn}>
                  Add
                </button>
              </div>
            </form>
          </div>

          <div>
            <p className={labelClass}>Aggregation review</p>
            {aggregationGroup ? (
              <div className="mb-3 rounded-md border border-line bg-panel p-3 text-sm">
                <p className="text-paper">
                  Included in aggregation group{" "}
                  <span className="font-mono text-signal">{aggregationGroup.group_ref}</span>
                  {aggregationGroup.process ? ` (${aggregationGroup.process})` : ""}
                </p>
                {siblingDeficiencies && siblingDeficiencies.length > 0 && (
                  <ul className="mt-2 space-y-1 text-mute">
                    {siblingDeficiencies.map((d) => (
                      <li key={d.id}>
                        <Link
                          href={`/dashboard/deficiencies/${d.id}`}
                          className="hover:text-paper"
                        >
                          {d.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mb-3 text-sm text-mute">Not yet assigned to an aggregation group.</p>
            )}
            <form action={setAggregationGroupAction} className="flex gap-2">
              <input type="hidden" name="deficiencyId" value={deficiency.id} />
              <input
                className={inputClass}
                name="group_ref"
                placeholder="Aggregation group ref (e.g. AGG-PAY-01)"
                defaultValue={aggregationGroup?.group_ref ?? ""}
              />
              <input
                className={inputClass}
                name="process"
                placeholder="Process"
                defaultValue={aggregationGroup?.process ?? ""}
              />
              <button type="submit" className={secondaryBtn}>
                Save
              </button>
            </form>
          </div>
        </section>

        {/* Section D — Classification and review */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            D. Classification &amp; Engagement Lead Review
          </h2>
          <form action={submitDeficiencyClassificationAction} className="space-y-4">
            <input type="hidden" name="deficiencyId" value={deficiency.id} />
            <div>
              <label className={labelClass}>Draft classification</label>
              <div className="flex flex-wrap gap-2">
                {classificationOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium ${
                      deficiency.draft_classification === opt.value
                        ? "border-signal bg-signal/15 text-paper"
                        : "border-line text-mute hover:text-paper"
                    }`}
                  >
                    <input
                      type="radio"
                      name="draft_classification"
                      value={opt.value}
                      defaultChecked={deficiency.draft_classification === opt.value}
                      className="mr-1.5 hidden"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>Rationale</label>
              <textarea
                className={inputClass}
                name="classification_rationale"
                rows={4}
                defaultValue={deficiency.classification_rationale ?? ""}
              />
            </div>
            <button type="submit" className={primaryBtn}>
              Submit for Engagement Lead Review
            </button>
          </form>

          {deficiency.review_status === "awaiting_review" && canReview && (
            <div className="mt-4 flex gap-2 border-t border-line pt-4">
              <form action={reviewDeficiencyClassificationAction}>
                <input type="hidden" name="deficiencyId" value={deficiency.id} />
                <input type="hidden" name="decision" value="approve" />
                <button type="submit" className={primaryBtn}>
                  Approve Draft Classification
                </button>
              </form>
              <form action={reviewDeficiencyClassificationAction}>
                <input type="hidden" name="deficiencyId" value={deficiency.id} />
                <input type="hidden" name="decision" value="return" />
                <button type="submit" className={secondaryBtn}>
                  Return for Further Analysis
                </button>
              </form>
            </div>
          )}

          {deficiency.reviewer_id && (
            <p className="mt-4 text-xs text-mute">
              Reviewed {deficiency.review_date ? `on ${deficiency.review_date}` : ""} — status:{" "}
              {formatLabel(deficiency.review_status)}
            </p>
          )}
        </section>

        {/* Communications */}
        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-paper">Controlled Communications</h2>
            <form action={createCommunicationAction}>
              <input type="hidden" name="deficiencyId" value={deficiency.id} />
              <input type="hidden" name="audience" value="Management / Audit Committee" />
              <input type="hidden" name="comm_type" value="Quarterly ICFR deficiency update" />
              <button type="submit" className={secondaryBtn}>
                Create Communication
              </button>
            </form>
          </div>
          {communications && communications.length > 0 ? (
            <ul className="divide-y divide-line">
              {communications.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/dashboard/communications/${c.id}`} className="text-paper hover:text-signal">
                    {c.comm_ref || c.id.slice(0, 8)} — {c.audience || "Unspecified audience"}
                  </Link>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      commStatusStyles[c.status] ?? commStatusStyles.draft
                    }`}
                  >
                    {formatLabel(c.status)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">No communications drafted yet for this deficiency.</p>
          )}
        </section>

        <ChangeHistory entries={history ?? []} />
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        Deficiency Severity &amp; Aggregation Assessment Centre helps document auditor-led
        evaluation of identified control exceptions and deficiencies. It does not automatically
        classify a deficiency, determine whether a material weakness exists, determine
        materiality, provide legal advice, or issue audit conclusions or opinions. The Engagement
        Lead and authorised professionals are responsible for all final severity, communication,
        and reporting decisions.
      </p>
    </div>
  );
}
