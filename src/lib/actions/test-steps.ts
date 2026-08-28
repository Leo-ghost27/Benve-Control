"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { logChange } from "@/lib/supabase/audit";

async function requireOrg() {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to do this.");
  }
  return ctx;
}

export async function addTestStep(testPlanId: string, description: string) {
  const ctx = await requireOrg();
  const supabase = await createClient();

  const { data: existing, error: countError } = await supabase
    .from("test_steps")
    .select("step_number")
    .eq("test_plan_id", testPlanId)
    .order("step_number", { ascending: false })
    .limit(1);

  if (countError) throw new Error(countError.message);

  const nextNumber = (existing?.[0]?.step_number ?? 0) + 1;

  const { data, error } = await supabase
    .from("test_steps")
    .insert({
      organization_id: ctx.org!.id,
      test_plan_id: testPlanId,
      step_number: nextNumber,
      description: description || "New procedure",
      status: "not_started",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "added",
    entityType: "test_step",
    entityId: data.id,
    metadata: { step_number: nextNumber, test_plan_id: testPlanId },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
  return data;
}

type TestStepFields = Partial<{
  description: string;
  expected_result: string;
  actual_result: string;
  evidence_reference: string;
  status: string;
  auditor_notes: string;
  draft_conclusion: string;
}>;

export async function updateTestStep(
  stepId: string,
  testPlanId: string,
  fields: TestStepFields
) {
  const ctx = await requireOrg();
  const supabase = await createClient();

  const { error } = await supabase
    .from("test_steps")
    .update(fields)
    .eq("id", stepId)
    .eq("organization_id", ctx.org!.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "test_step",
    entityId: stepId,
    metadata: { fields: Object.keys(fields), test_plan_id: testPlanId },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
}

export async function deleteTestStep(stepId: string, testPlanId: string) {
  const ctx = await requireOrg();
  const supabase = await createClient();

  const { error } = await supabase
    .from("test_steps")
    .delete()
    .eq("id", stepId)
    .eq("organization_id", ctx.org!.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "deleted",
    entityType: "test_step",
    entityId: stepId,
    metadata: { test_plan_id: testPlanId },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
}

export async function reorderTestSteps(
  testPlanId: string,
  orderedStepIds: string[]
) {
  const ctx = await requireOrg();
  const supabase = await createClient();

  // Renumber sequentially based on the new order. Done as individual
  // updates (not a bulk upsert) so each row's org_id filter is enforced.
  for (let i = 0; i < orderedStepIds.length; i++) {
    const { error } = await supabase
      .from("test_steps")
      .update({ step_number: i + 1 })
      .eq("id", orderedStepIds[i])
      .eq("organization_id", ctx.org!.id);
    if (error) throw new Error(error.message);
  }

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "reordered",
    entityType: "test_plan",
    entityId: testPlanId,
    metadata: { new_order: orderedStepIds },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
}
