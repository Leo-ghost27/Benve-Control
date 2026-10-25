import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { GAP_LABELS } from "@/lib/phase2/itgc";
import { toCsv } from "@/lib/phase2/csv";

export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

type Cov = { generated_at: string; systems: { name: string; relevance: string | null; criticality: string | null; in_scope: boolean; categories: Record<string, number>; itgc_count: number; automated_count: number; dependent_controls: number; gaps: { code: string; ref: string | null }[]; depends: { code: string; type: string }[] }[]; totals: Record<string, number> };

/** kind = coverage | systems | controls | exceptions. Internal roles only; each file leads with a metadata block. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const p2 = await getPhase2Context();
  if (!p2) return NextResponse.json({ error: "Not signed in or no organization." }, { status: 401 });
  const { ctx } = p2;
  if (!can(ctx.role, "itgc.view_internal")) return NextResponse.json({ error: "Your role cannot export ITGC workpapers." }, { status: 403 });
  const supabase = await createClient();
  const members = await loadMembers(supabase, ctx.org.id).catch(() => []);
  const kind = ["coverage", "systems", "controls", "exceptions"].includes(sp.get("kind") ?? "") ? sp.get("kind")! : "coverage";
  const filters: string[] = [];
  const meta = (title: string, n: number) => [
    ["Report", title], ["Date generated", new Date().toISOString()], ["Reporting period", "Not period-scoped (current state)"],
    ["Filters applied", filters.length ? filters.join("; ") : "None"], ["Prepared by", ctx.userEmail ?? ctx.userId],
    ["Data scope", `${ctx.org.name}; ${n} row(s) as stored at generation time`], ["Status", "Draft (unapproved export; not a management-approved report)"],
  ].map(([k, v]) => `${k},${JSON.stringify(v)}`).join("\r\n") + "\r\n\r\n";
  const respond = (name: string, body: string) => new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  const fail = (m: string) => NextResponse.json({ error: m }, { status: 500 });

  if (kind === "coverage") {
    const { data, error } = await supabase.rpc("p2_itgc_coverage", { p_org: ctx.org.id });
    if (error) return fail(error.message);
    const c = data as Cov;
    const rows = c.systems.map((s) => [s.name, s.relevance, s.criticality, s.in_scope ? "Yes" : "No", s.categories.access, s.categories.change, s.categories.operations, s.automated_count, s.dependent_controls, s.depends.map((d) => `${d.code}(${d.type})`).join("; "), s.gaps.map((g) => `${GAP_LABELS[g.code] ?? g.code}${g.ref ? ` [${g.ref}]` : ""}`).join(" | ")]);
    return respond("itgc-coverage", meta("ITGC coverage and gaps", rows.length) + toCsv(["system", "relevance", "criticality", "in_scope", "access_itgcs", "change_itgcs", "operations_itgcs", "automated_controls", "dependent_financial_controls", "dependencies", "gaps"], rows));
  }
  if (kind === "systems") {
    const { data, error } = await supabase.from("itgc_systems").select("name, system_type, financial_reporting_relevance, criticality, in_scope, status, system_owner_user_id, description").eq("organization_id", ctx.org.id).order("name");
    if (error) return fail(error.message);
    return respond("itgc-systems", meta("ITGC systems inventory", (data ?? []).length) + toCsv(["name", "type", "relevance", "criticality", "in_scope", "status", "owner", "description"], (data ?? []).map((s) => [s.name, s.system_type, s.financial_reporting_relevance, s.criticality, s.in_scope ? "Yes" : "No", s.status, memberName(members, s.system_owner_user_id), s.description])));
  }
  if (kind === "controls") {
    const [{ data: i, error: e1 }, { data: a, error: e2 }, { data: cf, error: e3 }] = await Promise.all([
      supabase.from("itgc_controls").select("control_ref, category, description, frequency, status, owner_user_id, assertions, test_plan_id, itgc_systems(name), controls(code)").eq("organization_id", ctx.org.id).order("control_ref"),
      supabase.from("automated_controls").select("control_ref, description, frequency, status, owner_user_id, financial_assertions, change_dependency, test_plan_id, id, itgc_systems(name), controls:linked_sox_control_id(code)").eq("organization_id", ctx.org.id).order("control_ref"),
      supabase.from("automated_control_configurations").select("automated_control_id, version, status, decided_at").eq("organization_id", ctx.org.id),
    ]);
    if (e1 ?? e2 ?? e3) return fail((e1 ?? e2 ?? e3)!.message);
    const latestApproved = new Map<string, number>();
    (cf ?? []).filter((c) => c.status === "approved").forEach((c) => latestApproved.set(c.automated_control_id, Math.max(latestApproved.get(c.automated_control_id) ?? 0, c.version)));
    const rows = [
      ...(i ?? []).map((r) => ["ITGC", r.control_ref, one(r.itgc_systems as { name: string } | { name: string }[] | null)?.name, r.category, one(r.controls as { code: string } | { code: string }[] | null)?.code, r.description, r.frequency, memberName(members, r.owner_user_id), (r.assertions ?? []).join("; "), r.test_plan_id ? "Yes" : "No", "", r.status]),
      ...(a ?? []).map((r) => ["Automated", r.control_ref, one(r.itgc_systems as { name: string } | { name: string }[] | null)?.name, "", one(r.controls as { code: string } | { code: string }[] | null)?.code, r.description, r.frequency, memberName(members, r.owner_user_id), (r.financial_assertions ?? []).join("; "), r.test_plan_id ? "Yes" : "No", latestApproved.has(r.id) ? `Approved v${latestApproved.get(r.id)}` : "None approved", r.status]),
    ];
    return respond("itgc-and-automated-controls", meta("ITGC and automated-control summary", rows.length) + toCsv(["type", "reference", "system", "category", "financial_control", "description", "frequency", "owner", "assertions", "has_test_plan", "configuration_conclusion", "status"], rows));
  }
  let query = supabase.from("itgc_exceptions").select("status, description, review_note, raised_at, decided_at, deficiency_id, itgc_controls(control_ref), automated_controls(control_ref)").eq("organization_id", ctx.org.id).order("raised_at", { ascending: false });
  const status = sp.get("status");
  if (status) { query = query.eq("status", status); filters.push(`status=${status}`); }
  const { data, error } = await query;
  if (error) return fail(error.message);
  return respond("itgc-exceptions", meta("ITGC exceptions", (data ?? []).length) + toCsv(["control", "status", "description", "review_note", "raised_at", "decided_at", "deficiency_id"], (data ?? []).map((e) => [one(e.itgc_controls as { control_ref: string } | { control_ref: string }[] | null)?.control_ref ?? one(e.automated_controls as { control_ref: string } | { control_ref: string }[] | null)?.control_ref, e.status, e.description, e.review_note, e.raised_at, e.decided_at, e.deficiency_id])));
}
