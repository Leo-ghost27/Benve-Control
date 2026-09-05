"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { logChange } from "@/lib/supabase/audit";

const QUALITATIVE_FLAG_KEYS = [
  "fraud_risk",
  "high_volume",
  "control_change",
  "management_override",
  "related_party",
  "covenant_impact",
  "prior_restatement",
] as const;

function numberOrNull(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Task 40 section A/B — factual context and potential misstatement fields.
 */
export async function updateDeficiencyAssessmentAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a deficiency.");
  }

  const deficiencyId = String(formData.get("deficiencyId"));

  const assertionsRaw = String(formData.get("assertions") ?? "");
  const assertions = assertionsRaw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  const qualitativeFlags: Record<string, boolean> = {};
  for (const key of QUALITATIVE_FLAG_KEYS) {
    qualitativeFlags[key] = formData.get(`flag_${key}`) === "on";
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("deficiencies")
    .update({
      financial_statement_area: textOrNull(formData.get("financial_statement_area")),
      assertions: assertions.length > 0 ? assertions : null,
      related_risk_summary: textOrNull(formData.get("related_risk_summary")),
      potential_error_type: textOrNull(formData.get("potential_error_type")),
      max_reasonable_exposure: numberOrNull(formData.get("max_reasonable_exposure")),
      identified_amount: numberOrNull(formData.get("identified_amount")),
      planning_materiality: numberOrNull(formData.get("planning_materiality")),
      performance_materiality: numberOrNull(formData.get("performance_materiality")),
      clearly_trivial_threshold: numberOrNull(formData.get("clearly_trivial_threshold")),
      qualitative_flags: qualitativeFlags,
      potential_impact_analysis: textOrNull(formData.get("potential_impact_analysis")),
    })
    .eq("id", deficiencyId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "deficiency",
    entityId: deficiencyId,
    metadata: { section: "assessment" },
  });

  revalidatePath(`/dashboard/deficiencies/${deficiencyId}`);
}

/**
 * Task 40 section C part 1 — likelihood of potential misstatement.
 */
export async function updateDeficiencyLikelihoodAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a deficiency.");
  }

  const deficiencyId = String(formData.get("deficiencyId"));
  const likelihood = String(formData.get("likelihood"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("deficiencies")
    .update({ likelihood })
    .eq("id", deficiencyId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "deficiency",
    entityId: deficiencyId,
    metadata: { section: "likelihood", likelihood },
  });

  revalidatePath(`/dashboard/deficiencies/${deficiencyId}`);
}

/**
 * Task 40 section B — add a compensating control row.
 */
export async function addCompensatingControlAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a deficiency.");
  }

  const deficiencyId = String(formData.get("deficiencyId"));

  const supabase = await createClient();
  const { error } = await supabase.from("compensating_controls").insert({
    organization_id: ctx.org.id,
    deficiency_id: deficiencyId,
    control_ref: textOrNull(formData.get("control_ref")),
    description: textOrNull(formData.get("description")),
    operating_status: textOrNull(formData.get("operating_status")),
    assessment: textOrNull(formData.get("assessment")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "added",
    entityType: "compensating_control",
    entityId: deficiencyId,
    metadata: {},
  });

  revalidatePath(`/dashboard/deficiencies/${deficiencyId}`);
}

/**
 * Task 40 section C part 3 — assign this deficiency to an aggregation group,
 * creating the group if it doesn't exist yet.
 */
export async function setAggregationGroupAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a deficiency.");
  }

  const deficiencyId = String(formData.get("deficiencyId"));
  const groupRef = String(formData.get("group_ref")).trim();
  const process = textOrNull(formData.get("process"));

  if (!groupRef) throw new Error("Aggregation group reference is required.");

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("aggregation_groups")
    .select("id")
    .eq("organization_id", ctx.org.id)
    .eq("group_ref", groupRef)
    .maybeSingle();

  let groupId = existing?.id as string | undefined;

  if (!groupId) {
    const { data: created, error: createError } = await supabase
      .from("aggregation_groups")
      .insert({ organization_id: ctx.org.id, group_ref: groupRef, process })
      .select("id")
      .single();
    if (createError) throw new Error(createError.message);
    groupId = created.id;
  }

  const { error } = await supabase
    .from("deficiencies")
    .update({ aggregation_group_id: groupId })
    .eq("id", deficiencyId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "deficiency",
    entityId: deficiencyId,
    metadata: { section: "aggregation", group_ref: groupRef },
  });

  revalidatePath(`/dashboard/deficiencies/${deficiencyId}`);
}

/**
 * Task 40 section D — draft classification + submit for Engagement Lead review.
 */
export async function submitDeficiencyClassificationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a deficiency.");
  }

  const deficiencyId = String(formData.get("deficiencyId"));
  const draftClassification = String(formData.get("draft_classification"));
  const classificationRationale = textOrNull(formData.get("classification_rationale"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("deficiencies")
    .update({
      draft_classification: draftClassification,
      classification_rationale: classificationRationale,
      review_status: "awaiting_review",
    })
    .eq("id", deficiencyId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "submitted",
    entityType: "deficiency",
    entityId: deficiencyId,
    metadata: { draft_classification: draftClassification },
  });

  revalidatePath(`/dashboard/deficiencies/${deficiencyId}`);
}

/**
 * Task 40 section D — Engagement Lead reviewer decision.
 * Restricted to owner/admin by the deficiencies RLS update policy; this
 * action does not itself check role, it relies on the database to reject
 * unauthorized writes (same pattern as the rest of the app).
 */
export async function reviewDeficiencyClassificationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a deficiency.");
  }

  const deficiencyId = String(formData.get("deficiencyId"));
  const decision = String(formData.get("decision")); // "approve" | "return"

  const supabase = await createClient();
  const { error } = await supabase
    .from("deficiencies")
    .update({
      review_status: decision === "approve" ? "approved" : "returned",
      reviewer_id: ctx.userId,
      review_date: new Date().toISOString().slice(0, 10),
    })
    .eq("id", deficiencyId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: decision === "approve" ? "approved" : "returned",
    entityType: "deficiency",
    entityId: deficiencyId,
    metadata: {},
  });

  revalidatePath(`/dashboard/deficiencies/${deficiencyId}`);
}
