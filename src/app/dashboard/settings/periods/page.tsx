import { getPhase2Context } from "@/lib/phase2/context";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Banner, StatusBadge, TableShell, Th, cardClass, fmtDate, inputClass, labelClass, primaryBtn } from "@/components/phase2/ui";
import { createReportingPeriodAction } from "@/lib/actions/periods";

export default async function PeriodSettings({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const p2 = await getPhase2Context();
  if (!p2) return <EmptyState title="No organization" description="Join or create an organization first." />;
  const { ctx, periods } = p2;
  const canManage = ["owner", "admin", "cfo", "controller"].includes(ctx.role ?? "");
  return (
    <div className="space-y-6">
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-paper">Reporting periods — {ctx.org.name}</h2>
        {periods.length === 0 ? <p className="text-sm text-mute">No reporting periods yet.</p> : (
          <TableShell>
            <thead className="bg-panel text-xs text-mute"><tr><Th>Label</Th><Th>Start</Th><Th>End</Th><Th>Status</Th></tr></thead>
            <tbody>{periods.map((p) => (
              <tr key={p.id} className="border-t border-line"><td className="px-3 py-2 text-paper">{p.label}</td><td className="px-3 py-2">{fmtDate(p.start_date)}</td><td className="px-3 py-2">{fmtDate(p.end_date)}</td><td className="px-3 py-2"><StatusBadge value={p.status} /></td></tr>
            ))}</tbody>
          </TableShell>
        )}
      </div>
      {canManage ? (
        <form action={createReportingPeriodAction} className={`${cardClass} grid gap-3 sm:grid-cols-4 sm:items-end`}>
          <input type="hidden" name="return_to" value="/dashboard/settings/periods" />
          <div><label className={labelClass} htmlFor="p-label">Label</label><input id="p-label" name="label" required placeholder="2026-Q4" className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="p-start">Start</label><input id="p-start" name="start_date" type="date" required className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="p-end">End</label><input id="p-end" name="end_date" type="date" required className={inputClass} /></div>
          <button className={primaryBtn} type="submit">Add period</button>
        </form>
      ) : <p className="text-xs text-mute">Only owners, admins, CFOs and controllers can add reporting periods.</p>}
    </div>
  );
}
