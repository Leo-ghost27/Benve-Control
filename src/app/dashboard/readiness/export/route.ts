import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadReadinessBase, PLANNING_DISCLAIMER } from "@/lib/phase2/readiness-data";
import { can } from "@/lib/phase2/permissions";
import { memberName } from "@/lib/phase2/ccm-queries";
import { toCsv } from "@/lib/phase2/csv";

export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Readiness pack as CSV: metadata block, then areas, gaps and roadmap actions of the selected assessment. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const base = await loadReadinessBase({ period: sp.get("period") ?? undefined, assessment: sp.get("assessment") ?? undefined });
  if (!base) return NextResponse.json({ error: "Not signed in or no organization." }, { status: 401 });
  const { p2, assessment, members } = base;
  const { ctx, period } = p2;
  if (!can(ctx.role, "readiness.view_internal")) return NextResponse.json({ error: "Your role cannot export readiness records." }, { status: 403 });
  if (!period || !assessment) return NextResponse.json({ error: "No assessment to export." }, { status: 404 });

  const supabase = await createClient();
  const [{ data: areas, error: e1 }, { data: gaps, error: e2 }] = await Promise.all([
    supabase.from("readiness_areas").select("area_name, current_maturity, target_maturity, readiness_score, score_rationale").eq("organization_id", ctx.org.id).eq("assessment_id", assessment.id).order("area_name"),
    supabase.from("readiness_gaps").select("id, requirement, description, gap_severity, status, target_date, owner_user_id, remediation_action, evidence_id, related_control_id, related_deficiency_id, readiness_areas(area_name)").eq("organization_id", ctx.org.id).eq("readiness_assessment_id", assessment.id).order("target_date"),
  ]);
  const ids = (gaps ?? []).map((g) => g.id);
  const { data: actions, error: e3 } = ids.length
    ? await supabase.from("readiness_roadmap_actions").select("gap_id, action_ref, description, owner_user_id, target_date, status, priority").eq("organization_id", ctx.org.id).in("gap_id", ids)
    : { data: [], error: null };
  const err = e1 ?? e2 ?? e3;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  const approved = assessment.status === "approved";
  const meta = [
    ["Report", "ICFR readiness pack (management planning assessment)"],
    ["Date generated", new Date().toISOString()],
    ["Reporting period", `${period.label} (${period.start_date} to ${period.end_date})`],
    ["Filters applied", `Assessment "${assessment.target_milestone}"`],
    ["Prepared by", memberName(members, assessment.prepared_by)],
    ["Data scope", `${ctx.org.name}; ${(areas ?? []).length} area(s), ${(gaps ?? []).length} gap(s), ${(actions ?? []).length} action(s)`],
    ["Status", approved ? `Approved ${assessment.approved_at}` : `DRAFT (${assessment.status}) - not approved`],
    ["Filer status", assessment.current_filer_status ?? ""],
    ["Maturity level", assessment.maturity_level ?? ""],
    ["Overall score (planning)", assessment.overall_score ?? ""],
    ["Management conclusion", assessment.management_conclusion ?? ""],
    ["Notice", PLANNING_DISCLAIMER],
  ].map(([k, v]) => toCsv(["", ""], [[k, v]]).split("\r\n").slice(1, 2)[0]).join("\r\n");

  const gapName = new Map((gaps ?? []).map((g) => [g.id, g.requirement ?? g.description ?? ""]));
  const body =
    meta + "\r\n\r\nREADINESS AREAS\r\n" +
    toCsv(["area", "current_maturity", "target_maturity", "score", "rationale"], (areas ?? []).map((a) => [a.area_name, a.current_maturity, a.target_maturity, a.readiness_score, a.score_rationale])) +
    "\r\nGAPS\r\n" +
    toCsv(["requirement", "description", "area", "priority", "status", "owner", "target_date", "remediation_action", "evidence_id", "control_id", "deficiency_id"],
      (gaps ?? []).map((g) => [g.requirement, g.description, one(g.readiness_areas as { area_name: string } | { area_name: string }[] | null)?.area_name, g.gap_severity, g.status, memberName(members, g.owner_user_id), g.target_date, g.remediation_action, g.evidence_id, g.related_control_id, g.related_deficiency_id])) +
    "\r\nROADMAP ACTIONS\r\n" +
    toCsv(["action_ref", "description", "gap", "owner", "target_date", "priority", "status"],
      (actions ?? []).map((a) => [a.action_ref, a.description, gapName.get(a.gap_id), memberName(members, a.owner_user_id), a.target_date, a.priority, a.status]));

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="readiness-pack-${period.label.replace(/[^\w-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
