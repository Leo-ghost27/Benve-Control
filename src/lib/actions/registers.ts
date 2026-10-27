"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { withParams } from "@/lib/phase2/context";

/**
 * Process / risk register and remediation tracking. Permissions are enforced by the
 * existing row-level-security policies (owner/admin/internal_auditor create and edit;
 * remediation assignees may update their own tasks); these actions only report outcomes.
 */

function field(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
const plain = (m: string) => m.split("\nCONTEXT:")[0];

function back(path: string, outcome: { error?: string; notice?: string }): never {
  revalidatePath(path);
  redirect(withParams(path, { error: outcome.error, notice: outcome.error ? undefined : outcome.notice }));
}

const REG = "/dashboard/risk-register";
const REM = "/dashboard/remediation";

export async function createProcessAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) back(REG, { error: "No workspace selected." });
  const supabase = await createClient();
  const { error } = await supabase.from("processes").insert({
    organization_id: ctx.org!.id, name: field(formData, "name") ?? "", description: field(formData, "description"), owner: field(formData, "owner"),
  });
  back(REG, error ? { error: plain(error.message) } : { notice: "Process added." });
}

export async function createRiskAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) back(REG, { error: "No workspace selected." });
  const supabase = await createClient();
  const { error } = await supabase.from("risks").insert({
    organization_id: ctx.org!.id, title: field(formData, "title") ?? "", description: field(formData, "description"),
    rating: field(formData, "rating"), owner: field(formData, "owner"), process_id: field(formData, "process_id"),
  });
  back(REG, error ? { error: plain(error.message) } : { notice: "Risk added." });
}

export async function linkControlRiskAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) back(REG, { error: "No workspace selected." });
  const supabase = await createClient();
  const { error } = await supabase.from("control_risks").insert({
    organization_id: ctx.org!.id, control_id: field(formData, "control_id"), risk_id: field(formData, "risk_id"),
  });
  back(REG, error ? { error: plain(error.message) } : { notice: "Control linked to risk." });
}

export async function unlinkControlRiskAction(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("control_risks").delete().eq("id", field(formData, "link_id"));
  back(REG, error ? { error: plain(error.message) } : { notice: "Link removed." });
}

export async function createRemediationTaskAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) back(REM, { error: "No workspace selected." });
  const supabase = await createClient();
  const { error } = await supabase.from("remediation_tasks").insert({
    organization_id: ctx.org!.id, deficiency_id: field(formData, "deficiency_id"), title: field(formData, "title") ?? "",
    description: field(formData, "description"), assigned_to: field(formData, "assigned_to"), due_date: field(formData, "due_date"),
    root_cause: field(formData, "root_cause"), status: "not_started",
  });
  back(REM, error ? { error: plain(error.message) } : { notice: "Remediation task created." });
}

export async function updateRemediationTaskAction(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("remediation_tasks").update({
    status: field(formData, "status") ?? "not_started", assigned_to: field(formData, "assigned_to"), due_date: field(formData, "due_date"),
    root_cause: field(formData, "root_cause"), retest_result: field(formData, "retest_result"), updated_at: new Date().toISOString(),
  }).eq("id", field(formData, "task_id")).select("id");
  if (!error && (!data || data.length === 0)) back(REM, { error: "You do not have permission to update that task." });
  back(REM, error ? { error: plain(error.message) } : { notice: "Task updated." });
}
