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

export async function addCcmRuleAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const supabase = await createClient();
  const { error } = await supabase.from("ccm_rules").insert({
    organization_id: ctx.org.id,
    control_id: textOrNull(formData.get("control_id")),
    rule_ref: textOrNull(formData.get("rule_ref")),
    description: textOrNull(formData.get("description")),
    frequency: textOrNull(formData.get("frequency")),
    severity: textOrNull(formData.get("severity")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "ccm_rule",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/ccm");
}

export async function addCcmExceptionAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const supabase = await createClient();
  const { error } = await supabase.from("ccm_exceptions").insert({
    organization_id: ctx.org.id,
    rule_id: textOrNull(formData.get("rule_id")),
    control_id: textOrNull(formData.get("control_id")),
    exception_ref: textOrNull(formData.get("exception_ref")),
    item_date: textOrNull(formData.get("item_date")) ?? new Date().toISOString().slice(0, 10),
    source_record_ref: textOrNull(formData.get("source_record_ref")),
    amount: numberOrNull(formData.get("amount")),
    initial_assessment: textOrNull(formData.get("initial_assessment")),
    owner: textOrNull(formData.get("owner")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "flagged",
    entityType: "ccm_exception",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/ccm");
}

export async function updateCcmExceptionStatusAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const exceptionId = String(formData.get("exceptionId"));
  const status = String(formData.get("status"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("ccm_exceptions")
    .update({ status })
    .eq("id", exceptionId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: status,
    entityType: "ccm_exception",
    entityId: exceptionId,
    metadata: {},
  });

  revalidatePath("/dashboard/ccm");
}

export async function linkExceptionToDeficiencyAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const exceptionId = String(formData.get("exceptionId"));
  const deficiencyId = textOrNull(formData.get("deficiencyId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("ccm_exceptions")
    .update({ linked_deficiency_id: deficiencyId })
    .eq("id", exceptionId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "linked",
    entityType: "ccm_exception",
    entityId: exceptionId,
    metadata: { deficiency_id: deficiencyId },
  });

  revalidatePath("/dashboard/ccm");
}

export async function addFollowUpAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const supabase = await createClient();
  const { error } = await supabase.from("follow_ups").insert({
    organization_id: ctx.org.id,
    ccm_exception_id: textOrNull(formData.get("ccmExceptionId")),
    followup_ref: textOrNull(formData.get("followup_ref")),
    owner: textOrNull(formData.get("owner")),
    root_cause_draft: textOrNull(formData.get("root_cause_draft")),
    remediation_action: textOrNull(formData.get("remediation_action")),
    target_completion: textOrNull(formData.get("target_completion")),
    escalation_rule: textOrNull(formData.get("escalation_rule")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "follow_up",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/ccm");
}

export async function updateFollowUpStatusAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const followUpId = String(formData.get("followUpId"));
  const status = String(formData.get("status"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("follow_ups")
    .update({ status })
    .eq("id", followUpId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: status,
    entityType: "follow_up",
    entityId: followUpId,
    metadata: {},
  });

  revalidatePath("/dashboard/ccm");
}
