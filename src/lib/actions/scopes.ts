"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";

/** Engagement scope + client sign-off. Workflow rules are enforced in the database. */

function field(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
const plain = (m: string) => m.split("\nCONTEXT:")[0];

function back(id: string | null, outcome: { error?: string; notice?: string }): never {
  revalidatePath("/dashboard", "layout");
  redirect(withParams(id ? `/dashboard/scope/${id}` : "/dashboard/scope", { error: outcome.error, notice: outcome.error ? undefined : outcome.notice }));
}

export async function createScopeAction(formData: FormData) {
  const p2 = await getPhase2Context(field(formData, "period") ?? undefined);
  if (!p2?.period) back(null, { error: "Create a reporting period first." });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("engagement_scopes")
    .insert({
      organization_id: p2.ctx.org.id,
      reporting_period_id: p2.period.id,
      title: field(formData, "title") ?? "Engagement scope",
      objective: field(formData, "objective"),
      scope_summary: field(formData, "scope_summary"),
      exclusions: field(formData, "exclusions"),
    })
    .select("id")
    .single();
  if (error) back(null, { error: plain(error.message) });
  back(data.id, { notice: "Draft scope created." });
}

export async function updateScopeAction(formData: FormData) {
  const id = field(formData, "scope_id");
  const supabase = await createClient();
  const { error } = await supabase
    .from("engagement_scopes")
    .update({
      title: field(formData, "title") ?? "Engagement scope",
      objective: field(formData, "objective"),
      scope_summary: field(formData, "scope_summary"),
      exclusions: field(formData, "exclusions"),
    })
    .eq("id", id);
  back(id, error ? { error: plain(error.message) } : { notice: "Scope saved." });
}

export async function addScopeItemAction(formData: FormData) {
  const id = field(formData, "scope_id");
  const org = field(formData, "org_id");
  const supabase = await createClient();
  const { error } = await supabase.from("engagement_scope_items").insert({
    organization_id: org,
    scope_id: id,
    control_id: field(formData, "control_id"),
    description: field(formData, "description") ?? "",
    rationale: field(formData, "rationale"),
  });
  back(id, error ? { error: plain(error.message) } : { notice: "Scope item added." });
}

export async function removeScopeItemAction(formData: FormData) {
  const id = field(formData, "scope_id");
  const supabase = await createClient();
  const { error } = await supabase.from("engagement_scope_items").delete().eq("id", field(formData, "item_id"));
  back(id, error ? { error: plain(error.message) } : { notice: "Scope item removed." });
}

export async function submitScopeAction(formData: FormData) {
  const id = field(formData, "scope_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_submit_scope", { p_scope: id });
  back(id, error ? { error: plain(error.message) } : { notice: "Submitted to the client for sign-off." });
}

export async function decideScopeAction(formData: FormData) {
  const id = field(formData, "scope_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_decide_scope", {
    p_scope: id,
    p_decision: field(formData, "decision"),
    p_comment: field(formData, "comment"),
    // the exact content hash the reviewer was looking at when the page rendered
    p_expected_hash: field(formData, "content_hash"),
  });
  back(id, error ? { error: plain(error.message) } : { notice: "Decision recorded against this exact version." });
}

export async function reopenScopeAction(formData: FormData) {
  const id = field(formData, "scope_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_reopen_scope", { p_scope: id, p_reason: field(formData, "reason") });
  back(id, error ? { error: plain(error.message) } : { notice: "Scope reopened as a new draft version. The earlier approval is preserved in history." });
}
