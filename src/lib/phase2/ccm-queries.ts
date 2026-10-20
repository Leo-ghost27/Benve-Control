import type { SupabaseClient } from "@supabase/supabase-js";

export type ExceptionFilters = {
  period?: string;
  status?: string;
  severity?: string;
  rule?: string;
  assigned?: string;
  source?: string;
  month?: string; // YYYY-MM
  q?: string;
};

export const EXCEPTION_COLUMNS =
  "id, exception_ref, detected_at, source_record_ref, description, severity, status, source_type, assigned_to, amount, " +
  "linked_deficiency_id, linked_exception_id, import_batch_id, false_positive_reason, updated_at, " +
  "ccm_rules(rule_code, name), controls(code, title)";

function clean(v: string | undefined) {
  return v && v.trim() !== "" ? v.trim() : undefined;
}

/** Single source of truth for exception filtering: used by the list page AND the CSV export. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyExceptionFilters(query: any, f: ExceptionFilters) {
  const period = clean(f.period);
  if (period) query = query.eq("reporting_period_id", period);
  const status = clean(f.status);
  if (status) query = query.eq("status", status);
  const severity = clean(f.severity);
  if (severity) query = query.eq("severity", severity);
  const rule = clean(f.rule);
  if (rule) query = query.eq("rule_id", rule);
  const assigned = clean(f.assigned);
  if (assigned === "unassigned") query = query.is("assigned_to", null);
  else if (assigned) query = query.eq("assigned_to", assigned);
  const source = clean(f.source);
  if (source) query = query.eq("source_type", source);
  const month = clean(f.month);
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
    const end = new Date(Date.UTC(y, m, 1)).toISOString();
    query = query.gte("detected_at", start).lt("detected_at", end);
  }
  const q = clean(f.q);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`description.ilike.%${safe}%,source_record_ref.ilike.%${safe}%,exception_ref.ilike.%${safe}%`);
  }
  return query;
}

export type Member = { user_id: string; role: string; full_name: string | null; email: string | null };

export async function loadMembers(supabase: SupabaseClient, orgId: string): Promise<Member[]> {
  const { data, error } = await supabase.rpc("p2_org_members", { p_org: orgId });
  if (error) throw error;
  return (data ?? []) as Member[];
}

export function memberName(members: Member[], id: string | null | undefined) {
  if (!id) return "Unassigned";
  const m = members.find((x) => x.user_id === id);
  return m ? m.full_name || m.email || id.slice(0, 8) : id.slice(0, 8);
}

export function monthKey(iso: string) {
  return iso.slice(0, 7);
}

export function lastMonths(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}
