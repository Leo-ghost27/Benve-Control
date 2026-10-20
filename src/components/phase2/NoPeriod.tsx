import { createReportingPeriodAction } from "@/lib/actions/periods";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { inputClass, labelClass, primaryBtn, cardClass } from "./ui";

export function NoPeriod({ canCreate, returnTo }: { canCreate: boolean; returnTo: string }) {
  if (!canCreate) {
    return (
      <EmptyState
        title="No reporting period yet"
        description="A controller, CFO, admin or owner needs to create a reporting period before monitoring records can be organised."
      />
    );
  }
  return (
    <div className={cardClass}>
      <h2 className="text-sm font-semibold text-paper">Create your first reporting period</h2>
      <p className="mt-1 text-sm text-mute">Phase 2 records (CCM, readiness, group ICFR, ITGC) are organised by reporting period.</p>
      <form action={createReportingPeriodAction} className="mt-4 grid max-w-xl grid-cols-3 gap-3">
        <input type="hidden" name="return_to" value={returnTo} />
        <div className="col-span-3">
          <label className={labelClass} htmlFor="label">Label</label>
          <input id="label" name="label" required placeholder="e.g. 2026-Q4" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="start_date">Start</label>
          <input id="start_date" name="start_date" type="date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="end_date">End</label>
          <input id="end_date" name="end_date" type="date" required className={inputClass} />
        </div>
        <div className="flex items-end">
          <button type="submit" className={primaryBtn}>Create period</button>
        </div>
      </form>
    </div>
  );
}
