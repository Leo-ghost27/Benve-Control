"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE, type Workspace } from "@/lib/supabase/org";
import { safeReturnTo, withParams } from "@/lib/phase2/context";

/**
 * Workspace (firm / client) lifecycle actions. These are thin wrappers: every rule
 * (who may create, archive, request deletion, claim access...) is enforced by the
 * SECURITY DEFINER functions in 20261021000001_phase2_tenancy_and_scope.sql, so a
 * forged request fails in the database even if this layer is bypassed.
 */

function field(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function plain(message: string): string {
  return message.split("\nCONTEXT:")[0];
}

function finish(returnTo: string, outcome: { error?: string; notice?: string }): never {
  revalidatePath("/dashboard", "layout");
  redirect(withParams(returnTo, { error: outcome.error, notice: outcome.error ? undefined : outcome.notice }));
}

export async function switchWorkspaceAction(formData: FormData) {
  const target = field(formData, "workspace_id");
  const returnTo = safeReturnTo(formData.get("return_to"), "/dashboard");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_my_workspaces");
  if (error || !Array.isArray(data)) redirect(withParams(returnTo, { error: "Could not load your workspaces." }));
  const match = (data as Workspace[]).find((w) => w.org_id === target);
  // Only a workspace the user actually belongs to can become active.
  if (!match) redirect(withParams(returnTo, { error: "You do not have access to that workspace." }));
  (await cookies()).set(WORKSPACE_COOKIE, match.org_id, { httpOnly: true, sameSite: "lax", path: "/", secure: true });
  revalidatePath("/dashboard", "layout");
  // Period selection is per-workspace: do not carry a period id across clients.
  redirect(withParams("/dashboard", {}));
}

export async function createFirmAction(formData: FormData) {
  const name = field(formData, "name");
  if (!name) finish("/dashboard", { error: "Firm name is required." });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_create_firm", { p_name: name });
  if (error) finish("/dashboard", { error: plain(error.message) });
  (await cookies()).set(WORKSPACE_COOKIE, String(data), { httpOnly: true, sameSite: "lax", path: "/", secure: true });
  finish("/dashboard/settings/clients", { notice: "Firm created. You can now add client workspaces." });
}

export async function convertToFirmAction(formData: FormData) {
  const org = field(formData, "org_id");
  const returnTo = "/dashboard/settings/organization";
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_convert_to_firm", { p_org: org });
  finish(returnTo, error ? { error: plain(error.message) } : { notice: "This organization is now your firm." });
}

export async function createClientAction(formData: FormData) {
  const returnTo = "/dashboard/settings/clients";
  const firm = field(formData, "firm_id");
  const name = field(formData, "name");
  if (!firm || !name) finish(returnTo, { error: "Client name is required." });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_create_client", {
    p_firm: firm,
    p_name: name,
    p_legal_name: field(formData, "legal_name"),
    p_industry: field(formData, "industry"),
    p_fiscal_year_end: field(formData, "fiscal_year_end"),
    p_contact_name: field(formData, "contact_name"),
    p_contact_email: field(formData, "contact_email"),
    p_engagement_type: field(formData, "engagement_type"),
  });
  if (error) finish(returnTo, { error: plain(error.message) });
  (await cookies()).set(WORKSPACE_COOKIE, String(data), { httpOnly: true, sameSite: "lax", path: "/", secure: true });
  finish("/dashboard/settings/organization", { notice: `Client workspace created and opened.` });
}

export async function updateClientDetailsAction(formData: FormData) {
  const returnTo = "/dashboard/settings/organization";
  const org = field(formData, "org_id");
  if (!org) finish(returnTo, { error: "Missing workspace." });
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_profiles")
    .update({
      legal_name: field(formData, "legal_name"),
      industry: field(formData, "industry"),
      fiscal_year_end: field(formData, "fiscal_year_end"),
      primary_contact_name: field(formData, "contact_name"),
      primary_contact_email: field(formData, "contact_email"),
      engagement_type: field(formData, "engagement_type"),
      notes: field(formData, "notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", org);
  const name = field(formData, "name");
  let renameError: string | null = null;
  if (!error && name) {
    const r = await supabase.from("organizations").update({ name }).eq("id", org);
    renameError = r.error ? plain(r.error.message) : null;
  }
  finish(returnTo, error || renameError
    ? { error: error ? plain(error.message) : renameError! }
    : { notice: "Client details saved." });
}

export async function claimClientAccessAction(formData: FormData) {
  const returnTo = "/dashboard/settings/clients";
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_claim_client_access", {
    p_org: field(formData, "org_id"),
    p_role: field(formData, "role"),
    p_reason: field(formData, "reason"),
  });
  finish(returnTo, error ? { error: plain(error.message) } : { notice: "Access granted and logged." });
}

export async function archiveClientAction(formData: FormData) {
  const returnTo = "/dashboard/settings/retention";
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_archive_client", {
    p_org: field(formData, "org_id"),
    p_confirm_name: String(formData.get("confirm_name") ?? ""),
    p_reason: field(formData, "reason"),
  });
  finish(returnTo, error ? { error: plain(error.message) } : { notice: "Client archived." });
}

export async function restoreClientAction(formData: FormData) {
  const returnTo = "/dashboard/settings/retention";
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_restore_client", {
    p_org: field(formData, "org_id"),
    p_reason: field(formData, "reason"),
  });
  finish(returnTo, error ? { error: plain(error.message) } : { notice: "Client restored." });
}

export async function setRetentionAction(formData: FormData) {
  const returnTo = "/dashboard/settings/retention";
  const years = Number(field(formData, "years"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_set_retention", { p_org: field(formData, "org_id"), p_years: years });
  finish(returnTo, error ? { error: plain(error.message) } : { notice: "Retention period saved." });
}

export async function setLegalHoldAction(formData: FormData) {
  const returnTo = "/dashboard/settings/retention";
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_set_legal_hold", {
    p_org: field(formData, "org_id"),
    p_on: field(formData, "on") === "true",
    p_reason: field(formData, "reason"),
  });
  finish(returnTo, error ? { error: plain(error.message) } : { notice: "Legal hold updated." });
}

export async function requestDeletionAction(formData: FormData) {
  const returnTo = "/dashboard/settings/retention";
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_request_deletion", {
    p_org: field(formData, "org_id"),
    p_reason: field(formData, "reason"),
  });
  finish(returnTo, error ? { error: plain(error.message) } : { notice: "Deletion request recorded. No data has been deleted." });
}

export async function decideDeletionAction(formData: FormData) {
  const returnTo = "/dashboard/settings/retention";
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_decide_deletion", {
    p_request: field(formData, "request_id"),
    p_approve: field(formData, "approve") === "true",
    p_note: field(formData, "note"),
  });
  finish(returnTo, error ? { error: plain(error.message) } : { notice: "Decision recorded. Approval does not delete data; purging is a separate, manual step." });
}
