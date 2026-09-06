import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import {
  addCcmRuleAction,
  addCcmExceptionAction,
  updateCcmExceptionStatusAction,
  linkExceptionToDeficiencyAction,
  addFollowUpAction,
  updateFollowUpStatusAction,
} from "@/lib/actions/ccm";

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
  active: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  inactive: "border-line text-mute",
  open: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  in_review: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  in_progress: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  closed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

export default async function CcmPage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to set up continuous controls monitoring."
        />
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: rules }, { data: exceptions }, { data: followUps }] = await Promise.all([
    supabase
      .from("ccm_rules")
      .select("id, rule_ref, description, frequency, severity, status, controls(code, title)")
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("ccm_exceptions")
      .select(
        "id, exception_ref, item_date, source_record_ref, amount, initial_assessment, status, owner, linked_deficiency_id, controls(code, title), ccm_rules(rule_ref, description)"
      )
      .eq("organization_id", ctx.org.id)
      .order("item_date", { ascending: false }),
    supabase
      .from("follow_ups")
      .select(
        "id, followup_ref, owner, root_cause_draft, remediation_action, target_completion, status, ccm_exceptions(exception_ref)"
      )
      .eq("organization_id", ctx.org.id)
      .order("target_completion", { ascending: true }),
  ]);

  const openExceptions = (exceptions ?? []).filter((e) => e.status !== "closed").length;
  const activeRules = (rules ?? []).filter((r) => r.status === "active").length;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Continuous Controls Monitoring
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          CCM &amp; Exception Intelligence Hub
        </h1>
        <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{activeRules}</p>
          <p className="text-xs text-mute">Active CCM rules</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{openExceptions}</p>
          <p className="text-xs text-mute">Open exceptions</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">
            {(followUps ?? []).filter((f) => f.status !== "closed").length}
          </p>
          <p className="text-xs text-mute">Open follow-ups</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Rule library */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Rule Library</h2>
          {rules && rules.length > 0 ? (
            <div className="mb-4 overflow-hidden rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
                  <tr>
                    <th className="px-3 py-2 font-medium">Rule</th>
                    <th className="px-3 py-2 font-medium">Control</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Frequency</th>
                    <th className="px-3 py-2 font-medium">Severity</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-ink">
                  {rules.map((r) => {
                    const control = Array.isArray(r.controls) ? r.controls[0] : r.controls;
                    return (
                      <tr key={r.id}>
                        <td className="px-3 py-2 font-mono text-xs text-paper">{r.rule_ref}</td>
                        <td className="px-3 py-2 text-mute">
                          {control ? `${control.code} — ${control.title}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-mute">{r.description}</td>
                        <td className="px-3 py-2 text-mute">{r.frequency}</td>
                        <td className="px-3 py-2 text-mute">{formatLabel(r.severity)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              statusStyles[r.status] ?? statusStyles.active
                            }`}
                          >
                            {formatLabel(r.status)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mb-4 text-sm text-mute">No CCM rules configured yet.</p>
          )}
          <form action={addCcmRuleAction} className="grid grid-cols-3 gap-2">
            <input className={inputClass} name="rule_ref" placeholder="Rule ref (e.g. CCM-RULE-001)" />
            <input className={inputClass} name="control_id" placeholder="Control ID (optional)" />
            <input className={inputClass} name="frequency" placeholder="Frequency" />
            <input className={`${inputClass} col-span-2`} name="description" placeholder="Rule description" />
            <select className={inputClass} name="severity" defaultValue="medium">
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button type="submit" className={`${secondaryBtn} col-span-3`}>
              Add Rule
            </button>
          </form>
        </section>

        {/* Exception feed */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Exception Feed</h2>
          {exceptions && exceptions.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {exceptions.map((e) => {
                const control = Array.isArray(e.controls) ? e.controls[0] : e.controls;
                const rule = Array.isArray(e.ccm_rules) ? e.ccm_rules[0] : e.ccm_rules;
                return (
                  <li key={e.id} className="rounded-md border border-line bg-panel p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-paper">{e.exception_ref}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          statusStyles[e.status] ?? statusStyles.open
                        }`}
                      >
                        {formatLabel(e.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-paper">
                      {control ? `${control.code} — ${control.title}` : "—"}
                      {rule ? ` · ${rule.description}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-mute">
                      {e.item_date} · {e.source_record_ref} · {e.amount ? `$${e.amount}` : ""}
                    </p>
                    {e.initial_assessment && (
                      <p className="mt-1 text-xs text-mute">{e.initial_assessment}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {e.status !== "closed" && (
                        <>
                          <form action={updateCcmExceptionStatusAction}>
                            <input type="hidden" name="exceptionId" value={e.id} />
                            <input type="hidden" name="status" value="in_review" />
                            <button type="submit" className="text-xs text-signal hover:underline">
                              Investigate
                            </button>
                          </form>
                          <form action={updateCcmExceptionStatusAction}>
                            <input type="hidden" name="exceptionId" value={e.id} />
                            <input type="hidden" name="status" value="closed" />
                            <button type="submit" className="text-xs text-mute hover:text-paper">
                              Close
                            </button>
                          </form>
                        </>
                      )}
                      <form action={linkExceptionToDeficiencyAction} className="flex items-center gap-1">
                        <input type="hidden" name="exceptionId" value={e.id} />
                        <input
                          className="w-40 rounded border border-line bg-ink px-2 py-1 text-xs text-paper"
                          name="deficiencyId"
                          placeholder="Deficiency ID"
                          defaultValue={e.linked_deficiency_id ?? ""}
                        />
                        <button type="submit" className="text-xs text-signal hover:underline">
                          Link
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No exceptions flagged yet.</p>
          )}
          <form action={addCcmExceptionAction} className="grid grid-cols-3 gap-2">
            <input className={inputClass} name="exception_ref" placeholder="Exception ref" />
            <input className={inputClass} name="rule_id" placeholder="Rule ID (optional)" />
            <input className={inputClass} name="control_id" placeholder="Control ID (optional)" />
            <input className={inputClass} type="date" name="item_date" />
            <input className={inputClass} name="source_record_ref" placeholder="Source record ref" />
            <input className={inputClass} type="number" step="0.01" name="amount" placeholder="Amount" />
            <input className={inputClass} name="owner" placeholder="Owner" />
            <input
              className={`${inputClass} col-span-2`}
              name="initial_assessment"
              placeholder="Initial assessment"
            />
            <button type="submit" className={`${secondaryBtn} col-span-3`}>
              Flag Exception
            </button>
          </form>
        </section>

        {/* Follow-ups */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Follow-Up &amp; Escalation</h2>
          {followUps && followUps.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {followUps.map((f) => {
                const exception = Array.isArray(f.ccm_exceptions)
                  ? f.ccm_exceptions[0]
                  : f.ccm_exceptions;
                return (
                  <li key={f.id} className="rounded-md border border-line bg-panel p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-paper">
                        {f.followup_ref || f.id.slice(0, 8)}
                        {exception ? ` — ${exception.exception_ref}` : ""}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          statusStyles[f.status] ?? statusStyles.open
                        }`}
                      >
                        {formatLabel(f.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-mute">
                      Owner: {f.owner} · Target: {f.target_completion}
                    </p>
                    {f.root_cause_draft && (
                      <p className="mt-1 text-paper">Root cause: {f.root_cause_draft}</p>
                    )}
                    {f.remediation_action && (
                      <p className="mt-1 text-mute">Action: {f.remediation_action}</p>
                    )}
                    {f.status !== "closed" && (
                      <form action={updateFollowUpStatusAction} className="mt-2">
                        <input type="hidden" name="followUpId" value={f.id} />
                        <input type="hidden" name="status" value="closed" />
                        <button type="submit" className="text-xs text-signal hover:underline">
                          Mark Closed
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No follow-ups tracked yet.</p>
          )}
          <form action={addFollowUpAction} className="grid grid-cols-3 gap-2">
            <input className={inputClass} name="followup_ref" placeholder="Follow-up ref" />
            <input className={inputClass} name="ccmExceptionId" placeholder="Exception ID" />
            <input className={inputClass} name="owner" placeholder="Owner" />
            <input className={inputClass} type="date" name="target_completion" />
            <input className={`${inputClass} col-span-2`} name="root_cause_draft" placeholder="Root cause (draft)" />
            <textarea
              className={`${inputClass} col-span-3`}
              name="remediation_action"
              rows={2}
              placeholder="Remediation action"
            />
            <input
              className={`${inputClass} col-span-3`}
              name="escalation_rule"
              placeholder="Escalation rule (e.g. Escalate to CFO if overdue)"
            />
            <button type="submit" className={`${secondaryBtn} col-span-3`}>
              Add Follow-Up
            </button>
          </form>
        </section>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        Continuous Controls Monitoring &amp; Exception Intelligence Hub helps monitor controls and
        exceptions on an ongoing basis using illustrative rules and sample data. It does not
        automatically detect all control failures, determine control effectiveness, classify
        deficiencies, or issue audit conclusions. Management and the Benve auditor are responsible
        for all testing, evaluation, and conclusions.
      </p>
    </div>
  );
}
