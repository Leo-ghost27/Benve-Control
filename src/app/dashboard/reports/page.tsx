import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";

export default async function ReportsPage() {
  const ctx = await getOrgContext();

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-paper">
          Reports
        </h1>
        <p className="mt-1 text-sm text-mute">
          {ctx?.org
            ? `Compliance reporting for ${ctx.org.name}.`
            : "Compliance reporting."}
        </p>
      </div>

      <EmptyState
        title="Reports aren't built yet"
        description="Exportable compliance reports will live here once reporting is implemented."
      />
    </div>
  );
}
