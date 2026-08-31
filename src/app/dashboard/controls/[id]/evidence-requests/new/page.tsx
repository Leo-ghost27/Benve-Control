import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { NewEvidenceRequestForm } from "@/components/dashboard/NewEvidenceRequestForm";

export default async function NewEvidenceRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();

  const supabase = await createClient();

  const { data: control, error } = await supabase
    .from("controls")
    .select("id, code, title")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();

  if (error || !control) notFound();

  const { data: testPlans } = await supabase
    .from("test_plans")
    .select("id, name")
    .eq("control_id", id)
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: true });

  const { data: testSteps } =
    testPlans && testPlans.length > 0
      ? await supabase
          .from("test_steps")
          .select("id, step_number, description, test_plan_id")
          .eq("organization_id", ctx.org.id)
          .in(
            "test_plan_id",
            testPlans.map((p) => p.id)
          )
          .order("step_number", { ascending: true })
      : { data: [] };

  return (
    <NewEvidenceRequestForm
      controlId={control.id}
      controlLabel={`${control.code} — ${control.title}`}
      testPlans={testPlans ?? []}
      testSteps={testSteps ?? []}
    />
  );
}
