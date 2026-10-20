import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { applyExceptionFilters, EXCEPTION_COLUMNS, loadMembers, memberName, type ExceptionFilters } from "@/lib/phase2/ccm-queries";
import { SEVERITIES } from "@/lib/phase2/csv";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDate, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { recordExceptionAction } from "@/lib/actions/ccm";

type SP = ExceptionFilters & { notice?: string; error?: string };
const STATUSES = ["open", "in_investigation", "false_positive", "linked", "closed"];

type Row = {
  id: string; exception_ref: string | null; detected_at: string; source_record_ref: string | null; description: string | null;
  severity: string | null; status: string; source_type: string; assigned_to: string | null; amount: number | null;
  linked_deficiency_id: string | null; linked_exception_id: string | null; updated_at: string;
  ccm_rules: { rule_code: string | null; name: string | null } | { rule_code: string | null; name: string | null }[] | null;
  controls: { code: string | null; title: string | null } | { code: string | null; title: string | null }[] | null;
};
const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);

export default async function ExceptionsPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx, periods, period } = p2;
  const header = <PageHeader eyebrow="Continuous Controls Monitoring" title="Exceptions" subtitle={ctx.org.name} />;
  if (!can(ctx.role, "ccm.view_internal"))
    return <>{header}<PermissionDenied message="Individual CCM exceptions are internal workpapers. External auditors and viewers see approved CCM summaries on the Overview tab." /></>;
  if (!period) return <>{header}<NoPeriod canCreate={can(ctx.role, "ccm.summary.review")} returnTo="/dashboard/ccm/exceptions" /></>;

  const filters: ExceptionFilters = { ...searchParams, period: period.id };
  const supabase = await createClient();
  const [{ data, error }, { data: rules }, { data: controls }, members] = await Promise.all([
    applyExceptionFilters(supabase.from("ccm_exceptions").select(EXCEPTION_COLUMNS).eq("organization_id", ctx.org.id), filters).order("detected_at", { ascending: false }).limit(500),
    supabase.from("ccm_rules").select("id, rule_code, name, status").eq("organization_id", ctx.org.id).neq("status", "archived").order("rule_code"),
    supabase.from("controls").select("id, code, title").eq("organization_id", ctx.org.id).order("code"),
    loadMembers(supabase, ctx.org.id).catch(() => []),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = (data ?? []) as unknown as Row[];
  const canWrite = can(ctx.role, "ccm.exception.write");
  const filterKeys = ["status", "severity", "rule", "assigned", "source", "month", "q"] as const;
  const active = filterKeys.filter((k) => searchParams[k]);
  const activeParams = Object.fromEntries(active.map((k) => [k, searchParams[k]]));
  const here = withParams("/dashboard/ccm/exceptions", { period: period.id, ...activeParams });
  const exportHref = withParams("/dashboard/ccm/export", { kind: "exceptions", period: period.id, ...activeParams });

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/ccm/exceptions" keep={activeParams} />

      <form method="get" action="/dashboard/ccm/exceptions" className="mb-4 grid grid-cols-2 items-end gap-3 md:grid-cols-4 lg:grid-cols-8">
        <input type="hidden" name="period" value={period.id} />
        <div className="col-span-2"><label className={labelClass} htmlFor="q">Search</label><input id="q" name="q" defaultValue={searchParams.q} placeholder="Description, source, ref" className={inputClass} /></div>
        <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={searchParams.status ?? ""} className={inputClass}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="severity">Severity</label><select id="severity" name="severity" defaultValue={searchParams.severity ?? ""} className={inputClass}><option value="">All</option>{SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="rule">Rule</label><select id="rule" name="rule" defaultValue={searchParams.rule ?? ""} className={inputClass}><option value="">All</option>{(rules ?? []).map((r) => <option key={r.id} value={r.id}>{r.rule_code}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="assigned">Owner</label><select id="assigned" name="assigned" defaultValue={searchParams.assigned ?? ""} className={inputClass}><option value="">All</option><option value="unassigned">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="source">Source</label><select id="source" name="source" defaultValue={searchParams.source ?? ""} className={inputClass}><option value="">All</option><option value="manual">Manual entry</option><option value="csv_import">CSV import</option></select></div>
        <div className="flex gap-2"><button className={secondaryBtn} type="submit">Apply</button>{active.length > 0 && <a className={secondaryBtn} href={withParams("/dashboard/ccm/exceptions", { period: period.id })}>Clear</a>}</div>
      </form>
      {searchParams.month && <p className="mb-3 text-xs text-mute">Filtered to detections in {searchParams.month}.</p>}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-mute">{rows.length} record{rows.length === 1 ? "" : "s"}{active.length ? ` · ${active.length} filter${active.length === 1 ? "" : "s"} applied` : ""}{rows.length === 500 ? " (showing first 500)" : ""}</p>
        <a className={secondaryBtn} href={exportHref}>Export these results (CSV)</a>
      </div>

      {canWrite && (
        <details className={`${cardClass} mb-5`}>
          <summary className="cursor-pointer text-sm font-semibold text-paper">Record an exception manually</summary>
          <form action={recordExceptionAction} className="mt-4 grid grid-cols-3 gap-3">
            <input type="hidden" name="return_to" value={here} />
            <input type="hidden" name="reporting_period_id" value={period.id} />
            <div><label className={labelClass} htmlFor="source_record_ref">Source reference *</label><input id="source_record_ref" name="source_record_ref" required className={inputClass} placeholder="e.g. INV-10442" /></div>
            <div><label className={labelClass} htmlFor="n_rule">Rule</label><select id="n_rule" name="rule_id" className={inputClass}><option value="">None</option>{(rules ?? []).map((r) => <option key={r.id} value={r.id}>{r.rule_code} — {r.name}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="n_control">Control</label><select id="n_control" name="control_id" className={inputClass}><option value="">None</option>{(controls ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></div>
            <div className="col-span-3"><label className={labelClass} htmlFor="n_desc">Description *</label><textarea id="n_desc" name="description" required rows={2} className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="n_sev">Severity</label><select id="n_sev" name="severity" className={inputClass}><option value="">—</option>{SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="n_amt">Amount</label><input id="n_amt" name="amount" inputMode="decimal" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="n_assign">Assign owner</label><select id="n_assign" name="assigned_to" className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
            <div className="col-span-3"><button className={primaryBtn} type="submit">Record exception</button></div>
          </form>
        </details>
      )}

      {rows.length === 0 ? (
        <EmptyState title={active.length ? "No exceptions match these filters" : `No exceptions recorded for ${period.label}`} description={active.length ? "Clear the filters to see everything in this period." : canWrite ? "Record one above, or import a CSV on the Import tab." : "An internal auditor can record or import exceptions."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Detected</Th><Th>Source</Th><Th>Description</Th><Th>Rule / control</Th><Th>Severity</Th><Th>Status</Th><Th>Owner</Th><Th>Origin</Th></tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {rows.map((r) => {
              const rule = one(r.ccm_rules); const ctl = one(r.controls);
              return (
                <tr key={r.id} className="align-top hover:bg-panel/50">
                  <td className="px-3 py-2 text-mute">{fmtDate(r.detected_at)}</td>
                  <td className="px-3 py-2"><Link className="text-signal hover:underline" href={withParams(`/dashboard/ccm/exceptions/${r.id}`, { period: period.id })}>{r.source_record_ref ?? r.exception_ref ?? r.id.slice(0, 8)}</Link></td>
                  <td className="max-w-sm px-3 py-2 text-paper">{r.description ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-mute">{rule?.rule_code ?? "—"}<br />{ctl ? ctl.code : ""}</td>
                  <td className="px-3 py-2"><StatusBadge value={r.severity} /></td>
                  <td className="px-3 py-2"><StatusBadge value={r.status} /></td>
                  <td className="px-3 py-2 text-mute">{memberName(members, r.assigned_to)}</td>
                  <td className="px-3 py-2 text-xs text-mute">{r.source_type === "csv_import" ? "CSV import" : "Manual"}</td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <div className="mt-3"><LastUpdated at={rows.map((r) => r.updated_at).sort().pop()} /></div>
    </>
  );
}
