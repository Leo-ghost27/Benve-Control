"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";

/**
 * Workpaper review actions. Thin wrappers: every rule (explicit approval authority,
 * separate reviewer, exact-version binding, reopen rationale) is enforced by the
 * database functions in 20261022000100_phase2_review_workflow.sql.
 */

function field(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
const plain = (m: string) => m.split("\nCONTEXT:")[0];

function back(planId: string | null, outcome: { error?: string; notice?: string }): never {
  revalidatePath("/dashboard", "layout");
  redirect(withParams(planId ? `/dashboard/test-plans/${planId}` : "/dashboard/my-work", {
    error: outcome.error,
    notice: outcome.error ? undefined : outcome.notice,
  }));
}

export async function assignTestPlanAction(formData: FormData) {
  const plan = field(formData, "plan_id");
  const supabase = await createClient();
  const { error } = await supabase
    .from("test_plans")
    .update({ assigned_to: field(formData, "assigned_to"), due_date: field(formData, "due_date") })
    .eq("id", plan);
  back(plan, error ? { error: plain(error.message) } : { notice: "Assignment saved." });
}

export async function submitForReviewAction(formData: FormData) {
  const plan = field(formData, "plan_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_submit_for_review", { p_type: "test_plan", p_record: plan });
  back(plan, error ? { error: plain(error.message) } : { notice: "Submitted for review. The content is now fingerprinted; any change will withdraw the submission." });
}

export async function decideReviewAction(formData: FormData) {
  const plan = field(formData, "plan_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_decide_review", {
    p_review: field(formData, "review_id"),
    p_decision: field(formData, "decision"),
    p_comment: field(formData, "comment"),
    // the exact version the reviewer was looking at when the page rendered
    p_expected_hash: field(formData, "content_hash"),
  });
  back(plan, error ? { error: plain(error.message) } : { notice: "Decision recorded against this exact version." });
}

export async function reopenReviewAction(formData: FormData) {
  const plan = field(formData, "plan_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_reopen_review", { p_review: field(formData, "review_id"), p_reason: field(formData, "reason") });
  back(plan, error ? { error: plain(error.message) } : { notice: "Reopened. The earlier approval is kept in history." });
}

export async function addPlanCommentAction(formData: FormData) {
  const plan = field(formData, "plan_id");
  const org = field(formData, "org_id");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("workpaper_comments").insert({
    organization_id: org,
    target_type: "test_plan",
    target_id: plan,
    visibility: field(formData, "visibility") === "shareable" ? "shareable" : "internal",
    body: field(formData, "body") ?? "",
    author_id: user?.id,
  });
  back(plan, error ? { error: plain(error.message) } : { notice: "Comment added." });
}

export async function setReviewSettingAction(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_set_review_setting", {
    p_org: field(formData, "org_id"),
    p_require_separate: field(formData, "require_separate") === "true",
  });
  revalidatePath("/dashboard/settings/team");
  redirect(withParams("/dashboard/settings/team", error ? { error: plain(error.message) } : { notice: "Review setting saved." }));
}
