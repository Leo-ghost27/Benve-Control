import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDateTime, inputClass, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { decideCcmImportAction, stageCcmImportAction } from "@/lib/actions/ccm";
import type { RowError } from "@/lib/phase2/csv";

type SP = { period?: string; notice?: string; error?: string; batch?: string };

export default async function ImportPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx, periods, period } = p2;
  const header = <PageHeader eyebrow="Continuous Controls Monitoring" title="CSV import" subtitle="Imported data is staged, labelled with its source, and only becomes exceptions after a controller/CFO approves it." />;
  if (!can(ctx.role, "ccm.view_internal")) return <>{header}<PermissionDenied /></>;
  if (!period) return <>{header}<NoPeriod canCreate={can(ctx.role, "ccm.summary.review")} returnTo="/dashboard/ccm/import" /></>;

  const supabase = await createClient();
  const [{ data: batches, error }, members] = await Promise.all([
    supabase.from("ccm_import_batches").select("id, source_system, file_name, imported_by, imported_at, total_rows, valid_rows, invalid_rows, validation_status, status, errors, approved_by, approved_at, updated_at").eq("organization_id", ctx.org.id).eq("reporting_period_id", period.id).order("imported_at", { ascending: false }),
    loadMembers(supabase, ctx.org.id).catch(() => []),
  ]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const canImport = can(ctx.role, "ccm.import.create");
  const canApprove = can(ctx.role, "ccm.import.approve");
  const here = `/dashboard/ccm/import?period=${period.id}`;

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/ccm/import" />

      {canImport && (
        <section className={`${cardClass} mb-6`}>
          <h2 className="mb-1 text-sm font-semibold text-paper">Upload a CSV</h2>
          <p className="mb-4 text-xs text-mute">
            Required columns: <code>source_reference</code>, <code>description</code>. Optional: <code>severity</code> (low/medium/high/critical), <code>detected_at</code>, <code>amount</code>, <code>rule_code</code>, <code>control_code</code>, <code>exception_ref</code>. Max 2 MB / 2,000 rows. Invalid rows are reported with line numbers and excluded.
          </p>
          <form action={stageCcmImportAction} className="grid grid-cols-3 items-end gap-3" encType="multipart/form-data">
            <input type="hidden" name="return_to" value={here} /><input type="hidden" name="reporting_period_id" value={period.id} />
            <div><label className={labelClass} htmlFor="source_system">Source system *</label><input id="source_system" name="source_system" required placeholder="e.g. NetSuite AP export" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="file">CSV file *</label><input id="file" name="file" type="file" accept=".csv,text/csv" required className={inputClass} /></div>
            <div><button className={primaryBtn} type="submit">Validate and stage</button></div>
          </form>
        </section>
      )}

      {(batches ?? []).length === 0 ? (
        <EmptyState title="No imports for this period" description={canImport ? "Upload a CSV above to stage exceptions for approval." : "An internal auditor can import exceptions from CSV."} />
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Source / file</Th><Th>Imported</Th><Th>Rows (valid / invalid)</Th><Th>Validation</Th><Th>Approval</Th><Th>Actions</Th></tr></thead>
          <tbody className="divide-y divide-line bg-ink">
            {(batches ?? []).map((b) => {
              const errs = (b.errors ?? []) as RowError[];
              return (
                <tr key={b.id} className="align-top">
                  <td className="px-3 py-2"><p className="text-paper">{b.source_system}</p><p className="text-xs text-mute">{b.file_name}</p></td>
                  <td className="px-3 py-2 text-mute">{fmtDateTime(b.imported_at)}<br />by {memberName(members, b.imported_by)}</td>
                  <td className="px-3 py-2 tabular-nums">{b.total_rows} ({b.valid_rows} / {b.invalid_rows})
                    {errs.length > 0 && <details className="mt-1 text-xs text-mute"><summary className="cursor-pointer">Show row errors</summary><ul className="mt-1 max-w-md space-y-0.5">{errs.slice(0, 20).map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}{errs.length > 20 && <li>…and {errs.length - 20} more</li>}</ul></details>}
                  </td>
                  <td className="px-3 py-2"><StatusBadge value={b.validation_status} /></td>
                  <td className="px-3 py-2"><StatusBadge value={b.status} />{b.approved_at && <p className="mt-1 text-[11px] text-mute">{fmtDateTime(b.approved_at)} by {memberName(members, b.approved_by)}</p>}</td>
                  <td className="px-3 py-2">
                    {b.status === "pending_approval" && canApprove && (
                      b.imported_by === ctx.userId ? <p className="max-w-[14rem] text-xs text-mute">You imported this batch; another approver must decide it.</p> : (
                        <div className="flex gap-2">
                          {(["approve", "reject"] as const).map((d) => (
                            <form key={d} action={decideCcmImportAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={b.id} /><input type="hidden" name="decision" value={d} /><button className={secondaryBtn} type="submit">{d === "approve" ? "Approve import" : "Reject"}</button></form>
                          ))}
                        </div>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <div className="mt-3"><LastUpdated at={(batches ?? []).map((b) => b.updated_at as string).sort().pop()} /></div>
    </>
  );
}
