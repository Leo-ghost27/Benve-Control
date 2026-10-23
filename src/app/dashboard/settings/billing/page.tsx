import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { BillingCard } from "@/components/dashboard/BillingCard";

export default async function BillingSettings() {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization" description="You're not part of an organization yet." />;
  const supabase = await createClient();
  const { data } = await supabase.from("organization_billing").select("plan, billing_status").eq("organization_id", ctx.org.id).maybeSingle();
  return (
    <BillingCard
      planLabel={data?.plan ?? "None"}
      status={data?.billing_status ?? "none"}
      canManage={ctx.role === "owner" || ctx.role === "admin"}
    />
  );
}
