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

export async function addEntityAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Entity name is required.");

  const supabase = await createClient();
  const { error } = await supabase.from("entities").insert({
    organization_id: ctx.org.id,
    name,
    jurisdiction: textOrNull(formData.get("jurisdiction")),
    functional_scope: textOrNull(formData.get("functional_scope")),
    is_parent: formData.get("is_parent") === "on",
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "entity",
    entityId: ctx.org.id,
    metadata: { name },
  });

  revalidatePath("/dashboard/entities");
}

export async function createSubsidiaryQuestionnaireAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const entityId = String(formData.get("entityId"));
  const period = textOrNull(formData.get("period"));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subsidiary_questionnaires")
    .insert({ organization_id: ctx.org.id, entity_id: entityId, period })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const questions = [
    "Have there been any material misstatements or fraud in this period?",
    "Have there been any new or changed significant risks?",
    "Have all key controls operated as designed?",
    "Have there been any significant changes in ICFR?",
    "Are there any open internal or external audit findings affecting ICFR?",
  ];

  await supabase.from("subsidiary_questionnaire_responses").insert(
    questions.map((q) => ({
      organization_id: ctx.org!.id,
      questionnaire_id: data.id,
      question: q,
    }))
  );

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "subsidiary_questionnaire",
    entityId: data.id,
    metadata: { entity_id: entityId },
  });

  revalidatePath(`/dashboard/entities/${entityId}`);
}

export async function updateQuestionnaireResponseAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const responseId = String(formData.get("responseId"));
  const entityId = String(formData.get("entityId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("subsidiary_questionnaire_responses")
    .update({
      response: textOrNull(formData.get("response")),
      evidence_comments: textOrNull(formData.get("evidence_comments")),
      follow_up_required: textOrNull(formData.get("follow_up_required")),
    })
    .eq("id", responseId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "subsidiary_questionnaire_response",
    entityId: responseId,
    metadata: {},
  });

  revalidatePath(`/dashboard/entities/${entityId}`);
}

export async function submitQuestionnaireAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const questionnaireId = String(formData.get("questionnaireId"));
  const entityId = String(formData.get("entityId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("subsidiary_questionnaires")
    .update({
      status: "submitted",
      prepared_by: textOrNull(formData.get("prepared_by")),
      reviewed_by_local: textOrNull(formData.get("reviewed_by_local")),
      submitted_to: textOrNull(formData.get("submitted_to")),
      submission_date: new Date().toISOString().slice(0, 10),
    })
    .eq("id", questionnaireId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "submitted",
    entityType: "subsidiary_questionnaire",
    entityId: questionnaireId,
    metadata: {},
  });

  revalidatePath(`/dashboard/entities/${entityId}`);
}

export async function reviewQuestionnaireAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const questionnaireId = String(formData.get("questionnaireId"));
  const entityId = String(formData.get("entityId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("subsidiary_questionnaires")
    .update({
      status: "reviewed",
      group_reviewed_by: textOrNull(formData.get("group_reviewed_by")),
      group_review_date: new Date().toISOString().slice(0, 10),
      group_outcome: textOrNull(formData.get("group_outcome")),
      follow_up_actions: textOrNull(formData.get("follow_up_actions")),
    })
    .eq("id", questionnaireId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "reviewed",
    entityType: "subsidiary_questionnaire",
    entityId: questionnaireId,
    metadata: {},
  });

  revalidatePath(`/dashboard/entities/${entityId}`);
}
