import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import {
  addItgcSystemAction,
  addItgcControlAction,
  addAutomatedControlAction,
} from "@/lib/actions/itgc";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const cardClass = "rounded-xl border border-line bg-ink p-6";
const secondaryBtn =
  "rounded-md border border-line px-4 py-2 text-sm font-medium text-paper transition-colors hover:border-mute";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function ItgcPage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to document ITGC and automated controls."
        />
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: systems }, { data: itgcControls }, { data: automatedControls }] =
    await Promise.all([
      supabase
        .from("itgc_systems")
        .select("id, name, system_type, status")
        .eq("organization_id", ctx.org.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("itgc_controls")
        .select(
          "id, control_ref, category, description, risk, test_approach, sample_size, results, itgc_systems(name)"
        )
        .eq("organization_id", ctx.org.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("automated_controls")
        .select(
          "id, control_ref, description, financial_assertions, frequency, results, status, itgc_systems(name)"
        )
        .eq("organization_id", ctx.org.id)
        .order("created_at", { ascending: false }),
    ]);

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          ITGC Depth &amp; Automated Control Assurance
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          ITGC Studio
        </h1>
        <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{systems?.length ?? 0}</p>
          <p className="text-xs text-mute">In-scope systems</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{itgcControls?.length ?? 0}</p>
          <p className="text-xs text-mute">ITGC workpapers</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{automatedControls?.length ?? 0}</p>
          <p className="text-xs text-mute">Automated application controls</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Systems */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">In-Scope Systems</h2>
          {systems && systems.length > 0 ? (
            <ul className="mb-4 divide-y divide-line">
              {systems.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-paper">{s.name}</span>
                  <span className="text-mute">
                    {s.system_type} · {formatLabel(s.status)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No systems added yet.</p>
          )}
          <form action={addItgcSystemAction} className="flex gap-2">
            <input className={inputClass} name="name" placeholder="System name" required />
            <input className={inputClass} name="system_type" placeholder="Type (e.g. ERP, Identity)" />
            <button type="submit" className={secondaryBtn}>
              Add System
            </button>
          </form>
        </section>

        {/* ITGC workpapers */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">
            ITGC Workpapers — Access, Change, Operations
          </h2>
          {itgcControls && itgcControls.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {itgcControls.map((c) => {
                const system = Array.isArray(c.itgc_systems) ? c.itgc_systems[0] : c.itgc_systems;
                return (
                  <li key={c.id} className="rounded-md border border-line bg-panel p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-paper">{c.control_ref}</span>
                      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-mute">
                        {formatLabel(c.category)}
                      </span>
                    </div>
                    <p className="mt-1 text-paper">{c.description}</p>
                    <p className="mt-1 text-xs text-mute">
                      {system ? `${system.name} · ` : ""}Risk: {c.risk || "—"}
                    </p>
                    {c.results && <p className="mt-1 text-xs text-mute">Results: {c.results}</p>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No ITGC workpapers recorded yet.</p>
          )}
          <form action={addItgcControlAction} className="grid grid-cols-3 gap-2">
            <input className={inputClass} name="control_ref" placeholder="Control ID" />
            <input className={inputClass} name="system_id" placeholder="System ID" />
            <select className={inputClass} name="category" defaultValue="access">
              <option value="access">Access</option>
              <option value="change">Change</option>
              <option value="operations">Operations</option>
            </select>
            <input className={`${inputClass} col-span-3`} name="description" placeholder="Description" />
            <input className={`${inputClass} col-span-3`} name="risk" placeholder="Risk" />
            <textarea
              className={`${inputClass} col-span-2`}
              name="test_approach"
              rows={2}
              placeholder="Test approach"
            />
            <input className={inputClass} type="number" name="sample_size" placeholder="Sample size" />
            <textarea className={`${inputClass} col-span-3`} name="results" rows={2} placeholder="Results" />
            <input
              className={`${inputClass} col-span-3`}
              name="deficiency_id"
              placeholder="Linked deficiency ID (optional)"
            />
            <button type="submit" className={`${secondaryBtn} col-span-3`}>
              Add Workpaper
            </button>
          </form>
        </section>

        {/* Automated control library */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Automated Application Control Library</h2>
          {automatedControls && automatedControls.length > 0 ? (
            <div className="mb-4 overflow-hidden rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
                  <tr>
                    <th className="px-3 py-2 font-medium">Control</th>
                    <th className="px-3 py-2 font-medium">System</th>
                    <th className="px-3 py-2 font-medium">Assertions</th>
                    <th className="px-3 py-2 font-medium">Frequency</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-ink">
                  {automatedControls.map((ac) => {
                    const system = Array.isArray(ac.itgc_systems)
                      ? ac.itgc_systems[0]
                      : ac.itgc_systems;
                    return (
                      <tr key={ac.id}>
                        <td className="px-3 py-2 font-mono text-xs text-paper">{ac.control_ref}</td>
                        <td className="px-3 py-2 text-mute">{system?.name || "—"}</td>
                        <td className="px-3 py-2 text-mute">
                          {(ac.financial_assertions ?? []).join(", ") || "—"}
                        </td>
                        <td className="px-3 py-2 text-mute">{ac.frequency}</td>
                        <td className="px-3 py-2 text-mute">{formatLabel(ac.status)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mb-4 text-sm text-mute">No automated controls documented yet.</p>
          )}
          <form action={addAutomatedControlAction} className="grid grid-cols-3 gap-2">
            <input className={inputClass} name="control_ref" placeholder="Control ID" />
            <input className={inputClass} name="system_id" placeholder="System ID" />
            <input className={inputClass} name="frequency" placeholder="Frequency" />
            <input
              className={`${inputClass} col-span-3`}
              name="description"
              placeholder="Description"
            />
            <input
              className={`${inputClass} col-span-2`}
              name="financial_assertions"
              placeholder="Assertions (comma-separated)"
            />
            <input
              className={inputClass}
              name="linked_sox_control_id"
              placeholder="Linked SOX control ID"
            />
            <textarea
              className={`${inputClass} col-span-3`}
              name="testing_approach"
              rows={2}
              placeholder="Testing approach"
            />
            <textarea className={`${inputClass} col-span-3`} name="results" rows={2} placeholder="Results" />
            <input
              className={`${inputClass} col-span-3`}
              name="linked_deficiency_id"
              placeholder="Linked deficiency ID (optional)"
            />
            <button type="submit" className={`${secondaryBtn} col-span-3`}>
              Add Automated Control
            </button>
          </form>
        </section>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        ITGC Depth &amp; Automated Control Assurance Studio helps document and test IT general
        controls and automated application controls using illustrative workpapers and sample
        data. It does not connect to live systems, automatically validate configurations,
        determine ITGC sufficiency, or replace detailed IT audit procedures. Management and the
        external auditor are responsible for all final testing, evaluation, and conclusions.
      </p>
    </div>
  );
}
