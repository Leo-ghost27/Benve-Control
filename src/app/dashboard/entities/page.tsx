import Link from "next/link";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { addEntityAction } from "@/lib/actions/entities";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const cardClass = "rounded-xl border border-line bg-ink p-6";
const secondaryBtn =
  "rounded-md border border-line px-4 py-2 text-sm font-medium text-paper transition-colors hover:border-mute";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function EntitiesPage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to manage multi-entity ICFR."
        />
      </div>
    );
  }

  const supabase = await createClient();

  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, jurisdiction, status")
    .eq("organization_id", ctx.org.id)
    .order("is_parent", { ascending: false });

  // Live group roll-up: counts per entity, computed here rather than stored.
  const entityIds = (entities ?? []).map((e) => e.id);
  const [{ data: controlCounts }, { data: deficiencyCounts }] = await Promise.all([
    entityIds.length > 0
      ? supabase.from("controls").select("id, entity_id").in("entity_id", entityIds)
      : Promise.resolve({ data: [] }),
    entityIds.length > 0
      ? supabase.from("deficiencies").select("id, entity_id, severity").in("entity_id", entityIds)
      : Promise.resolve({ data: [] }),
  ]);

  const countsByEntity = new Map<string, { controls: number; deficiencies: number }>();
  for (const e of entities ?? []) countsByEntity.set(e.id, { controls: 0, deficiencies: 0 });
  for (const c of controlCounts ?? []) {
    const row = countsByEntity.get(c.entity_id!);
    if (row) row.controls += 1;
  }
  for (const d of deficiencyCounts ?? []) {
    const row = countsByEntity.get(d.entity_id!);
    if (row) row.deficiencies += 1;
  }

  const totalControls = controlCounts?.length ?? 0;
  const totalDeficiencies = deficiencyCounts?.length ?? 0;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Group ICFR Roll-Up
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          Multi-Entity / Subsidiary Assurance Hub
        </h1>
        <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{entities?.length ?? 0}</p>
          <p className="text-xs text-mute">Legal entities in scope</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{totalControls}</p>
          <p className="text-xs text-mute">Entity-scoped controls</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{totalDeficiencies}</p>
          <p className="text-xs text-mute">Entity-scoped deficiencies</p>
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="mb-4 text-sm font-semibold text-paper">Entities</h2>
        {entities && entities.length > 0 ? (
          <div className="mb-4 overflow-hidden rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
                <tr>
                  <th className="px-3 py-2 font-medium">Entity</th>
                  <th className="px-3 py-2 font-medium">Jurisdiction</th>
                  <th className="px-3 py-2 font-medium">Controls</th>
                  <th className="px-3 py-2 font-medium">Deficiencies</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-ink">
                {entities.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/dashboard/entities/${e.id}`}
                        className="text-paper hover:text-signal"
                      >
                        {e.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-mute">{e.jurisdiction || "—"}</td>
                    <td className="px-3 py-2 text-mute">{countsByEntity.get(e.id)?.controls ?? 0}</td>
                    <td className="px-3 py-2 text-mute">
                      {countsByEntity.get(e.id)?.deficiencies ?? 0}
                    </td>
                    <td className="px-3 py-2 text-mute">{formatLabel(e.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mb-4 text-sm text-mute">No entities added yet.</p>
        )}
        <form action={addEntityAction} className="grid grid-cols-3 gap-2">
          <input className={inputClass} name="name" placeholder="Entity name" required />
          <input className={inputClass} name="jurisdiction" placeholder="Jurisdiction" />
          <label className="flex items-center gap-2 text-sm text-paper">
            <input type="checkbox" name="is_parent" className="h-4 w-4 rounded border-line bg-panel accent-signal" />
            Parent entity
          </label>
          <input
            className={`${inputClass} col-span-3`}
            name="functional_scope"
            placeholder="Functional scope"
          />
          <button type="submit" className={`${secondaryBtn} col-span-3`}>
            Add Entity
          </button>
        </form>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        Multi-Entity / Group ICFR Roll-Up &amp; Subsidiary Assurance Hub helps manage ICFR across
        multiple entities using illustrative roll-up logic and sample data. It does not determine
        scoping requirements, provide legal or regulatory advice, or replace management&apos;s
        responsibility for entity and consolidated ICFR. Management is responsible for all final
        scoping, assessment, and reporting decisions.
      </p>
    </div>
  );
}
