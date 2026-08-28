import Link from "next/link";
import { getOrgContext } from "@/lib/supabase/org";
import { createControlAction } from "@/lib/actions/controls";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const labelClass = "mb-1.5 block text-xs font-medium text-mute";

export default async function NewControlPage() {
  const ctx = await getOrgContext();

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Link href="/dashboard/controls" className="text-sm text-mute hover:text-paper">
        &larr; Back to Controls
      </Link>

      <div className="mt-4 mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Auditor Workspace
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          New control
        </h1>
        <p className="mt-1 text-sm text-mute">
          Company / client: {ctx?.org?.name ?? "—"}
        </p>
      </div>

      <form action={createControlAction} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="code">Control ID</label>
            <input id="code" name="code" required placeholder="CTRL-PAY-001" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="title">Control name</label>
            <input id="title" name="title" required placeholder="Dual Approval for High-Value Payments" className={inputClass} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="framework">Framework</label>
            <select id="framework" name="framework" className={inputClass} defaultValue="SOX 404 / ICFR">
              <option value="SOX 404 / ICFR">SOX 404 / ICFR</option>
              <option value="SOX 404">SOX 404</option>
              <option value="ICFR">ICFR</option>
              <option value="OCC / bank-partner readiness">OCC / bank-partner readiness</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="business_model">Business model</label>
            <select id="business_model" name="business_model" className={inputClass} defaultValue="Payments">
              <option value="Payments">Payments</option>
              <option value="Lending">Lending</option>
              <option value="Neobank/BaaS">Neobank/BaaS</option>
              <option value="Card programme">Card programme</option>
              <option value="Treasury">Treasury</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="process">Process</label>
          <input id="process" name="process" placeholder="Payments and settlement" className={inputClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor="risk_statement">Risk statement</label>
          <textarea id="risk_statement" name="risk_statement" rows={2} className={inputClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor="control_objective">Control objective</label>
          <textarea id="control_objective" name="control_objective" rows={2} className={inputClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor="description">Control description</label>
          <textarea id="description" name="description" rows={2} className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="assertion">Financial statement assertion</label>
            <input id="assertion" name="assertion" placeholder="Occurrence, Completeness, Accuracy" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="risk_rating">Risk rating</label>
            <select id="risk_rating" name="risk_rating" className={inputClass} defaultValue="Medium">
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="frequency">Frequency</label>
            <input id="frequency" name="frequency" placeholder="Per transaction" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="control_owner">Control owner</label>
            <input id="control_owner" name="control_owner" placeholder="Finance Operations Manager" className={inputClass} />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="status">Status</label>
          <select id="status" name="status" className={inputClass} defaultValue="Draft">
            <option value="Draft">Draft</option>
            <option value="Active">Active</option>
            <option value="Under testing">Under testing</option>
            <option value="Completed">Completed</option>
          </select>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-md bg-signal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
          >
            Create control
          </button>
          <Link
            href="/dashboard/controls"
            className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:border-mute"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
