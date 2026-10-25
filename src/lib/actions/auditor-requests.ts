"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";

/** External-auditor request workflow. All rules live in the database functions (20261022000130). */

function field(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
const plain = (m: string) => m.split("\nCONTEXT:")[0];

function back(id: string | null, outcome: { error?: string; notice?: string }): never {
  revalidatePath("/dashboard", "layout");
  redirect(withParams(id ? `/dashboard/auditor-requests/${id}` : "/dashboard/auditor-requests", {
    error: outcome.error, notice: outcome.error ? undefined : outcome.notice,
  }));
}

export async function createAuditorRequestAction(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_create_auditor_request", {
    p_org: field(formData, "org_id"), p_title: field(formData, "title") ?? "", p_description: field(formData, "description"),
    p_due: field(formData, "due_date"), p_priority: field(formData, "priority") ?? "normal",
    p_test_plan: null, p_period: null,
  });
  if (error) back(null, { error: plain(error.message) });
  back(String(data), { notice: "Request raised." });
}

export async function assignAuditorRequestAction(formData: FormData) {
  const id = field(formData, "request_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_assign_auditor_request", { p_request: id, p_user: field(formData, "assigned_to") });
  back(id, error ? { error: plain(error.message) } : { notice: "Assigned." });
}

export async function respondAuditorRequestAction(formData: FormData) {
  const id = field(formData, "request_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_respond_auditor_request", { p_request: id, p_body: field(formData, "body") ?? "" });
  back(id, error ? { error: plain(error.message) } : { notice: "Response recorded." });
}

export async function closeAuditorRequestAction(formData: FormData) {
  const id = field(formData, "request_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_close_auditor_request", { p_request: id, p_conclusion: field(formData, "conclusion") ?? "" });
  back(id, error ? { error: plain(error.message) } : { notice: "Request closed with your conclusion." });
}

export async function reopenAuditorRequestAction(formData: FormData) {
  const id = field(formData, "request_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_reopen_auditor_request", { p_request: id, p_reason: field(formData, "reason") ?? "" });
  back(id, error ? { error: plain(error.message) } : { notice: "Request reopened." });
}

export async function withdrawAuditorRequestAction(formData: FormData) {
  const id = field(formData, "request_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_withdraw_auditor_request", { p_request: id, p_reason: field(formData, "reason") ?? "" });
  back(id, error ? { error: plain(error.message) } : { notice: "Request withdrawn." });
}

export async function addRequestCommentAction(formData: FormData) {
  const id = field(formData, "request_id");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("workpaper_comments").insert({
    organization_id: field(formData, "org_id"), target_type: "auditor_request", target_id: id,
    visibility: "internal", body: field(formData, "body") ?? "", author_id: user?.id,
  });
  back(id, error ? { error: plain(error.message) } : { notice: "Internal note added (not visible to the external auditor)." });
}
