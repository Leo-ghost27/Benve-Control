"use server";

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

function num(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (v === null) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function requireWriteContext() {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to do this.");
  }
  return ctx;
}

export async function createPopulationAction(formData: FormData) {
  const ctx = await requireWriteContext();
  const supabase = await createClient();
  const testPlanId = String(formData.get("testPlanId"));

  const record = {
    organization_id: ctx.org!.id,
    test_plan_id: testPlanId,
    description: str(formData, "description") ?? "",
    source_system: str(formData, "source_system"),
    total_count: num(formData, "total_count"),
    total_value: num(formData, "total_value"),
  };

  if (!record.description) {
    throw new Error("Population description is required.");
  }

  const { data, error } = await supabase
    .from("populations")
    .insert(record)
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "population",
    entityId: data.id,
    metadata: { test_plan_id: testPlanId },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
}

export async function updatePopulationAction(formData: FormData) {
  const ctx = await requireWriteContext();
  const supabase = await createClient();
  const populationId = String(formData.get("populationId"));
  const testPlanId = String(formData.get("testPlanId"));

  const update = {
    description: str(formData, "description") ?? "",
    source_system: str(formData, "source_system"),
    total_count: num(formData, "total_count"),
    total_value: num(formData, "total_value"),
    completeness_confirmed: formData.get("completeness_confirmed") === "on",
    accuracy_confirmed: formData.get("accuracy_confirmed") === "on",
  };

  const { error } = await supabase
    .from("populations")
    .update(update)
    .eq("id", populationId)
    .eq("organization_id", ctx.org!.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "population",
    entityId: populationId,
    metadata: {
      test_plan_id: testPlanId,
      completeness_confirmed: update.completeness_confirmed,
      accuracy_confirmed: update.accuracy_confirmed,
    },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
}

export async function addSampleItem(populationId: string, testPlanId: string) {
  const ctx = await requireWriteContext();
  const supabase = await createClient();

  const { data: existing, error: countError } = await supabase
    .from("sample_items")
    .select("item_number")
    .eq("population_id", populationId)
    .order("item_number", { ascending: false })
    .limit(1);

  if (countError) throw new Error(countError.message);

  const nextNumber = (existing?.[0]?.item_number ?? 0) + 1;

  const { data, error } = await supabase
    .from("sample_items")
    .insert({
      organization_id: ctx.org!.id,
      population_id: populationId,
      item_number: nextNumber,
      item_reference: "",
      result: "not_tested",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "added",
    entityType: "sample_item",
    entityId: data.id,
    metadata: { population_id: populationId, item_number: nextNumber },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
  return data;
}

type SampleItemFields = Partial<{
  item_reference: string;
  item_value: number | null;
  item_date: string | null;
  result: string;
  notes: string;
  test_step_id: string | null;
}>;

export async function updateSampleItem(
  itemId: string,
  testPlanId: string,
  fields: SampleItemFields
) {
  const ctx = await requireWriteContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("sample_items")
    .update(fields)
    .eq("id", itemId)
    .eq("organization_id", ctx.org!.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "sample_item",
    entityId: itemId,
    metadata: { fields: Object.keys(fields), test_plan_id: testPlanId },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
}

export async function deleteSampleItem(itemId: string, testPlanId: string) {
  const ctx = await requireWriteContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("sample_items")
    .delete()
    .eq("id", itemId)
    .eq("organization_id", ctx.org!.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "deleted",
    entityType: "sample_item",
    entityId: itemId,
    metadata: { test_plan_id: testPlanId },
  });

  revalidatePath(`/dashboard/test-plans/${testPlanId}`);
}
