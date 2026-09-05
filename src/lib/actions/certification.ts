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

export async function createCertificationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to create a certification pack.");
  }

  const period = String(formData.get("period") ?? "").trim();
  if (!period) throw new Error("Period is required (e.g. Q3 2026).");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("certifications")
    .insert({ organization_id: ctx.org.id, period, created_by: ctx.userId })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "certification",
    entityId: data.id,
    metadata: { period },
  });

  revalidatePath("/dashboard/certification");
}

/**
 * Task 43 section 2 — DC&P evaluation fields, plus the draft
 * certification text from section 4A, saved together.
 */
export async function updateCertificationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a certification.");
  }

  const certificationId = String(formData.get("certificationId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("certifications")
    .update({
      dcp_evaluation_period: textOrNull(formData.get("dcp_evaluation_period")),
      dcp_evaluated_by: textOrNull(formData.get("dcp_evaluated_by")),
      dcp_methodology: textOrNull(formData.get("dcp_methodology")),
      dcp_conclusion: textOrNull(formData.get("dcp_conclusion")),
      dcp_rationale: textOrNull(formData.get("dcp_rationale")),
      draft_text: textOrNull(formData.get("draft_text")),
    })
    .eq("id", certificationId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "certification",
    entityId: certificationId,
    metadata: {},
  });

  revalidatePath("/dashboard/certification");
}

/**
 * Task 43 section 3A — a change in ICFR during the period.
 */
export async function addIcfrChangeAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const certificationId = String(formData.get("certificationId"));

  const supabase = await createClient();
  const { error } = await supabase.from("icfr_changes").insert({
    organization_id: ctx.org.id,
    certification_id: certificationId,
    description: textOrNull(formData.get("description")),
    remediation_status: textOrNull(formData.get("remediation_status")),
    dcp_impact: textOrNull(formData.get("dcp_impact")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "added",
    entityType: "icfr_change",
    entityId: certificationId,
    metadata: {},
  });

  revalidatePath("/dashboard/certification");
}

/**
 * Task 43 section 3B — a sub-certification row.
 */
export async function addSubCertificationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const certificationId = String(formData.get("certificationId"));

  const supabase = await createClient();
  const { error } = await supabase.from("sub_certifications").insert({
    organization_id: ctx.org.id,
    certification_id: certificationId,
    name: textOrNull(formData.get("name")),
    role: textOrNull(formData.get("role")),
    area: textOrNull(formData.get("area")),
    status: "pending",
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "added",
    entityType: "sub_certification",
    entityId: certificationId,
    metadata: {},
  });

  revalidatePath("/dashboard/certification");
}

export async function markSubCertificationSignedAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const subCertificationId = String(formData.get("subCertificationId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("sub_certifications")
    .update({ status: "signed", signed_date: new Date().toISOString().slice(0, 10) })
    .eq("id", subCertificationId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "signed",
    entityType: "sub_certification",
    entityId: subCertificationId,
    metadata: {},
  });

  revalidatePath("/dashboard/certification");
}
