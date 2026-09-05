import Link from "next/link";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import {
  updateAccessSettingsAction,
  addWalkthroughAction,
  addAuditCommunicationAction,
  closeAuditCommunicationAction,
} from "@/lib/actions/auditor-hub";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const cardClass = "rounded-xl border border-line bg-ink p-6";
const secondaryBtn =
  "rounded-md border border-line px-4 py-2 text-sm font-medium text-paper transition-colors hover:border-mute";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const statusStyles: Record<string, string> = {
  open: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  closed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  sent: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  accepted: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  clarification_requested: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

type EvidenceIndexRow = {
  control_id: string;
  control_code: string | null;
  control_title: string | null;
  process: string | null;
  risk_rating: string | null;
  mgmt_test_status: string | null;
  population_description: string | null;
  deficiency_id: string | null;
  deficiency_title: string | null;
  deficiency_classification: string | null;
  deficiency_rationale: string | null;
  deficiency_likelihood: string | null;
};

export default async function AuditorHubPage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to coordinate with an external auditor."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const isExternalAuditor = ctx.role === "external_auditor";
  const canManageSettings = ctx.role === "owner" || ctx.role === "admin";

  const [
    { data: evidenceIndex },
    { data: accessSettings },
    { data: walkthroughs },
    { data: evidenceRequests },
    { data: auditComms },
  ] = await Promise.all([
    supabase.rpc("auditor_evidence_index", { p_org_id: ctx.org.id }),
    supabase
      .from("access_settings")
      .select("*")
      .eq("organization_id", ctx.org.id)
      .maybeSingle(),
    supabase
      .from("walkthroughs")
      .select("id, control_id, walkthrough_date, participants, status, controls(code, title)")
      .eq("organization_id", ctx.org.id)
      .order("walkthrough_date", { ascending: false }),
    supabase
      .from("evidence_requests")
      .select("id, title, owner_name, due_date, status, priority, controls(code, title)")
      .eq("organization_id", ctx.org.id)
      .order("due_date", { ascending: true }),
    supabase
      .from("audit_communications")
      .select("id, comm_date, from_party, to_party, subject, body, status")
      .eq("organization_id", ctx.org.id)
      .order("comm_date", { ascending: false }),
  ]);

  const settings = accessSettings ?? {
    reviewer_notes_visible_to_auditor: false,
    draft_classifications_visible: false,
    sample_logic_visible: false,
  };

  const openRequests = (evidenceRequests ?? []).filter((r) => r.status !== "accepted").length;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Integrated Audit Coordination
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          External Auditor Attestation &amp; Coordination Hub
        </h1>
        <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
        {isExternalAuditor && (
          <p className="mt-3 rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-xs text-paper">
            You are viewing a controlled, read-only summary. Draft classifications and reviewer
            notes are shown only where the organization has explicitly enabled that visibility
            below.
          </p>
        )}
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{evidenceIndex?.length ?? 0}</p>
          <p className="text-xs text-mute">Controls in evidence index</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{openRequests}</p>
          <p className="text-xs text-mute">Open evidence requests</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">
            {(auditComms ?? []).filter((c) => c.status === "open").length}
          </p>
          <p className="text-xs text-mute">Open audit communications</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Evidence index */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            Auditor Evidence Index (Controlled View)
          </h2>
          {evidenceIndex && evidenceIndex.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
                  <tr>
                    <th className="px-3 py-2 font-medium">Control</th>
                    <th className="px-3 py-2 font-medium">Risk</th>
                    <th className="px-3 py-2 font-medium">Test status</th>
                    <th className="px-3 py-2 font-medium">Population</th>
                    <th className="px-3 py-2 font-medium">Deficiency</th>
                    <th className="px-3 py-2 font-medium">Classification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-ink">
                  {(evidenceIndex as EvidenceIndexRow[]).map((row) => (
                    <tr key={row.control_id}>
                      <td className="px-3 py-2 font-mono text-xs text-paper">
                        {row.control_code} — {row.control_title}
                      </td>
                      <td className="px-3 py-2 text-mute">{formatLabel(row.risk_rating)}</td>
                      <td className="px-3 py-2 text-mute">
                        {formatLabel(row.mgmt_test_status)}
                      </td>
                      <td className="px-3 py-2 text-mute">
                        {row.population_description || "—"}
                      </td>
                      <td className="px-3 py-2 text-mute">{row.deficiency_title || "—"}</td>
                      <td className="px-3 py-2 text-mute">
                        {formatLabel(row.deficiency_classification)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-mute">No controls in scope yet.</p>
          )}
        </section>

        {/* Access settings */}
        {canManageSettings && (
          <section className={cardClass}>
            <h2 className="mb-4 text-sm font-semibold text-paper">Controlled Access Settings</h2>
            <form action={updateAccessSettingsAction} className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-paper">
                <input
                  type="checkbox"
                  name="reviewer_notes_visible"
                  defaultChecked={settings.reviewer_notes_visible_to_auditor}
                  className="h-4 w-4 rounded border-line bg-panel accent-signal"
                />
                Internal reviewer notes visible to external auditor
              </label>
              <label className="flex items-center gap-2 text-sm text-paper">
                <input
                  type="checkbox"
                  name="draft_classifications_visible"
                  defaultChecked={settings.draft_classifications_visible}
                  className="h-4 w-4 rounded border-line bg-panel accent-signal"
                />
                Draft deficiency classifications visible to external auditor
              </label>
              <label className="flex items-center gap-2 text-sm text-paper">
                <input
                  type="checkbox"
                  name="sample_logic_visible"
                  defaultChecked={settings.sample_logic_visible}
                  className="h-4 w-4 rounded border-line bg-panel accent-signal"
                />
                Sample selection logic visible to external auditor
              </label>
              <button type="submit" className={`${secondaryBtn} mt-2`}>
                Save Settings
              </button>
            </form>
          </section>
        )}

        {/* Walkthroughs */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Walkthroughs</h2>
          {walkthroughs && walkthroughs.length > 0 ? (
            <ul className="mb-4 divide-y divide-line">
              {walkthroughs.map((w) => {
                const control = Array.isArray(w.controls) ? w.controls[0] : w.controls;
                return (
                  <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-paper">
                      {control ? `${control.code} — ${control.title}` : "Unlinked"}
                    </span>
                    <span className="text-mute">
                      {w.walkthrough_date} · {w.participants} · {formatLabel(w.status)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No walkthroughs recorded yet.</p>
          )}
          {!isExternalAuditor && (
            <form action={addWalkthroughAction} className="grid grid-cols-4 gap-2">
              <input className={inputClass} type="date" name="walkthrough_date" />
              <input className={inputClass} name="participants" placeholder="Participants" />
              <input type="hidden" name="status" value="complete" />
              <div className="col-span-2 flex gap-2">
                <input
                  className={inputClass}
                  name="control_id"
                  placeholder="Control ID (optional)"
                />
                <button type="submit" className={secondaryBtn}>
                  Add
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Evidence requests (reusing the existing evidence_requests workflow) */}
        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-paper">Requests for Additional Evidence</h2>
            <Link href="/dashboard/evidence-requests" className="text-xs text-signal hover:underline">
              Manage requests &rarr;
            </Link>
          </div>
          {evidenceRequests && evidenceRequests.length > 0 ? (
            <ul className="divide-y divide-line">
              {evidenceRequests.map((r) => {
                const control = Array.isArray(r.controls) ? r.controls[0] : r.controls;
                return (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <Link
                      href={`/dashboard/evidence-requests/${r.id}`}
                      className="text-paper hover:text-signal"
                    >
                      {r.title || (control ? `${control.code} — ${control.title}` : "Request")}
                    </Link>
                    <span className="flex items-center gap-2 text-mute">
                      {r.due_date}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          statusStyles[r.status] ?? statusStyles.sent
                        }`}
                      >
                        {formatLabel(r.status)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-mute">No evidence requests logged yet.</p>
          )}
        </section>

        {/* Audit communications */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            Audit Communications &amp; Findings
          </h2>
          {auditComms && auditComms.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {auditComms.map((c) => (
                <li key={c.id} className="rounded-md border border-line bg-panel p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-paper">
                      {c.subject} ({c.from_party} &rarr; {c.to_party})
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          statusStyles[c.status] ?? statusStyles.open
                        }`}
                      >
                        {formatLabel(c.status)}
                      </span>
                      {c.status === "open" && !isExternalAuditor && (
                        <form action={closeAuditCommunicationAction}>
                          <input type="hidden" name="communicationId" value={c.id} />
                          <button type="submit" className="text-xs text-mute hover:text-paper">
                            Close
                          </button>
                        </form>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-mute">{c.comm_date}</p>
                  {c.body && <p className="mt-2 text-paper">{c.body}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No audit communications logged yet.</p>
          )}
          <form action={addAuditCommunicationAction} className="grid grid-cols-2 gap-2">
            <input className={inputClass} name="from_party" placeholder="From" />
            <input className={inputClass} name="to_party" placeholder="To" />
            <input className={`${inputClass} col-span-2`} name="subject" placeholder="Subject" />
            <textarea
              className={`${inputClass} col-span-2`}
              name="body"
              rows={3}
              placeholder="Message"
            />
            <button type="submit" className={`${secondaryBtn} col-span-2`}>
              Log Communication
            </button>
          </form>
        </section>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        External Auditor Attestation &amp; Integrated Audit Coordination Hub helps coordinate
        evidence, requests, walkthroughs, and communications with the external auditor. It does
        not perform audit procedures, determine audit scope, classify deficiencies, issue audit
        opinions, or replace the external auditor&apos;s workpapers. The external auditor is
        responsible for their own risk assessment, testing, evaluation, and conclusions.
      </p>
    </div>
  );
}
