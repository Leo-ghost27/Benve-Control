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

export async function addReadinessAreaAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const areaName = String(formData.get("area_name") ?? "").trim();
  if (!areaName) throw new Error("Area name is required.");

  const supabase = await createClient();
  const { error } = await supabase.from("readiness_areas").insert({
    organization_id: ctx.org.id,
    area_name: areaName,
    current_maturity: textOrNull(formData.get("current_maturity")),
    target_maturity: textOrNull(formData.get("target_maturity")),
    readiness_score: numberOrNull(formData.get("readiness_score")),
    status: textOrNull(formData.get("status")) ?? "in_progress",
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "readiness_area",
    entityId: ctx.org.id,
    metadata: { area_name: areaName },
  });

  revalidatePath("/dashboard/readiness");
}

export async function addReadinessGapAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const supabase = await createClient();
  const { error } = await supabase.from("readiness_gaps").insert({
    organization_id: ctx.org.id,
    area_id: textOrNull(formData.get("area_id")),
    requirement: textOrNull(formData.get("requirement")),
    current_status: textOrNull(formData.get("current_status")),
    evidence_notes: textOrNull(formData.get("evidence_notes")),
    gap_severity: textOrNull(formData.get("gap_severity")),
    owner: textOrNull(formData.get("owner")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "readiness_gap",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/readiness");
}

export async function addRoadmapActionAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const supabase = await createClient();
  const { error } = await supabase.from("readiness_roadmap_actions").insert({
    organization_id: ctx.org.id,
    gap_id: textOrNull(formData.get("gap_id")),
    action_ref: textOrNull(formData.get("action_ref")),
    description: textOrNull(formData.get("description")),
    owner: textOrNull(formData.get("owner")),
    target_date: textOrNull(formData.get("target_date")),
    priority: textOrNull(formData.get("priority")) ?? "medium",
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "readiness_roadmap_action",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/readiness");
}

export async function updateRoadmapActionStatusAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const actionId = String(formData.get("actionId"));
  const status = String(formData.get("status"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("readiness_roadmap_actions")
    .update({ status })
    .eq("id", actionId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: status,
    entityType: "readiness_roadmap_action",
    entityId: actionId,
    metadata: {},
  });

  revalidatePath("/dashboard/readiness");
}
