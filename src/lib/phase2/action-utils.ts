import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOrgContext, type OrgContext } from "@/lib/supabase/org";
import { safeReturnTo, withParams } from "@/lib/phase2/context";
import { can, type Capability } from "@/lib/phase2/permissions";

/** Shared helpers for Phase 2 server actions (not itself a "use server" module). */
export type Authed = OrgContext & { org: { id: string; name: string } };

export function txt(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function num(fd: FormData, key: string): number | null {
  const s = txt(fd, key);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Authenticate, check the capability (friendly message), return org context + safe return path. */
export async function gate(fd: FormData, cap: Capability, fallback: string) {
  const returnTo = safeReturnTo(fd.get("return_to"), fallback);
  const ctx = await getOrgContext();
  if (!ctx?.org) redirect(withParams(returnTo, { error: "You must belong to an organization." }));
  if (!can(ctx.role, cap)) redirect(withParams(returnTo, { error: "Permission denied for your role." }));
  return { ctx: ctx as Authed, returnTo };
}

export function done(returnTo: string, notice: string): never {
  revalidatePath("/dashboard", "layout");
  redirect(withParams(returnTo, { notice, error: undefined }));
}

export function fail(returnTo: string, message: string): never {
  redirect(withParams(returnTo, { error: message, notice: undefined }));
}

/** Translate database errors into plain language; everything else passes through. */
export function friendly(message: string): string {
  if (/row-level security/i.test(message)) return "Permission denied: your role cannot make this change.";
  if (/Cross-tenant/i.test(message)) return "That record belongs to a different organization.";
  if (/uq_ccm_rules_code/i.test(message)) return "A rule with that code already exists.";
  if (/is not a member of this organization/i.test(message)) return "That user is not a member of this organization.";
  return message.split("\nCONTEXT:")[0];
}
