import { SupabaseClient } from "@supabase/supabase-js";

type LogChangeParams = {
  supabase: SupabaseClient;
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
};

/**
 * Records a change-history entry. Failures are logged but never thrown —
 * a broken history write should not block the underlying save.
 */
export async function logChange({
  supabase,
  organizationId,
  actorId,
  action,
  entityType,
  entityId,
  metadata,
}: LogChangeParams) {
  const { error } = await supabase.from("audit_log").insert({
    organization_id: organizationId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata: metadata ?? {},
  });

  if (error) {
    console.error("Failed to record change history:", error.message);
  }
}
