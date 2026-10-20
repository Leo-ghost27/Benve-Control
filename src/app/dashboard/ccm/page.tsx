import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { lastMonths, monthKey } from "@/lib/phase2/ccm-queries";
import { SUMMARY_TRANSITIONS } from "@/lib/phase2/workflow";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import {
  Banner, KpiLink, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge,
  TableShell, Th, cardClass, fmtDateTime, inputClass, primaryBtn, secondaryBtn, label,
} from "@/components/phase2/ui";
import { createCcmSummaryAction, transitionCcmSummaryAction } from "@/lib/actions/ccm";

type SP = { period?: string; notice?: string; error?: string };

type Snapshot = {
  generated_at?: string;
  data_scope?: string;
  exceptions_total?: number;
  exceptions_by_status?: Record<string, number>;
  exceptions_by_severity?: Record<string, number>;
  exceptions_linked_to_deficiency?: number;
  rules_by_status?: Record<string, number>;
  follow_ups_total?: number;
  follow_ups_open?: number;
  follow_ups_overdue?: number;
};

export default async function CcmOverviewPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try {
    p2 = await getPhase2Context(searchParams.period);
  } catch (e) {
    return <ErrorState message={(e as Error).message} />;
  }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization to set up continuous controls monitoring." />;
  const { ctx, periods, period } = p2;
  const supabase = await createClient();
  const internal = can(ctx.role, "ccm.view_internal");
  const summaryOnly = can(ctx.role, "ccm.view_summary");

  const header = (
    <PageHeader eyebrow="Continuous Controls Monitoring" title="CCM & Exception Intelligence" subtitle={ctx.org.name} />
  );

  if (!internal && !summaryOnly) return <>{header}<PermissionDenied /></>;
  if (periods.length === 0 || !period) {
    return <>{header}<Banner notice={searchParams.notice} error={searchParams.error} /><NoPeriod canCreate={can(ctx.role, "ccm.summary.review")} returnTo="/dashboard/ccm" /></>;
  }

  const base = `/dashboard/ccm`;
  const here = withParams(base, { period: period.id });

  // ---- External auditor / viewer: approved summaries only (RLS enforces too) ----
  if (!internal) {
    const { data: sums, error } = await supabase
      .from("ccm_summaries")
      .select("id, status, snapshot, approved_at, reporting_period_id")
      .eq("organization_id", ctx.org.id)
      .eq("reporting_period_id", period.id)
      .eq("status", "approved")
      .order("approved_at", { ascending: false });
    if (error) return <>{header}<ErrorState message={error.message} /></>;
    return (
      <>
        {header}
        <PeriodBar periods={periods} current={period} action={base} />
        <p className="mb-4 text-xs text-mute">You are viewing approved CCM summaries only. Underlying exceptions, drafts and internal notes are not shared.</p>
        {!sums || sums.length === 0 ? (
          <EmptyState title="No approved CCM summary for this period" description="Management hasn't approved a CCM summary for this reporting period yet." />
        ) : (
          sums.map((s) => <SummaryCard key={s.id} snapshot={s.snapshot as Snapshot} status={s.status} approvedAt={s.approved_at} period={period.label} />)
        )}
      </>
    );
  }

  // ---- Internal view -------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const [excRes, rulesRes, fuRes, sumRes, batchRes] = await Promise.all([
    supabase.from("ccm_exceptions").select("id, status, severity, detected_at, updated_at, assigned_to").eq("organization_id", ctx.org.id).eq("reporting_period_id", period.id),
    supabase.from("ccm_rules").select("id, status, updated_at").eq("organization_id", ctx.org.id),
    supabase.from("follow_ups").select("id, status, due_date, escalation_status, updated_at, ccm_exceptions!inner(reporting_period_id)").eq("organization_id", ctx.org.id).eq("ccm_exceptions.reporting_period_id", period.id),
    supabase.from("ccm_summaries").select("id, status, snapshot, review_note, updated_at, approved_at, created_at").eq("organization_id", ctx.org.id).eq("reporting_period_id", period.id).order("created_at", { ascending: false }),
    supabase.from("ccm_import_batches").select("id, status").eq("organization_id", ctx.org.id).eq("status", "pending_approval"),
  ]);
  const firstError = [excRes, rulesRes, fuRes, sumRes, batchRes].find((r) => r.error)?.error;
  if (firstError) return <>{header}<ErrorState message={firstError.message} /></>;

  const exc = excRes.data ?? [];
  const rules = rulesRes.data ?? [];
  const fus = fuRes.data ?? [];
  const sums = sumRes.data ?? [];
  const openExc = exc.filter((e) => !["closed", "false_positive", "linked"].includes(e.status));
  const openFu = fus.filter((f) => f.status !== "closed");
  const overdueFu = openFu.filter((f) => f.due_date && f.due_date < today);
  const escalations = fus.filter((f) => f.escalation_status === "requested");
  const unassigned = openExc.filter((e) => !e.assigned_to);
  const months = lastMonths(6);
  const byMonth = months.map((m) => ({ m, n: exc.filter((e) => monthKey(e.detected_at) === m).length }));
  const maxN = Math.max(1, ...byMonth.map((b) => b.n));
  const lastUpdated = [...exc, ...rules, ...fus, ...sums].map((r) => r.updated_at as string).filter(Boolean).sort().pop();
  const canPrepare = can(ctx.role, "ccm.summary.prepare");
  const canReview = can(ctx.role, "ccm.summary.review");
  const L = (extra: Record<string, string>) => withParams("/dashboard/ccm/exceptions", { period: period.id, ...extra });

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action={base} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiLink href={withParams("/dashboard/ccm/rules", { period: period.id, status: "active" })} value={rules.filter((r) => r.status === "active").length} label="Active rules" />
        <KpiLink href={L({ status: "open" })} value={exc.filter((e) => e.status === "open").length} label="Open exceptions" tone="warn" />
        <KpiLink href={L({ assigned: "unassigned" })} value={unassigned.length} label="Unassigned (open)" tone={unassigned.length ? "warn" : undefined} />
        <KpiLink href={withParams("/dashboard/ccm/follow-ups", { period: period.id, overdue: "1" })} value={overdueFu.length} label="Overdue follow-ups" tone={overdueFu.length ? "crit" : undefined} />
        <KpiLink href={L({ status: "in_investigation" })} value={exc.filter((e) => e.status === "in_investigation").length} label="In investigation" />
        <KpiLink href={L({ status: "linked" })} value={exc.filter((e) => e.status === "linked").length} label="Linked to formal items" />
        <KpiLink href={L({ status: "false_positive" })} value={exc.filter((e) => e.status === "false_positive").length} label="False positives" />
        <KpiLink href={withParams("/dashboard/ccm/follow-ups", { period: period.id, escalation: "requested" })} value={escalations.length} label="Escalations awaiting approval" tone={escalations.length ? "warn" : undefined} />
      </div>

      {(batchRes.data?.length ?? 0) > 0 && canReview && (
        <p className="mb-4 rounded-md border border-amber-900/50 bg-amber-950/20 px-4 py-2 text-sm text-amber-300">
          {batchRes.data!.length} CSV import batch(es) awaiting approval. <a className="underline" href={withParams("/dashboard/ccm/import", { period: period.id })}>Review imports</a>
        </p>
      )}

      <section className={`${cardClass} mb-6`}>
        <h2 className="mb-1 text-sm font-semibold text-paper">Exceptions detected per month</h2>
        <p className="mb-4 text-xs text-mute">From recorded exceptions in {period.label}. Select a bar to open the matching records.</p>
        {exc.length === 0 ? (
          <EmptyState title="No exceptions recorded for this period" description="Record one manually or import a CSV to start building trend data." action={{ label: "Record an exception", href: withParams("/dashboard/ccm/exceptions", { period: period.id }) }} />
        ) : (
          <div className="flex h-36 items-end gap-3" role="img" aria-label="Exceptions detected per month">
            {byMonth.map((b) => (
              <a key={b.m} href={L({ month: b.m })} className="group flex flex-1 flex-col items-center gap-1" title={`${b.m}: ${b.n}`}>
                <span className="text-xs tabular-nums text-mute">{b.n}</span>
                <span className="w-full rounded-t bg-signal/70 transition-colors group-hover:bg-signal" style={{ height: `${Math.max(2, (b.n / maxN) * 100)}%` }} />
                <span className="text-[10px] text-mute">{b.m}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className={cardClass}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-paper">Approved-view summary for {period.label}</h2>
            <p className="text-xs text-mute">External auditors and viewers can only see a summary once it is approved by a controller or CFO.</p>
          </div>
          {canPrepare && (
            <form action={createCcmSummaryAction}>
              <input type="hidden" name="return_to" value={here} />
              <input type="hidden" name="reporting_period_id" value={period.id} />
              <button className={primaryBtn} type="submit">Snapshot current data</button>
            </form>
          )}
        </div>
        {sums.length === 0 ? (
          <p className="text-sm text-mute">No summary has been prepared for this period.</p>
        ) : (
          <TableShell>
            <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
              <tr><Th>Generated</Th><Th>Status</Th><Th>Exceptions</Th><Th>Review note</Th><Th>Actions</Th></tr>
            </thead>
            <tbody className="divide-y divide-line bg-ink">
              {sums.map((s) => {
                const snap = s.snapshot as Snapshot;
                const next = SUMMARY_TRANSITIONS[s.status] ?? [];
                return (
                  <tr key={s.id} className="align-top">
                    <td className="px-3 py-2 text-mute">{fmtDateTime(snap.generated_at ?? s.created_at)}</td>
                    <td className="px-3 py-2"><StatusBadge value={s.status} /></td>
                    <td className="px-3 py-2 tabular-nums">{snap.exceptions_total ?? 0}</td>
                    <td className="px-3 py-2 text-mute">{s.review_note ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-2">
                        {next.map((to) => {
                          const reviewTo = ["approved", "returned", "reopened"].includes(to);
                          if (reviewTo ? !canReview : !canPrepare) return null;
                          const needsNote = to === "returned" || to === "reopened";
                          return (
                            <form key={to} action={transitionCcmSummaryAction} className="flex items-center gap-2">
                              <input type="hidden" name="return_to" value={here} />
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="from" value={s.status} />
                              <input type="hidden" name="to" value={to} />
                              {needsNote && <input name="review_note" required minLength={5} placeholder="Review note (required)" className={`${inputClass} w-48`} />}
                              <button className={secondaryBtn} type="submit">{label(to)}</button>
                            </form>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
        <div className="mt-3"><LastUpdated at={lastUpdated} /></div>
      </section>
    </>
  );
}

function SummaryCard({ snapshot, status, approvedAt, period }: { snapshot: Snapshot; status: string; approvedAt: string | null; period: string }) {
  const row = (title: string, obj?: Record<string, number>) => (
    <div>
      <p className="mb-1 text-xs font-medium text-mute">{title}</p>
      {obj && Object.keys(obj).length ? (
        <ul className="text-sm text-paper">{Object.entries(obj).map(([k, v]) => <li key={k}>{label(k)}: <span className="tabular-nums">{v}</span></li>)}</ul>
      ) : <p className="text-sm text-mute">None</p>}
    </div>
  );
  return (
    <section className={`${cardClass} mb-4`}>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-paper">CCM summary — {period}</h2>
        <StatusBadge value={status} />
      </div>
      <div className="grid grid-cols-3 gap-6">
        {row("Exceptions by status", snapshot.exceptions_by_status)}
        {row("Exceptions by severity", snapshot.exceptions_by_severity)}
        {row("Rules by status", snapshot.rules_by_status)}
      </div>
      <p className="mt-4 text-sm text-paper">
        {snapshot.exceptions_total ?? 0} exceptions · {snapshot.exceptions_linked_to_deficiency ?? 0} linked to deficiencies · {snapshot.follow_ups_open ?? 0} open follow-ups ({snapshot.follow_ups_overdue ?? 0} overdue)
      </p>
      <p className="mt-2 text-[11px] text-mute">Approved {fmtDateTime(approvedAt)} · Generated {fmtDateTime(snapshot.generated_at)} · Scope: {snapshot.data_scope}</p>
    </section>
  );
}
