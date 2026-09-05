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

export async function createIcfrReportAction() {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to create an ICFR report.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("icfr_reports")
    .insert({ organization_id: ctx.org.id, created_by: ctx.userId })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "icfr_report",
    entityId: data.id,
    metadata: {},
  });

  revalidatePath("/dashboard/icfr-report");
}

/**
 * Task 42 section A — scope and Task 42 section C — material weakness
 * evaluation and ICFR effectiveness conclusion, saved together since
 * they live on the same page and the same underlying row.
 */
export async function updateIcfrReportAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update an ICFR report.");
  }

  const reportId = String(formData.get("reportId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("icfr_reports")
    .update({
      as_of_date: textOrNull(formData.get("as_of_date")),
      framework: textOrNull(formData.get("framework")),
      scope_notes: textOrNull(formData.get("scope_notes")),
      mw_conclusion: textOrNull(formData.get("mw_conclusion")),
      mw_rationale: textOrNull(formData.get("mw_rationale")),
      icfr_conclusion: textOrNull(formData.get("icfr_conclusion")),
      draft_text: textOrNull(formData.get("draft_text")),
    })
    .eq("id", reportId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "updated",
    entityType: "icfr_report",
    entityId: reportId,
    metadata: {},
  });

  revalidatePath("/dashboard/icfr-report");
}

export async function submitIcfrReportForReviewAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const reportId = String(formData.get("reportId"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("icfr_reports")
    .update({ status: "under_review" })
    .eq("id", reportId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "submitted",
    entityType: "icfr_report",
    entityId: reportId,
    metadata: {},
  });

  revalidatePath("/dashboard/icfr-report");
}

export async function approveIcfrReportAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) throw new Error("You must belong to an organization.");

  const reportId = String(formData.get("reportId"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("icfr_reports")
    .update({ status: "approved" })
    .eq("id", reportId)
    .eq("organization_id", ctx.org.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "approved",
    entityType: "icfr_report",
    entityId: reportId,
    metadata: {},
  });

  revalidatePath("/dashboard/icfr-report");
}
