import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import {
  addReadinessAreaAction,
  addReadinessGapAction,
  addRoadmapActionAction,
  updateRoadmapActionStatusAction,
} from "@/lib/actions/readiness";

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
  in_progress: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  priority: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  on_track: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  complete: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  not_started: "border-line text-mute",
};

export default async function ReadinessPage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to plan ICFR readiness."
        />
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: areas }, { data: gaps }, { data: roadmapActions }] = await Promise.all([
    supabase
      .from("readiness_areas")
      .select("id, area_name, current_maturity, target_maturity, readiness_score, status")
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("readiness_gaps")
      .select(
        "id, area_id, requirement, current_status, evidence_notes, gap_severity, owner, readiness_areas(area_name)"
      )
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("readiness_roadmap_actions")
      .select(
        "id, action_ref, description, owner, target_date, status, priority, readiness_gaps(requirement)"
      )
      .eq("organization_id", ctx.org.id)
      .order("target_date", { ascending: true }),
  ]);

  const avgScore =
    areas && areas.length > 0
      ? Math.round(
          areas.reduce((sum, a) => sum + (a.readiness_score ?? 0), 0) / areas.length
        )
      : null;
  const highGaps = (gaps ?? []).filter((g) => g.gap_severity === "high").length;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Pre-IPO / Accelerated Filer Readiness
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          ICFR Maturity Centre
        </h1>
        <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{avgScore !== null ? `${avgScore}%` : "—"}</p>
          <p className="text-xs text-mute">Overall readiness score</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{highGaps}</p>
          <p className="text-xs text-mute">High-priority gaps</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">
            {(roadmapActions ?? []).filter((a) => a.status !== "complete").length}
          </p>
          <p className="text-xs text-mute">Open roadmap actions</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Maturity overview */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Readiness &amp; Maturity Overview</h2>
          {areas && areas.length > 0 ? (
            <div className="mb-4 overflow-hidden rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
                  <tr>
                    <th className="px-3 py-2 font-medium">Area</th>
                    <th className="px-3 py-2 font-medium">Current</th>
                    <th className="px-3 py-2 font-medium">Target</th>
                    <th className="px-3 py-2 font-medium">Score</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-ink">
                  {areas.map((a) => (
                    <tr key={a.id}>
                      <td className="px-3 py-2 text-paper">{a.area_name}</td>
                      <td className="px-3 py-2 text-mute">{a.current_maturity || "—"}</td>
                      <td className="px-3 py-2 text-mute">{a.target_maturity || "—"}</td>
                      <td className="px-3 py-2 text-mute">
                        {a.readiness_score !== null ? `${a.readiness_score}%` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            statusStyles[a.status] ?? statusStyles.in_progress
                          }`}
                        >
                          {formatLabel(a.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mb-4 text-sm text-mute">No readiness areas set up yet.</p>
          )}
          <form action={addReadinessAreaAction} className="grid grid-cols-4 gap-2">
            <input className={inputClass} name="area_name" placeholder="Area name" required />
            <input className={inputClass} name="current_maturity" placeholder="Current (e.g. Level 3)" />
            <input className={inputClass} name="target_maturity" placeholder="Target (e.g. Level 4)" />
            <input className={inputClass} type="number" name="readiness_score" placeholder="Score %" />
            <select className={`${inputClass} col-span-2`} name="status" defaultValue="in_progress">
              <option value="in_progress">In progress</option>
              <option value="priority">Priority</option>
              <option value="on_track">On track</option>
              <option value="complete">Complete</option>
            </select>
            <button type="submit" className={`${secondaryBtn} col-span-2`}>
              Add Area
            </button>
          </form>
        </section>

        {/* Gap analysis */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Readiness Checklist &amp; Gap Analysis</h2>
          {gaps && gaps.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {gaps.map((g) => {
                const area = Array.isArray(g.readiness_areas)
                  ? g.readiness_areas[0]
                  : g.readiness_areas;
                return (
                  <li key={g.id} className="rounded-md border border-line bg-panel p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-paper">{g.requirement}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          g.gap_severity === "high"
                            ? "border-rose-400/40 bg-rose-400/10 text-rose-300"
                            : g.gap_severity === "medium"
                            ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                            : "border-line text-mute"
                        }`}
                      >
                        {formatLabel(g.gap_severity)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-mute">
                      {area ? `${area.area_name} · ` : ""}
                      {g.current_status} · Owner: {g.owner || "—"}
                    </p>
                    {g.evidence_notes && <p className="mt-1 text-xs text-mute">{g.evidence_notes}</p>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No gaps recorded yet.</p>
          )}
          <form action={addReadinessGapAction} className="grid grid-cols-3 gap-2">
            <input className={inputClass} name="area_id" placeholder="Area ID (optional)" />
            <input className={`${inputClass} col-span-2`} name="requirement" placeholder="Requirement" />
            <input className={inputClass} name="current_status" placeholder="Current status" />
            <input className={inputClass} name="owner" placeholder="Owner" />
            <select className={inputClass} name="gap_severity" defaultValue="medium">
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <input
              className={`${inputClass} col-span-3`}
              name="evidence_notes"
              placeholder="Evidence / notes"
            />
            <button type="submit" className={`${secondaryBtn} col-span-3`}>
              Add Gap
            </button>
          </form>
        </section>

        {/* Remediation roadmap */}
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Remediation Roadmap</h2>
          {roadmapActions && roadmapActions.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {roadmapActions.map((a) => {
                const gap = Array.isArray(a.readiness_gaps) ? a.readiness_gaps[0] : a.readiness_gaps;
                return (
                  <li key={a.id} className="rounded-md border border-line bg-panel p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-paper">
                        {a.action_ref || a.id.slice(0, 8)}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          statusStyles[a.status] ?? statusStyles.not_started
                        }`}
                      >
                        {formatLabel(a.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-paper">{a.description}</p>
                    <p className="mt-1 text-xs text-mute">
                      {gap ? `Gap: ${gap.requirement} · ` : ""}
                      Owner: {a.owner} · Target: {a.target_date} · Priority: {formatLabel(a.priority)}
                    </p>
                    {a.status !== "complete" && (
                      <form action={updateRoadmapActionStatusAction} className="mt-2 flex gap-2">
                        <input type="hidden" name="actionId" value={a.id} />
                        {a.status === "not_started" && (
                          <>
                            <input type="hidden" name="status" value="in_progress" />
                            <button type="submit" className="text-xs text-signal hover:underline">
                              Mark In Progress
                            </button>
                          </>
                        )}
                        {a.status === "in_progress" && (
                          <>
                            <input type="hidden" name="status" value="complete" />
                            <button type="submit" className="text-xs text-signal hover:underline">
                              Mark Complete
                            </button>
                          </>
                        )}
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-mute">No remediation actions planned yet.</p>
          )}
          <form action={addRoadmapActionAction} className="grid grid-cols-3 gap-2">
            <input className={inputClass} name="action_ref" placeholder="Action ref" />
            <input className={inputClass} name="gap_id" placeholder="Gap ID (optional)" />
            <input className={inputClass} name="owner" placeholder="Owner" />
            <input className={`${inputClass} col-span-2`} name="description" placeholder="Description" />
            <input className={inputClass} type="date" name="target_date" />
            <select className={inputClass} name="priority" defaultValue="high">
              <option value="high">High</option>
              <option value="medium">Medium</option>
            </select>
            <button type="submit" className={`${secondaryBtn} col-span-2`}>
              Add Action
            </button>
          </form>
        </section>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        Pre-IPO / Accelerated Filer Readiness &amp; ICFR Maturity Centre helps assess and plan
        ICFR readiness using illustrative criteria and sample data. It does not determine filer
        status, provide legal or regulatory advice, guarantee readiness, or replace management&apos;s
        responsibility for ICFR design, testing, and reporting. Management and advisers are
        responsible for all final decisions.
      </p>
    </div>
  );
}
