import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, type Phase2Context } from "@/lib/phase2/context";
import { loadMembers, type Member } from "@/lib/phase2/ccm-queries";

export const PLANNING_DISCLAIMER =
  "Management planning assessment. Scores and conclusions are management's own judgement for planning purposes and are not a regulatory determination, an attestation, or a legal opinion.";

export const EDITABLE_STATUSES = ["draft", "prepared", "returned", "reopened"];

export type Assessment = {
  id: string;
  reporting_period_id: string;
  target_milestone: string | null;
  target_date: string | null;
  current_filer_status: string | null;
  maturity_level: string | null;
  overall_score: number | null;
  management_conclusion: string | null;
  assumptions: string | null;
  timeline_risks: string | null;
  status: string;
  prepared_by: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReadinessBase = {
  p2: Phase2Context;
  assessments: Assessment[];
  assessment: Assessment | null;
  members: Member[];
};

/** Resolve context, the period's assessments, the selected assessment (?assessment=, default latest), and members. */
export async function loadReadinessBase(params: { period?: string; assessment?: string }): Promise<ReadinessBase | null> {
  const p2 = await getPhase2Context(params.period);
  if (!p2) return null;
  if (!p2.period) return { p2, assessments: [], assessment: null, members: [] };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("readiness_assessments")
    .select("*")
    .eq("organization_id", p2.ctx.org.id)
    .eq("reporting_period_id", p2.period.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const assessments = (data ?? []) as Assessment[];
  const assessment = assessments.find((a) => a.id === params.assessment) ?? assessments[0] ?? null;
  const members = await loadMembers(supabase, p2.ctx.org.id).catch(() => []);
  return { p2, assessments, assessment, members };
}
