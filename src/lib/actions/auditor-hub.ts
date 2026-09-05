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

/**
 * Task 44 section 2C — controlled access settings. Restricted to
 * owner/admin by RLS; this upserts the single per-org settings row.
 */
export async function updateAccessSettingsAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const supabase = await createClient();
  const { error } = await supabase.from("access_settings").upsert({
    organization_id: ctx.org.id,
    reviewer_notes_visible_to_auditor: formData.get("reviewer_notes_visible") === "on",
    draft_classifications_visible: formData.get("draft_classifications_visible") === "on",
    sample_logic_visible: formData.get("sample_logic_visible") === "on",
    updated_at: new Date().toISOString(),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "access_settings",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/auditor-hub");
}

/**
 * Task 44 section 3A — record a walkthrough.
 */
export async function addWalkthroughAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const supabase = await createClient();
  const { error } = await supabase.from("walkthroughs").insert({
    organization_id: ctx.org.id,
    control_id: textOrNull(formData.get("control_id")),
    walkthrough_date: textOrNull(formData.get("walkthrough_date")),
    participants: textOrNull(formData.get("participants")),
    status: textOrNull(formData.get("status")) ?? "complete",
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "added",
    entityType: "walkthrough",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/auditor-hub");
}

/**
 * Task 44 section 4A — log a communication with the external auditor.
 */
export async function addAuditCommunicationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const supabase = await createClient();
  const { error } = await supabase.from("audit_communications").insert({
    organization_id: ctx.org.id,
    from_party: textOrNull(formData.get("from_party")),
    to_party: textOrNull(formData.get("to_party")),
    subject: textOrNull(formData.get("subject")),
    body: textOrNull(formData.get("body")),
    created_by: ctx.userId,
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "logged",
    entityType: "audit_communication",
    entityId: ctx.org.id,
    metadata: {},
  });

  revalidatePath("/dashboard/auditor-hub");
}

export async function closeAuditCommunicationAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const communicationId = String(formData.get("communicationId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("audit_communications")
    .update({ status: "closed" })
    .eq("id", communicationId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "closed",
    entityType: "audit_communication",
    entityId: communicationId,
    metadata: {},
  });

  revalidatePath("/dashboard/auditor-hub");
}
