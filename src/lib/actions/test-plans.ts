"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { logChange } from "@/lib/supabase/audit";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

export async function createTestPlanAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to create a test plan.");
  }

  const controlId = String(formData.get("controlId"));
  const supabase = await createClient();

  const sampleSizeRaw = str(formData, "sample_size");

  const record = {
    organization_id: ctx.org.id,
    control_id: controlId,
    name: str(formData, "name") ?? "",
    description: str(formData, "description"),
    test_type: str(formData, "test_type"),
    period_under_review: str(formData, "period_under_review"),
    population_description: str(formData, "population_description"),
    sampling_approach: str(formData, "sampling_approach"),
    sample_size: sampleSizeRaw ? parseInt(sampleSizeRaw, 10) : null,
    prepared_by: str(formData, "prepared_by"),
    reviewed_by: str(formData, "reviewed_by"),
    status: str(formData, "status")?.toLowerCase().replace(/ /g, "_") ?? "not_started",
  };

  if (!record.name) {
    throw new Error("Test plan name is required.");
  }

  const { data, error } = await supabase
    .from("test_plans")
    .insert(record)
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "test_plan",
    entityId: data.id,
    metadata: { name: record.name, control_id: controlId },
  });

  revalidatePath(`/dashboard/controls/${controlId}`);
  redirect(`/dashboard/test-plans/${data.id}`);
}

export async function updateTestPlanStatusAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a test plan.");
  }

  const testPlanId = String(formData.get("testPlanId"));
  const status = String(formData.get("status")).toLowerCase().replace(/ /g, "_");

  const supabase = await createClient();
  const { error } = await supabase
    .from("test_plans")
    .update({ status })
    .eq("id", testPlanId)
    .eq("organization_id", ctx.org.id);

  if (error) {
    throw new Error(error.message);
  }

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "status_changed",
    entityType: "test_plan",
    entityId: testPlanId,
    metadata: { status },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
}
