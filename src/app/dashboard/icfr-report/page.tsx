import Link from "next/link";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ChangeHistory } from "@/components/dashboard/ChangeHistory";
import {
  createIcfrReportAction,
  updateIcfrReportAction,
  submitIcfrReportForReviewAction,
  approveIcfrReportAction,
} from "@/lib/actions/icfr-report";
import { addReviewApprovalAction } from "@/lib/actions/review-approvals";

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

const statusStyles: Record<string, string> = {
  draft: "border-line text-mute",
  under_review: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

export default async function IcfrReportPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to draft an ICFR report."
        />
      </div>
    );
  }

  const supabase = await createClient();

  const { data: allReports } = await supabase
    .from("icfr_reports")
    .select("id, as_of_date, status")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false });

  const selectedId = id ?? allReports?.[0]?.id;

  if (!selectedId) {
    return (
      <div className="p-8">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-paper">
            Management&apos;s Annual Report on ICFR
          </h1>
          <p className="mt-1 text-sm text-mute">SOX 404(a) — {ctx.org.name}</p>
        </div>
        <EmptyState
          title="No ICFR report drafted yet"
          description="Start the annual report on internal control over financial reporting for this organization."
        />
        <form action={createIcfrReportAction} className="mt-4">
          <button type="submit" className={primaryBtn}>
            Start ICFR Report
          </button>
        </form>
      </div>
    );
  }

  const [{ data: report }, { data: reviews }, { data: history }] = await Promise.all([
    supabase
      .from("icfr_reports")
      .select("*")
      .eq("id", selectedId)
      .eq("organization_id", ctx.org.id)
      .single(),
    supabase
      .from("review_approvals")
      .select("id, reviewer_name, reviewer_role, status, review_date, comments")
      .eq("target_type", "icfr_report")
      .eq("target_id", selectedId)
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("audit_log")
      .select("id, action, entity_type, metadata, created_at")
      .eq("organization_id", ctx.org.id)
      .eq("entity_id", selectedId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (!report) {
    return (
      <div className="p-8">
        <EmptyState title="Report not found" description="This ICFR report could not be found." />
      </div>
    );
  }

  const canApprove = ctx.role === "owner" || ctx.role === "admin" || ctx.role === "cfo";

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
            SOX 404(a)
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
            Management&apos;s Annual Report on ICFR
          </h1>
          <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
          <span
            className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              statusStyles[report.status] ?? statusStyles.draft
            }`}
          >
            {formatLabel(report.status)}
          </span>
        </div>
        <form action={createIcfrReportAction}>
          <button type="submit" className={secondaryBtn}>
            + New Report
          </button>
        </form>
      </div>

      {allReports && allReports.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {allReports.map((r) => (
            <Link
              key={r.id}
              href={`/dashboard/icfr-report?id=${r.id}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                r.id === selectedId
                  ? "border-signal bg-signal/15 text-paper"
                  : "border-line text-mute hover:text-paper"
              }`}
            >
              {r.as_of_date || "Undated"} · {formatLabel(r.status)}
            </Link>
          ))}
        </div>
      )}

      <div className="space-y-6">
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            A. Scope, Materiality &amp; Conclusion
          </h2>
          <form action={updateIcfrReportAction} className="space-y-4">
            <input type="hidden" name="reportId" value={report.id} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>As-of date</label>
                <input
                  className={inputClass}
                  type="date"
                  name="as_of_date"
                  defaultValue={report.as_of_date ?? ""}
                />
              </div>
              <div>
                <label className={labelClass}>Framework</label>
                <input className={inputClass} name="framework" defaultValue={report.framework} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Scope notes</label>
                <textarea
                  className={inputClass}
                  name="scope_notes"
                  rows={3}
                  defaultValue={report.scope_notes ?? ""}
                  placeholder="Processes, financial statement areas, and controls in scope for this assessment."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Material weakness conclusion</label>
                <select className={inputClass} name="mw_conclusion" defaultValue={report.mw_conclusion ?? ""}>
                  <option value="">— Select —</option>
                  <option value="no_material_weakness">No material weaknesses identified</option>
                  <option value="material_weakness_identified">
                    One or more material weaknesses identified
                  </option>
                  <option value="in_progress">Evaluation in progress — not final</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>ICFR effectiveness conclusion</label>
                <select
                  className={inputClass}
                  name="icfr_conclusion"
                  defaultValue={report.icfr_conclusion ?? ""}
                >
                  <option value="">— Select —</option>
                  <option value="effective">ICFR is effective</option>
                  <option value="not_effective">ICFR is not effective</option>
                  <option value="pending">Conclusion not final — pending further evaluation</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Material weakness rationale</label>
              <textarea
                className={inputClass}
                name="mw_rationale"
                rows={4}
                defaultValue={report.mw_rationale ?? ""}
              />
            </div>
            <div>
              <label className={labelClass}>Draft report text</label>
              <textarea
                className={inputClass}
                name="draft_text"
                rows={10}
                defaultValue={report.draft_text ?? ""}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className={primaryBtn}>
                Save
              </button>
              {report.status === "draft" && (
                <button
                  type="submit"
                  formAction={submitIcfrReportForReviewAction}
                  className={secondaryBtn}
                >
                  Submit for Review
                </button>
              )}
            </div>
          </form>
        </section>

        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">B. Review &amp; Approval Trail</h2>
          {reviews && reviews.length > 0 ? (
            <ul className="mb-4 divide-y divide-line">
              {reviews.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-paper">
                    {r.reviewer_name} — {r.reviewer_role}
                  </span>
                  <span className="text-mute">
                    {formatLabel(r.status)} {r.review_date ? `· ${r.review_date}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No reviews recorded yet.</p>
          )}
          <form action={addReviewApprovalAction} className="grid grid-cols-4 gap-2">
            <input type="hidden" name="targetType" value="icfr_report" />
            <input type="hidden" name="targetId" value={report.id} />
            <input type="hidden" name="returnPath" value="/dashboard/icfr-report" />
            <input className={inputClass} name="reviewer_name" placeholder="Reviewer name" />
            <input className={inputClass} name="reviewer_role" placeholder="Role" />
            <select className={inputClass} name="status" defaultValue="reviewed">
              <option value="reviewed">Reviewed</option>
              <option value="approved">Approved</option>
              <option value="noted">Noted</option>
            </select>
            <button type="submit" className={secondaryBtn}>
              Add
            </button>
          </form>
          {report.status === "under_review" && canApprove && (
            <form action={approveIcfrReportAction} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="reportId" value={report.id} />
              <button type="submit" className={primaryBtn}>
                Approve Final Report
              </button>
            </form>
          )}
        </section>

        <ChangeHistory entries={history ?? []} />
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        Management&apos;s Annual Report on ICFR Drafting Centre helps prepare and review draft
        disclosures related to internal control over financial reporting. It does not determine
        whether ICFR is effective, classify deficiencies, determine materiality, provide legal
        advice, or replace management&apos;s responsibility for the final ICFR report and
        disclosures. Management and, where applicable, the external auditor are responsible for
        all final conclusions and filings.
      </p>
    </div>
  );
}
