"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE } from "@/lib/supabase/org";
import { withParams } from "@/lib/phase2/context";

/** Team / invitation actions. Rules live in the database (see the tenancy migration). */

const BACK = "/dashboard/settings/team";

function field(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
const plain = (m: string) => m.split("\nCONTEXT:")[0];

function finish(outcome: { error?: string; notice?: string }): never {
  revalidatePath("/dashboard", "layout");
  redirect(withParams(BACK, { error: outcome.error, notice: outcome.error ? undefined : outcome.notice }));
}

export type InviteState = { link?: string; error?: string; email?: string } | null;

/** The raw invitation token is returned once, to the inviter only (never stored, never put in a URL). */
export async function inviteMemberAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const org = field(formData, "org_id");
  const email = field(formData, "email");
  const role = field(formData, "role");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_invite_member", { p_org: org, p_email: email, p_role: role });
  if (error) return { error: plain(error.message) };
  const row = Array.isArray(data) ? data[0] : data;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  revalidatePath("/dashboard/settings/team");
  return { link: `${proto}://${host}/accept-invite/${row.token}`, email: email ?? undefined };
}

export async function revokeInvitationAction(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_revoke_invitation", { p_invitation: field(formData, "invitation_id") });
  finish(error ? { error: plain(error.message) } : { notice: "Invitation revoked." });
}

export async function changeMemberRoleAction(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_change_member_role", {
    p_org: field(formData, "org_id"),
    p_user: field(formData, "user_id"),
    p_role: field(formData, "role"),
  });
  finish(error ? { error: plain(error.message) } : { notice: "Role updated for this workspace." });
}

export async function removeMemberAction(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_remove_member", {
    p_org: field(formData, "org_id"),
    p_user: field(formData, "user_id"),
  });
  finish(error ? { error: plain(error.message) } : { notice: "Access removed." });
}

export async function setPermissionAction(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_set_permission", {
    p_org: field(formData, "org_id"),
    p_user: field(formData, "user_id"),
    p_perm: field(formData, "permission"),
    p_granted: field(formData, "granted") === "true",
  });
  finish(error ? { error: plain(error.message) } : { notice: "Engagement permission updated." });
}

export async function acceptInvitationAction(formData: FormData) {
  const token = field(formData, "token");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_accept_invitation", { p_token: token });
  if (error) redirect(`/accept-invite/invalid?error=${encodeURIComponent(plain(error.message))}`);
  (await cookies()).set(WORKSPACE_COOKIE, String(data), { httpOnly: true, sameSite: "lax", path: "/", secure: true });
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}
