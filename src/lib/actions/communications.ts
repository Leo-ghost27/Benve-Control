"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { logChange } from "@/lib/supabase/audit";

function textOrNull(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Task 41 section A/B — draft a new controlled communication from an
 * approved (or in-progress) deficiency assessment.
 */
export async function createCommunicationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to create a communication.");
  }

  const deficiencyId = String(formData.get("deficiencyId"));
  const audience = textOrNull(formData.get("audience"));
  const commType = textOrNull(formData.get("comm_type"));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communications")
    .insert({
      organization_id: ctx.org.id,
      deficiency_id: deficiencyId,
      audience,
      comm_type: commType,
      confidentiality: "Confidential — authorised management and governance recipients only",
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "communication",
    entityId: data.id,
    metadata: { deficiency_id: deficiencyId },
  });

  revalidatePath(`/dashboard/deficiencies/${deficiencyId}`);
  redirect(`/dashboard/communications/${data.id}`);
}

/**
 * Task 41 section B — edit the draft communication text and profile fields.
 */
export async function updateCommunicationDraftAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a communication.");
  }

  const communicationId = String(formData.get("communicationId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("communications")
    .update({
      audience: textOrNull(formData.get("audience")),
      comm_type: textOrNull(formData.get("comm_type")),
      confidentiality: textOrNull(formData.get("confidentiality")),
      planned_issue_date: textOrNull(formData.get("planned_issue_date")),
      draft_text: textOrNull(formData.get("draft_text")),
      distribution_method: textOrNull(formData.get("distribution_method")),
      access_period_days: formData.get("access_period_days")
        ? Number(formData.get("access_period_days"))
        : null,
    })
    .eq("id", communicationId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "draft"); // once approved/issued, edit through a new draft instead

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "communication",
    entityId: communicationId,
    metadata: {},
  });

  revalidatePath(`/dashboard/communications/${communicationId}`);
}

/**
 * Task 41 section C — Engagement Lead approval, then secure issue.
 * Two distinct actions so "approve" and "issue" leave separate audit
 * trail entries, matching the Task 41 screen's two-step flow.
 */
export async function approveCommunicationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to approve a communication.");
  }

  const communicationId = String(formData.get("communicationId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("communications")
    .update({ status: "approved", approved_by: ctx.userId })
    .eq("id", communicationId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "draft");

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "approved",
    entityType: "communication",
    entityId: communicationId,
    metadata: {},
  });

  revalidatePath(`/dashboard/communications/${communicationId}`);
}

export async function issueCommunicationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to issue a communication.");
  }

  const communicationId = String(formData.get("communicationId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("communications")
    .update({ status: "issued", issued_at: new Date().toISOString() })
    .eq("id", communicationId)
    .eq("organization_id", ctx.org.id)
    .eq("status", "approved");

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "issued",
    entityType: "communication",
    entityId: communicationId,
    metadata: {},
  });

  revalidatePath(`/dashboard/communications/${communicationId}`);
}

/**
 * Task 41 section C — record management's response to an issued
 * communication. Open to client-side business roles as well as
 * owner/admin/internal_auditor (they may record it on management's
 * behalf), enforced by the management_responses RLS insert policy.
 */
export async function recordManagementResponseAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to record a response.");
  }

  const communicationId = String(formData.get("communicationId"));
  const responseText = textOrNull(formData.get("response_text"));
  const respondedBy = textOrNull(formData.get("responded_by"));

  const supabase = await createClient();
  const { error } = await supabase.from("management_responses").insert({
    organization_id: ctx.org.id,
    communication_id: communicationId,
    response_text: responseText,
    responded_by: respondedBy,
    response_date: new Date().toISOString().slice(0, 10),
    status: "received",
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "management_response",
    entityId: communicationId,
    metadata: {},
  });

  revalidatePath(`/dashboard/communications/${communicationId}`);
}
