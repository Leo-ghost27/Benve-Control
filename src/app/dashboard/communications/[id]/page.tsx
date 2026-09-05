import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { ChangeHistory } from "@/components/dashboard/ChangeHistory";
import {
  updateCommunicationDraftAction,
  approveCommunicationAction,
  issueCommunicationAction,
  recordManagementResponseAction,
} from "@/lib/actions/communications";

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
  approved: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  issued: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

export default async function CommunicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();

  const supabase = await createClient();

  const { data: communication, error } = await supabase
    .from("communications")
    .select("*, deficiencies(id, title)")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();

  if (error || !communication) notFound();

  const deficiency = Array.isArray(communication.deficiencies)
    ? communication.deficiencies[0]
    : communication.deficiencies;

  const [{ data: responses }, { data: history }] = await Promise.all([
    supabase
      .from("management_responses")
      .select("id, response_text, responded_by, response_date, status")
      .eq("communication_id", id)
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

  const canApprove = ctx.role === "owner" || ctx.role === "admin" || ctx.role === "internal_auditor";
  const canRespond =
    ctx.role !== null &&
    ["owner", "admin", "internal_auditor", "cfo", "controller", "adviser"].includes(ctx.role);
  const isDraft = communication.status === "draft";
  const isApproved = communication.status === "approved";
  const isIssued = communication.status === "issued";

  return (
    <div className="mx-auto max-w-3xl p-8">
      {deficiency && (
        <Link
          href={`/dashboard/deficiencies/${deficiency.id}`}
          className="text-sm text-mute hover:text-paper"
        >
          &larr; Back to {deficiency.title}
        </Link>
      )}

      <div className="mt-4 mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Controlled Deficiency Communication
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          {communication.comm_ref || `Draft communication`}
        </h1>
        <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
        <span
          className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            statusStyles[communication.status] ?? statusStyles.draft
          }`}
        >
          {formatLabel(communication.status)}
        </span>
      </div>

      <div className="space-y-6">
        {/* Profile + draft text */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            A/B. Communication Profile &amp; Draft Text
          </h2>
          <form action={updateCommunicationDraftAction} className="space-y-4">
            <input type="hidden" name="communicationId" value={communication.id} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Audience</label>
                <input
                  className={inputClass}
                  name="audience"
                  defaultValue={communication.audience ?? ""}
                  disabled={!isDraft}
                />
              </div>
              <div>
                <label className={labelClass}>Communication type</label>
                <input
                  className={inputClass}
                  name="comm_type"
                  defaultValue={communication.comm_type ?? ""}
                  disabled={!isDraft}
                />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Confidentiality classification</label>
                <input
                  className={inputClass}
                  name="confidentiality"
                  defaultValue={communication.confidentiality ?? ""}
                  disabled={!isDraft}
                />
              </div>
              <div>
                <label className={labelClass}>Planned issue date</label>
                <input
                  className={inputClass}
                  type="date"
                  name="planned_issue_date"
                  defaultValue={communication.planned_issue_date ?? ""}
                  disabled={!isDraft}
                />
              </div>
              <div>
                <label className={labelClass}>Distribution method</label>
                <input
                  className={inputClass}
                  name="distribution_method"
                  defaultValue={communication.distribution_method ?? ""}
                  placeholder="Secure portal notification"
                  disabled={!isDraft}
                />
              </div>
              <div>
                <label className={labelClass}>Access period (days)</label>
                <input
                  className={inputClass}
                  type="number"
                  name="access_period_days"
                  defaultValue={communication.access_period_days ?? ""}
                  disabled={!isDraft}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Draft communication text</label>
              <textarea
                className={inputClass}
                name="draft_text"
                rows={10}
                defaultValue={communication.draft_text ?? ""}
                disabled={!isDraft}
                placeholder="Subject: ... Do not include internal reviewer notes, unapproved draft classifications, or confidential workpaper content."
              />
            </div>
            {isDraft && (
              <button type="submit" className={primaryBtn}>
                Save Draft
              </button>
            )}
          </form>
          {!isDraft && (
            <p className="mt-3 text-xs text-mute">
              This communication has been {communication.status} and can no longer be edited.
            </p>
          )}
        </section>

        {/* Approval and issue */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            C. Approval &amp; Secure Distribution
          </h2>
          {isDraft && canApprove && (
            <form action={approveCommunicationAction}>
              <input type="hidden" name="communicationId" value={communication.id} />
              <button type="submit" className={primaryBtn}>
                Approve for Issue
              </button>
            </form>
          )}
          {isApproved && (
            <div className="space-y-3">
              <p className="text-sm text-mute">
                Approved. Distribution: {communication.distribution_method || "not set"}, access
                period {communication.access_period_days ?? "—"} days.
              </p>
              {canApprove && (
                <form action={issueCommunicationAction}>
                  <input type="hidden" name="communicationId" value={communication.id} />
                  <button type="submit" className={primaryBtn}>
                    Issue Communication
                  </button>
                </form>
              )}
            </div>
          )}
          {isIssued && (
            <p className="text-sm text-paper">
              Issued securely on{" "}
              {communication.issued_at
                ? new Date(communication.issued_at).toLocaleDateString()
                : "—"}
              . Access is restricted to the authorised recipient group. This action was recorded
              in the audit trail below.
            </p>
          )}
        </section>

        {/* Management response */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Management Response</h2>
          {responses && responses.length > 0 ? (
            <ul className="mb-4 space-y-3">
              {responses.map((r) => (
                <li key={r.id} className="rounded-md border border-line bg-panel p-3 text-sm">
                  <p className="text-paper">{r.response_text}</p>
                  <p className="mt-1 text-xs text-mute">
                    {r.responded_by || "Management"} — {r.response_date} ({formatLabel(r.status)})
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No response recorded yet.</p>
          )}
          {isIssued && canRespond && (
            <form action={recordManagementResponseAction} className="space-y-3">
              <input type="hidden" name="communicationId" value={communication.id} />
              <div>
                <label className={labelClass}>Responded by</label>
                <input className={inputClass} name="responded_by" placeholder="Name, role" />
              </div>
              <div>
                <label className={labelClass}>Response</label>
                <textarea className={inputClass} name="response_text" rows={4} />
              </div>
              <button type="submit" className={secondaryBtn}>
                Record Management Response
              </button>
            </form>
          )}
        </section>

        <ChangeHistory entries={history ?? []} />
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        Controlled Deficiency Communication &amp; Remediation Assurance Pack helps prepare and
        track approved communications and remediation support related to SOX 404 / ICFR
        deficiencies. It does not determine required disclosures, provide legal advice, issue
        external-audit opinions, determine whether a material weakness exists, or replace
        management&apos;s ICFR assessment. The Engagement Lead and authorised client and
        governance stakeholders are responsible for final communications, disclosures,
        remediation decisions, and conclusions.
      </p>
    </div>
  );
}
