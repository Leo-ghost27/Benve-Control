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
 * Reusable "add a row to the review/approval trail" action, shared by the
 * ICFR report page (Task 42 section B) and the certification page
 * (Task 43 sections 3C/4C) rather than duplicating this per module.
 */
export async function addReviewApprovalAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to record a review.");
  }

  const targetType = String(formData.get("targetType")); // "icfr_report" | "certification"
  const targetId = String(formData.get("targetId"));
  const returnPath = String(formData.get("returnPath"));

  const supabase = await createClient();
  const { error } = await supabase.from("review_approvals").insert({
    organization_id: ctx.org.id,
    target_type: targetType,
    target_id: targetId,
    reviewer_name: textOrNull(formData.get("reviewer_name")),
    reviewer_role: textOrNull(formData.get("reviewer_role")),
    status: textOrNull(formData.get("status")) ?? "reviewed",
    review_date: new Date().toISOString().slice(0, 10),
    comments: textOrNull(formData.get("comments")),
  });

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "added",
    entityType: "review_approval",
    entityId: targetId,
    metadata: { target_type: targetType },
  });

  revalidatePath(returnPath);
}
