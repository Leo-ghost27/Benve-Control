"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { logChange } from "@/lib/supabase/audit";

function textOrNull(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function numberOrNull(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export async function addItgcSystemAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("System name is required.");

  const supabase = await createClient();
  const { error } = await supabase.from("itgc_systems").insert({
    organization_id: ctx.org.id,
    name,
    system_type: textOrNull(formData.get("system_type")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "itgc_system",
    entityId: ctx.org.id,
    metadata: { name },
  });

  revalidatePath("/dashboard/itgc");
}

export async function addItgcControlAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const supabase = await createClient();
  const { error } = await supabase.from("itgc_controls").insert({
    organization_id: ctx.org.id,
    system_id: textOrNull(formData.get("system_id")),
    control_ref: textOrNull(formData.get("control_ref")),
    category: textOrNull(formData.get("category")),
    description: textOrNull(formData.get("description")),
    risk: textOrNull(formData.get("risk")),
    test_approach: textOrNull(formData.get("test_approach")),
    sample_size: numberOrNull(formData.get("sample_size")),
    results: textOrNull(formData.get("results")),
    deficiency_id: textOrNull(formData.get("deficiency_id")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "itgc_control",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/itgc");
}

export async function addAutomatedControlAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const assertionsRaw = String(formData.get("financial_assertions") ?? "");
  const assertions = assertionsRaw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  const supabase = await createClient();
  const { error } = await supabase.from("automated_controls").insert({
    organization_id: ctx.org.id,
    system_id: textOrNull(formData.get("system_id")),
    control_ref: textOrNull(formData.get("control_ref")),
    description: textOrNull(formData.get("description")),
    financial_assertions: assertions.length > 0 ? assertions : null,
    linked_sox_control_id: textOrNull(formData.get("linked_sox_control_id")),
    frequency: textOrNull(formData.get("frequency")),
    testing_approach: textOrNull(formData.get("testing_approach")),
    results: textOrNull(formData.get("results")),
    linked_deficiency_id: textOrNull(formData.get("linked_deficiency_id")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "automated_control",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/itgc");
}
