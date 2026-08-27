import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";

type DeficiencyRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
};

const severityStyles: Record<string, string> = {
  low: "bg-mute",
  medium: "bg-amber-400",
  high: "bg-rose-400",
  critical: "bg-rose-500",
};

export default async function DeficienciesPage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to start tracking deficiencies."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: deficiencies, error } = await supabase
    .from("deficiencies")
    .select("id, title, severity, status")
    .eq("organization_id", ctx.org.id)
    .order("identified_at", { ascending: false });

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-paper">
          Deficiencies
        </h1>
        <p className="mt-1 text-sm text-mute">
          Issues identified during testing for {ctx.org.name}.
        </p>
      </div>

      {error ? (
        <ErrorState />
      ) : !deficiencies || deficiencies.length === 0 ? (
        <EmptyState
          title="No deficiencies logged"
          description="Nice — nothing has been flagged yet. Issues found during testing will show up here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-ink">
              {(deficiencies as DeficiencyRow[]).map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-paper">{item.title}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-mute">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          severityStyles[item.severity] ?? "bg-mute"
                        }`}
                      />
                      {item.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-mute">{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
