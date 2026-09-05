import Link from "next/link";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ChangeHistory } from "@/components/dashboard/ChangeHistory";
import {
  createCertificationAction,
  updateCertificationAction,
  addIcfrChangeAction,
  addSubCertificationAction,
  markSubCertificationSignedAction,
} from "@/lib/actions/certification";
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
  pending: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  signed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

export default async function CertificationPage({
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
          description="Join or create an organization to build a certification pack."
        />
      </div>
    );
  }

  const supabase = await createClient();

  const { data: allCerts } = await supabase
    .from("certifications")
    .select("id, period, status")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false });

  const selectedId = id ?? allCerts?.[0]?.id;

  if (!selectedId) {
    return (
      <div className="p-8">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-paper">
            SOX 302 Quarterly &amp; Annual Certification
          </h1>
          <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
        </div>
        <EmptyState
          title="No certification pack yet"
          description="Start a new period's CEO/CFO certification pack."
        />
        <form action={createCertificationAction} className="mt-4 flex max-w-sm gap-2">
          <input className={inputClass} name="period" placeholder="e.g. Q3 2026" required />
          <button type="submit" className={primaryBtn}>
            Start
          </button>
        </form>
      </div>
    );
  }

  const [{ data: certification }, { data: changes }, { data: subCerts }, { data: reviews }, { data: history }] =
    await Promise.all([
      supabase
        .from("certifications")
        .select("*")
        .eq("id", selectedId)
        .eq("organization_id", ctx.org.id)
        .single(),
      supabase
        .from("icfr_changes")
        .select("id, description, remediation_status, dcp_impact")
        .eq("certification_id", selectedId)
        .eq("organization_id", ctx.org.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("sub_certifications")
        .select("id, name, role, area, status, signed_date")
        .eq("certification_id", selectedId)
        .eq("organization_id", ctx.org.id)
        .order("name", { ascending: true }),
      supabase
        .from("review_approvals")
        .select("id, reviewer_name, reviewer_role, status, review_date")
        .eq("target_type", "certification")
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

  if (!certification) {
    return (
      <div className="p-8">
        <EmptyState title="Not found" description="This certification pack could not be found." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">SOX 302</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
            {certification.period} Certification Pack
          </h1>
          <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
          <span
            className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              statusStyles[certification.status] ?? statusStyles.draft
            }`}
          >
            {formatLabel(certification.status)}
          </span>
        </div>
        <form action={createCertificationAction} className="flex gap-2">
          <input className={inputClass} name="period" placeholder="New period" required />
          <button type="submit" className={secondaryBtn}>
            + Start Period
          </button>
        </form>
      </div>

      {allCerts && allCerts.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {allCerts.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/certification?id=${c.id}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                c.id === selectedId
                  ? "border-signal bg-signal/15 text-paper"
                  : "border-line text-mute hover:text-paper"
              }`}
            >
              {c.period} · {formatLabel(c.status)}
            </Link>
          ))}
        </div>
      )}

      <div className="space-y-6">
        {/* DC&P evaluation + draft cert text */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            Disclosure Controls &amp; Procedures Evaluation
          </h2>
          <form action={updateCertificationAction} className="space-y-4">
            <input type="hidden" name="certificationId" value={certification.id} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Evaluation period</label>
                <input
                  className={inputClass}
                  name="dcp_evaluation_period"
                  defaultValue={certification.dcp_evaluation_period ?? ""}
                />
              </div>
              <div>
                <label className={labelClass}>Evaluated by</label>
                <input
                  className={inputClass}
                  name="dcp_evaluated_by"
                  defaultValue={certification.dcp_evaluated_by ?? ""}
                  placeholder="CFO, Controller, General Counsel"
                />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Evaluation methodology</label>
                <textarea
                  className={inputClass}
                  name="dcp_methodology"
                  rows={2}
                  defaultValue={certification.dcp_methodology ?? ""}
                />
              </div>
              <div>
                <label className={labelClass}>DC&amp;P effectiveness conclusion</label>
                <select
                  className={inputClass}
                  name="dcp_conclusion"
                  defaultValue={certification.dcp_conclusion ?? ""}
                >
                  <option value="">— Select —</option>
                  <option value="effective">Effective</option>
                  <option value="not_effective">Not effective</option>
                  <option value="in_progress">Evaluation in progress — not final</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Rationale</label>
              <textarea
                className={inputClass}
                name="dcp_rationale"
                rows={3}
                defaultValue={certification.dcp_rationale ?? ""}
              />
            </div>
            <div>
              <label className={labelClass}>Draft certification text (illustrative)</label>
              <textarea
                className={inputClass}
                name="draft_text"
                rows={8}
                defaultValue={certification.draft_text ?? ""}
              />
            </div>
            <button type="submit" className={primaryBtn}>
              Save
            </button>
          </form>
        </section>

        {/* ICFR changes */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            Changes in ICFR During the Period
          </h2>
          {changes && changes.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {changes.map((c) => (
                <li key={c.id} className="rounded-md border border-line bg-panel p-3 text-sm">
                  <p className="text-paper">{c.description}</p>
                  <p className="mt-1 text-xs text-mute">
                    Remediation: {c.remediation_status || "—"} · DC&amp;P impact:{" "}
                    {c.dcp_impact || "—"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No ICFR changes recorded for this period.</p>
          )}
          <form action={addIcfrChangeAction} className="grid grid-cols-3 gap-2">
            <input type="hidden" name="certificationId" value={certification.id} />
            <input className={inputClass} name="description" placeholder="Change description" />
            <input className={inputClass} name="remediation_status" placeholder="Remediation status" />
            <div className="flex gap-2">
              <input className={inputClass} name="dcp_impact" placeholder="DC&P impact" />
              <button type="submit" className={secondaryBtn}>
                Add
              </button>
            </div>
          </form>
        </section>

        {/* Sub-certifications */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Sub-Certifications</h2>
          {subCerts && subCerts.length > 0 ? (
            <ul className="mb-4 divide-y divide-line">
              {subCerts.map((sc) => (
                <li key={sc.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-paper">
                    {sc.name} — {sc.role} ({sc.area})
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        statusStyles[sc.status] ?? statusStyles.pending
                      }`}
                    >
                      {formatLabel(sc.status)}
                    </span>
                    {sc.status === "pending" && (
                      <form action={markSubCertificationSignedAction}>
                        <input type="hidden" name="subCertificationId" value={sc.id} />
                        <button type="submit" className="text-xs text-signal hover:underline">
                          Mark signed
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No sub-certifications requested yet.</p>
          )}
          <form action={addSubCertificationAction} className="grid grid-cols-4 gap-2">
            <input type="hidden" name="certificationId" value={certification.id} />
            <input className={inputClass} name="name" placeholder="Name" />
            <input className={inputClass} name="role" placeholder="Role" />
            <div className="flex gap-2">
              <input className={inputClass} name="area" placeholder="Area" />
              <button type="submit" className={secondaryBtn}>
                Add
              </button>
            </div>
          </form>
        </section>

        {/* Review trail */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Review &amp; Approval</h2>
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
            <input type="hidden" name="targetType" value="certification" />
            <input type="hidden" name="targetId" value={certification.id} />
            <input type="hidden" name="returnPath" value="/dashboard/certification" />
            <input className={inputClass} name="reviewer_name" placeholder="Reviewer name" />
            <input className={inputClass} name="reviewer_role" placeholder="Role" />
            <select className={inputClass} name="status" defaultValue="approved">
              <option value="approved">Approved</option>
              <option value="reviewed">Reviewed</option>
              <option value="noted">Noted</option>
              <option value="pending">Pending</option>
            </select>
            <button type="submit" className={secondaryBtn}>
              Add
            </button>
          </form>
        </section>

        <ChangeHistory entries={history ?? []} />
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        SOX 302 Quarterly &amp; Annual Certification Pack helps prepare and review evidence and
        drafts that support CEO/CFO certifications. It does not determine certification
        requirements, provide legal advice, file certifications, or replace management&apos;s
        responsibility for the final certifications and disclosures. Management is responsible
        for all final conclusions and filings.
      </p>
    </div>
  );
}
