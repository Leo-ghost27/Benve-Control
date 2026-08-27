import { createClient } from "./server";

export type OrgRole = "owner" | "auditor" | "client" | "viewer";

export type OrgContext = {
  userId: string;
  userEmail: string | null;
  org: { id: string; name: string } | null;
  role: OrgRole | null;
};

/**
 * Resolves the signed-in user and, if they belong to one, their
 * organization and role within it. Returns `org: null` (not an error)
 * when the user has no organization membership yet — callers should
 * render an empty state in that case, not an error state.
 *
 * Throws only for unexpected query failures, so callers can distinguish
 * "no org yet" from "something went wrong."
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const org = membership?.organizations
    ? {
        // organizations comes back as an object here since the FK is
        // singular (one org per membership row), but Supabase's generated
        // types treat joined tables as arrays — normalize defensively.
        id: Array.isArray(membership.organizations)
          ? membership.organizations[0]?.id
          : (membership.organizations as { id: string; name: string }).id,
        name: Array.isArray(membership.organizations)
          ? membership.organizations[0]?.name
          : (membership.organizations as { id: string; name: string }).name,
      }
    : null;

  return {
    userId: user.id,
    userEmail: user.email ?? null,
    org: org && org.id ? { id: org.id, name: org.name } : null,
    role: (membership?.role as OrgRole | undefined) ?? null,
  };
}
