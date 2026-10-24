import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { toCsv } from "@/lib/phase2/csv";

export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

type Roll = { entities: Record<string, unknown>[]; group_level: Record<string, number>; totals: Record<string, number> };

/** kind=rollup: the live group roll-up. kind=entities: entity register with owners, scope, assignments and questionnaire status. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const p2 = await getPhase2Context(sp.get("period") ?? undefined);
  if (!p2) return NextResponse.json({ error: "Not signed in or no organization." }, { status: 401 });
  const { ctx, period } = p2;
  if (!can(ctx.role, "group.view_internal")) return NextResponse.json({ error: "Your role cannot export group workpapers." }, { status: 403 });
  if (!period) return NextResponse.json({ error: "No reporting period." }, { status: 404 });

  const supabase = await createClient();
  const members = await loadMembers(supabase, ctx.org.id).catch(() => []);
  const kind = sp.get("kind") === "entities" ? "entities" : "rollup";
  const metaRows = (title: string, count: number) => [
    ["Report", title], ["Date generated", new Date().toISOString()], ["Reporting period", `${period.label} (${period.start_date} to ${period.end_date})`],
    ["Filters applied", "None (all in-scope entities)"], ["Prepared by", ctx.userEmail ?? ctx.userId],
    ["Data scope", `${ctx.org.name}; ${count} row(s) as stored at generation time`], ["Status", "Draft (unapproved export; not a management-approved report)"],
  ].map(([k, v]) => `${k},${JSON.stringify(v)}`).join("\r\n") + "\r\n\r\n";
  const respond = (name: string, body: string) => new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${period.label.replace(/[^\w-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });

  if (kind === "rollup") {
    const { data, error } = await supabase.rpc("p2_group_rollup", { p_org: ctx.org.id, p_period: period.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const r = data as Roll;
    const rows = r.entities.map((e) => [e.name, e.is_parent ? "Group parent" : "Subsidiary", e.included ? "Included" : "Excluded (questionnaire not approved)", e.questionnaire_status ?? "", e.group_review_status ?? "", e.controls_owned, e.group_controls_relied_on, e.deficiencies_open, e.exceptions_open, e.test_plans, e.test_plans_complete]);
    rows.push(["Group-level items", "Group", "Included", "", "", r.group_level.controls, "", r.group_level.deficiencies_open, r.group_level.exceptions_open, r.group_level.test_plans, r.group_level.test_plans_complete]);
    rows.push(["GROUP TOTAL", "", `${r.totals.entities_included} of ${r.totals.entities_in_scope} entities`, "", "", r.totals.controls, "", r.totals.deficiencies_open, r.totals.exceptions_open, r.totals.test_plans, r.totals.test_plans_complete]);
    return respond("group-icfr-rollup", metaRows("Group ICFR roll-up", r.entities.length) + toCsv(["entity", "type", "in_roll_up", "questionnaire_status", "group_review", "controls_owned", "group_controls_relied_on", "open_deficiencies", "open_exceptions", "test_plans", "test_plans_complete"], rows));
  }

  const [{ data: ents, error: e1 }, { data: qs, error: e2 }, { data: ecs, error: e3 }, { data: eps, error: e4 }] = await Promise.all([
    supabase.from("entities").select("id, name, legal_name, jurisdiction, parent_entity_id, is_parent, in_scope, consolidation_method, local_owner_user_id, status, functional_scope").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("subsidiary_questionnaires").select("entity_id, status, group_review_status, submitted_at, approved_at").eq("organization_id", ctx.org.id).eq("reporting_period_id", period.id),
    supabase.from("entity_controls").select("entity_id, reliance_type, status, controls(code)").eq("organization_id", ctx.org.id),
    supabase.from("entity_processes").select("entity_id, in_scope, processes(name)").eq("organization_id", ctx.org.id),
  ]);
  const err = e1 ?? e2 ?? e3 ?? e4;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  const nameById = new Map((ents ?? []).map((e) => [e.id, e.name]));
  const qBy = new Map((qs ?? []).map((q) => [q.entity_id, q]));
  const rows = (ents ?? []).map((e) => {
    const q = qBy.get(e.id);
    const codes = (ecs ?? []).filter((c) => c.entity_id === e.id && c.status === "active").map((c) => `${one(c.controls as { code: string } | { code: string }[] | null)?.code ?? ""}(${c.reliance_type})`).join("; ");
    const procs = (eps ?? []).filter((p) => p.entity_id === e.id && p.in_scope).map((p) => one(p.processes as { name: string } | { name: string }[] | null)?.name ?? "").join("; ");
    return [e.name, e.legal_name, e.jurisdiction, e.parent_entity_id ? nameById.get(e.parent_entity_id) : "", e.is_parent ? "Group parent" : "Subsidiary", e.in_scope ? "Yes" : "No", e.consolidation_method, memberName(members, e.local_owner_user_id), e.status, procs, codes, q?.status ?? "", q?.group_review_status ?? "", q?.submitted_at ?? "", q?.approved_at ?? ""];
  });
  return respond("group-icfr-entity-pack", metaRows("Entity pack", rows.length) + toCsv(["entity", "legal_name", "jurisdiction", "parent", "type", "in_scope", "consolidation", "local_owner", "status", "in_scope_processes", "controls(reliance)", "questionnaire_status", "group_review", "submitted_at", "approved_at"], rows));
}
