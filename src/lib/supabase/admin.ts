import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. SERVER-ONLY — never import this into a
 * Client Component or expose SUPABASE_SERVICE_ROLE_KEY with a
 * NEXT_PUBLIC_ prefix. This bypasses Row Level Security entirely, so
 * every function that uses it must independently verify authorization
 * (e.g. matching a client_links token) before touching any data.
 *
 * Used only for the anonymous, token-based client evidence flow, where
 * there is no Supabase Auth session to rely on RLS with.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. The client evidence flow cannot run without it."
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Generates a short-lived signed URL for a file in the private
 * evidence-files bucket. Callers must have already verified — via a
 * normal RLS-respecting query — that the caller is allowed to see the
 * evidence_requests row this path belongs to, before calling this.
 */
export async function getEvidenceFileSignedUrl(storagePath: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("evidence-files")
    .createSignedUrl(storagePath, 60 * 10); // 10 minutes

  if (error || !data) return null;
  return data.signedUrl;
}
