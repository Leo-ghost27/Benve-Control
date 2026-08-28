import Link from "next/link";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";

type TestPlanRow = {
  id: string;
  name: string;
  test_type: string | null;
  status: string;
  controls: { code: string; title: string } | { code: string; title: string }[] | null;
};

const statusStyles: Record<string, string> = {
  final: "bg-emerald-400",
  ready_for_review: "bg-signal",
  in_progress: "bg-amber-400",
  not_started: "bg-mute",
};

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function control(controls: TestPlanRow["controls"]) {
  if (!controls) return null;
  return Array.isArray(controls) ? controls[0] ?? null : controls;
}

export default async function TestPlansPage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to start building test plans."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: plans, error } = await supabase
    .from("test_plans")
    .select("id, name, test_type, status, controls(code, title)")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Auditor Workspace
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          Test Plans
        </h1>
        <p className="mt-1 text-sm text-mute">
          Testing activity for {ctx.org.name}.
        </p>
      </div>

      {error ? (
        <ErrorState />
      ) : !plans || plans.length === 0 ? (
        <EmptyState
          title="No test plans yet"
          description="Create a test plan from a control to get started."
          action={{ label: "Go to Controls", href: "/dashboard/controls" }}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Control</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-ink">
              {(plans as unknown as TestPlanRow[]).map((plan) => {
                const ctrl = control(plan.controls);
                return (
                  <tr key={plan.id} className="transition-colors hover:bg-panel/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/test-plans/${plan.id}`}
                        className="text-paper hover:text-signal"
                      >
                        {plan.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-mute">
                      {ctrl ? `${ctrl.code} — ${ctrl.title}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-mute">{formatLabel(plan.test_type)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-mute">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            statusStyles[plan.status] ?? "bg-mute"
                          }`}
                        />
                        {formatLabel(plan.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
