import { cookies } from "next/headers";
import { createClient } from "./server";

export const WORKSPACE_COOKIE = "benve_ws";

export type OrgRole =
  | "owner"
  | "admin"
  | "cfo"
  | "controller"
  | "internal_auditor"
  | "external_auditor"
  | "adviser"
  | "viewer";

export type Workspace = {
  org_id: string;
  name: string;
  kind: "firm" | "client";
  status: "active" | "archived";
  role: OrgRole;
  firm_id: string | null;
  firm_name: string | null;
};

export type OrgContext = {
  userId: string;
  userEmail: string | null;
  org: { id: string; name: string } | null;
  role: OrgRole | null;
  /** Every workspace this user has an explicit membership in. */
  workspaces: Workspace[];
  orgKind: "firm" | "client" | null;
  orgStatus: "active" | "archived" | null;
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

  // Workspace-aware path (needs migration 20261021000001). The active workspace is
  // remembered in a cookie, but the cookie is only a preference: it is honoured
  // solely if the user holds a real membership in that workspace, so editing it
  // can never reach another client's data (RLS still decides every read/write).
  const { data: wsData, error: wsError } = await supabase.rpc("p2_my_workspaces");
  if (!wsError && Array.isArray(wsData)) {
    const workspaces = wsData as Workspace[];
    const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
    const active =
      workspaces.find((w) => w.org_id === preferred) ??
      workspaces.find((w) => w.status === "active") ??
      workspaces[0] ??
      null;
    return {
      userId: user.id,
      userEmail: user.email ?? null,
      org: active ? { id: active.org_id, name: active.name } : null,
      role: active?.role ?? null,
      workspaces,
      orgKind: active?.kind ?? null,
      orgStatus: active?.status ?? null,
    };
  }

  // Fallback for databases where the workspace migration is not applied yet.
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
    workspaces: [],
    orgKind: null,
    orgStatus: null,
  };
}
