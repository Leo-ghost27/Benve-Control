import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/dashboard/StatCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";

async function getDashboardStats(organizationId: string) {
  const supabase = await createClient();

  const today = new Date();
  const dueSoonCutoff = new Date(today);
  dueSoonCutoff.setDate(dueSoonCutoff.getDate() + 14);
  const todayISO = today.toISOString().slice(0, 10);
  const dueSoonISO = dueSoonCutoff.toISOString().slice(0, 10);

  const [totalControls, completedTestPlans, openDeficiencies, evidenceDueSoon] =
    await Promise.all([
      supabase
        .from("controls")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      supabase
        .from("test_plans")
        .select("control_id")
        .eq("organization_id", organizationId)
        .eq("status", "completed")
        .not("control_id", "is", null),
      supabase
        .from("deficiencies")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "open"),
      supabase
        .from("evidence")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("due_date", todayISO)
        .lte("due_date", dueSoonISO),
    ]);

  for (const result of [totalControls, completedTestPlans, openDeficiencies, evidenceDueSoon]) {
    if (result.error) throw result.error;
  }

  const controlsTested = new Set(
    (completedTestPlans.data ?? []).map((row) => row.control_id)
  ).size;

  return {
    totalControls: totalControls.count ?? 0,
    controlsTested,
    openDeficiencies: openDeficiencies.count ?? 0,
    evidenceDueSoon: evidenceDueSoon.count ?? 0,
  };
}

export default async function DashboardPage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="You're signed in, but you're not a member of an organization. Ask an owner to invite you, or create one to get started."
        />
      </div>
    );
  }

  let stats;
  try {
    stats = await getDashboardStats(ctx.org.id);
  } catch {
    return (
      <div className="p-8">
        <ErrorState />
      </div>
    );
  }

  const noDataYet =
    stats.totalControls === 0 &&
    stats.controlsTested === 0 &&
    stats.openDeficiencies === 0 &&
    stats.evidenceDueSoon === 0;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-paper">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-mute">
          Compliance overview for {ctx.org.name}.
        </p>
      </div>

      {noDataYet ? (
        <EmptyState
          title="No compliance activity yet"
          description="Once controls, test plans, and evidence are added, your overview will show up here."
          action={{ label: "Go to Controls", href: "/dashboard/controls" }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total controls" value={stats.totalControls} />
          <StatCard
            label="Controls tested"
            value={stats.controlsTested}
            hint={
              stats.totalControls > 0
                ? `of ${stats.totalControls} total`
                : undefined
            }
          />
          <StatCard
            label="Open deficiencies"
            value={stats.openDeficiencies}
            tone={stats.openDeficiencies > 0 ? "critical" : "default"}
          />
          <StatCard
            label="Evidence due soon"
            value={stats.evidenceDueSoon}
            hint="Next 14 days"
            tone={stats.evidenceDueSoon > 0 ? "warning" : "default"}
          />
        </div>
      )}
    </div>
  );
}
