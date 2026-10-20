import { getOrgContext, type OrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";

export type Period = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: string;
};

export type Phase2Context = {
  ctx: OrgContext & { org: { id: string; name: string } };
  periods: Period[];
  period: Period | null;
};

/** Resolve the signed-in org + selected reporting period (?period=<id>, default: latest). */
export async function getPhase2Context(periodParam?: string): Promise<Phase2Context | null> {
  const ctx = await getOrgContext();
  if (!ctx?.org) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reporting_periods")
    .select("id, label, start_date, end_date, status")
    .eq("organization_id", ctx.org.id)
    .order("end_date", { ascending: false });
  if (error) throw error;
  const periods = (data ?? []) as Period[];
  const period = periods.find((p) => p.id === periodParam) ?? periods[0] ?? null;
  return { ctx: ctx as Phase2Context["ctx"], periods, period };
}

/** Only allow same-app return paths (prevents open redirects). */
export function safeReturnTo(value: FormDataEntryValue | null, fallback: string) {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/dashboard/") && !v.startsWith("//") ? v : fallback;
}

export function withParams(path: string, params: Record<string, string | undefined>) {
  const [base, qs = ""] = path.split("?");
  const sp = new URLSearchParams(qs);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) sp.delete(k);
    else sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}
