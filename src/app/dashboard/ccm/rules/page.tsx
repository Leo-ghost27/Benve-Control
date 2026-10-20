import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { RULE_TRANSITIONS } from "@/lib/phase2/workflow";
import { SEVERITIES } from "@/lib/phase2/csv";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import {
  Banner, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th,
  cardClass, fmtDate, inputClass, labelClass, label, primaryBtn, secondaryBtn,
} from "@/components/phase2/ui";
import { saveCcmRuleAction, setRuleStatusAction } from "@/lib/actions/ccm";

type SP = { period?: string; status?: string; severity?: string; q?: string; edit?: string; notice?: string; error?: string };
const STATUSES = ["draft", "active", "inactive", "archived"];

export default async function RulesPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx, periods, period } = p2;
  const header = <PageHeader eyebrow="Continuous Controls Monitoring" title="Monitoring rules" subtitle={ctx.org.name} />;
  if (!can(ctx.role, "ccm.view_internal"))
    return <>{header}<PermissionDenied message="Monitoring rules are internal workpapers. External auditors and viewers see approved CCM summaries on the Overview tab." /></>;
  if (!period) return <>{header}<NoPeriod canCreate={can(ctx.role, "ccm.summary.review")} returnTo="/dashboard/ccm/rules" /></>;

  const supabase = await createClient();
  let query = supabase
    .from("ccm_rules")
    .select("id, rule_code, name, description, logic_summary, frequency, severity, status, owner_user_id, control_id, reporting_period_id, updated_at, controls(code, title)")
    .eq("organization_id", ctx.org.id)
    .order("rule_code", { ascending: true });
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.severity) query = query.eq("severity", searchParams.severity);
  if (searchParams.q) {
    const safe = searchParams.q.replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,rule_code.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  const [{ data: rules, error }, { data: controls }, members] = await Promise.all([
    query,
    supabase.from("controls").select("id, code, title").eq("organization_id", ctx.org.id).order("code"),
    loadMembers(supabase, ctx.org.id).catch(() => []),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;

  const editing = searchParams.edit ? (rules ?? []).find((r) => r.id === searchParams.edit) : undefined;
  const canCreate = can(ctx.role, "ccm.rule.create");
  const canEdit = can(ctx.role, "ccm.rule.edit");
  const here = withParams("/dashboard/ccm/rules", { period: period.id, status: searchParams.status, severity: searchParams.severity, q: searchParams.q });
  const last = (rules ?? []).map((r) => r.updated_at as string).sort().pop();
  const activeFilters = [searchParams.status, searchParams.severity, searchParams.q].filter(Boolean).length;

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/ccm/rules" keep={{ status: searchParams.status, severity: searchParams.severity, q: searchParams.q }} />

      <form method="get" action="/dashboard/ccm/rules" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="period" value={period.id} />
        <div><label className={labelClass} htmlFor="q">Search</label><input id="q" name="q" defaultValue={searchParams.q} placeholder="Code, name, description" className={`${inputClass} w-56`} /></div>
        <div><label className={labelClass} htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={searchParams.status ?? ""} className={inputClass}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="severity">Severity</label>
          <select id="severity" name="severity" defaultValue={searchParams.severity ?? ""} className={inputClass}><option value="">All</option>{SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <button className={secondaryBtn} type="submit">Apply filters</button>
        {activeFilters > 0 && <a className={secondaryBtn} href={withParams("/dashboard/ccm/rules", { period: period.id })}>Clear</a>}
        <a className={`${secondaryBtn} ml-auto`} href={withParams("/dashboard/ccm/export", { kind: "rules", period: period.id, status: searchParams.status, severity: searchParams.severity, q: searchParams.q })}>Export CSV</a>
      </form>

      {(canCreate || editing) && (
        <details open={!!editing} className={`${cardClass} mb-5`}>
          <summary className="cursor-pointer text-sm font-semibold text-paper">{editing ? `Edit ${editing.rule_code}` : "New rule"}</summary>
          <form action={saveCcmRuleAction} className="mt-4 grid grid-cols-3 gap-3">
            <input type="hidden" name="return_to" value={here} />
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <div><label className={labelClass} htmlFor="rule_code">Rule code *</label><input id="rule_code" name="rule_code" required defaultValue={editing?.rule_code ?? ""} className={inputClass} placeholder="CCM-001" /></div>
            <div className="col-span-2"><label className={labelClass} htmlFor="name">Name *</label><input id="name" name="name" required defaultValue={editing?.name ?? ""} className={inputClass} /></div>
            <div className="col-span-3"><label className={labelClass} htmlFor="description">Description</label><textarea id="description" name="description" rows={2} defaultValue={editing?.description ?? ""} className={inputClass} /></div>
            <div className="col-span-3"><label className={labelClass} htmlFor="logic_summary">Logic summary</label><textarea id="logic_summary" name="logic_summary" rows={2} defaultValue={editing?.logic_summary ?? ""} className={inputClass} placeholder="What the rule tests, in plain language" /></div>
            <div><label className={labelClass} htmlFor="control_id">Control</label>
              <select id="control_id" name="control_id" defaultValue={editing?.control_id ?? ""} className={inputClass}><option value="">None</option>{(controls ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="frequency">Frequency</label>
              <select id="frequency" name="frequency" defaultValue={editing?.frequency ?? ""} className={inputClass}><option value="">—</option>{["continuous", "daily", "weekly", "monthly", "quarterly"].map((f) => <option key={f} value={f}>{label(f)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="severity2">Severity</label>
              <select id="severity2" name="severity" defaultValue={editing?.severity ?? ""} className={inputClass}><option value="">—</option>{SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="owner_user_id">Rule owner</label>
              <select id="owner_user_id" name="owner_user_id" defaultValue={editing?.owner_user_id ?? ""} className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)} ({label(m.role)})</option>)}</select></div>
            <div><label className={labelClass} htmlFor="reporting_period_id">Introduced in period</label>
              <select id="reporting_period_id" name="reporting_period_id" defaultValue={editing?.reporting_period_id ?? period.id} className={inputClass}>{periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            <div className="flex items-end gap-2"><button className={primaryBtn} type="submit">{editing ? "Save changes" : "Create draft rule"}</button>
              {editing && <a className={secondaryBtn} href={here}>Cancel</a>}</div>
          </form>
        </details>
      )}

      {(rules ?? []).length === 0 ? (
        <EmptyState title={activeFilters ? "No rules match these filters" : "No monitoring rules yet"} description={activeFilters ? "Clear the filters to see all rules." : canCreate ? "Create a draft rule, then activate it when it is ready to monitor." : "An internal auditor, admin or owner can create rules."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Code</Th><Th>Name</Th><Th>Control</Th><Th>Frequency</Th><Th>Severity</Th><Th>Owner</Th><Th>Status</Th><Th>Updated</Th><Th>Actions</Th></tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {(rules ?? []).map((r) => {
              const ctl = Array.isArray(r.controls) ? r.controls[0] : r.controls;
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2 font-mono text-xs">{r.rule_code ?? "—"}</td>
                  <td className="px-3 py-2"><p className="text-paper">{r.name ?? "—"}</p>{r.logic_summary && <p className="mt-0.5 max-w-xs text-xs text-mute">{r.logic_summary}</p>}</td>
                  <td className="px-3 py-2 text-mute">{ctl ? `${ctl.code ?? ""} ${ctl.title ?? ""}` : "—"}</td>
                  <td className="px-3 py-2 text-mute">{label(r.frequency)}</td>
                  <td className="px-3 py-2"><StatusBadge value={r.severity} /></td>
                  <td className="px-3 py-2 text-mute">{memberName(members, r.owner_user_id)}</td>
                  <td className="px-3 py-2"><StatusBadge value={r.status} /></td>
                  <td className="px-3 py-2 text-mute">{fmtDate(r.updated_at)}</td>
                  <td className="px-3 py-2">
                    {canEdit && (
                      <div className="flex flex-wrap gap-1.5">
                        {r.status !== "archived" && <a className={secondaryBtn} href={withParams(here, { edit: r.id })}>Edit</a>}
                        {(RULE_TRANSITIONS[r.status] ?? []).map((to) => (
                          <form key={to} action={setRuleStatusAction}>
                            <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="from" value={r.status} /><input type="hidden" name="to" value={to} />
                            <button className={secondaryBtn} type="submit">{to === "active" ? (r.status === "inactive" ? "Reactivate" : "Activate") : to === "inactive" ? "Deactivate" : "Archive"}</button>
                          </form>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <div className="mt-3"><LastUpdated at={last} /></div>
    </>
  );
}
