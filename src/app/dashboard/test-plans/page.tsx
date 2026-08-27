import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";

type TestPlanRow = {
  id: string;
  name: string;
  status: string;
  controls: { title: string } | { title: string }[] | null;
};

const statusStyles: Record<string, string> = {
  complete: "bg-emerald-400",
  in_progress: "bg-amber-400",
  not_started: "bg-mute",
};

function controlName(controls: TestPlanRow["controls"]) {
  if (!controls) return "—";
  return Array.isArray(controls) ? controls[0]?.title ?? "—" : controls.title;
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
    .select("id, name, status, controls(title)")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-paper">
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
          description="Test plans linked to your controls will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Control</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-ink">
              {(plans as unknown as TestPlanRow[]).map((plan) => (
                <tr key={plan.id}>
                  <td className="px-4 py-3 text-paper">{plan.name}</td>
                  <td className="px-4 py-3 text-mute">
                    {controlName(plan.controls)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-mute">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          statusStyles[plan.status] ?? "bg-mute"
                        }`}
                      />
                      {plan.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
