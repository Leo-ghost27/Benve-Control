import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { applyExceptionFilters, EXCEPTION_COLUMNS, loadMembers, memberName, type ExceptionFilters } from "@/lib/phase2/ccm-queries";
import { toCsv } from "@/lib/phase2/csv";

export const dynamic = "force-dynamic";
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * CSV export. Uses the SAME filter function as the list pages, so the file
 * contains exactly the records on screen. Leading metadata block states
 * date generated, period, filters, preparer, scope and draft/approved status.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const p2 = await getPhase2Context(sp.get("period") ?? undefined);
  if (!p2) return NextResponse.json({ error: "Not signed in or no organization." }, { status: 401 });
  const { ctx, period } = p2;
  if (!can(ctx.role, "ccm.view_internal")) return NextResponse.json({ error: "Your role cannot export internal CCM records." }, { status: 403 });
  if (!period) return NextResponse.json({ error: "No reporting period." }, { status: 404 });

  const kind = sp.get("kind");
  const supabase = await createClient();
  const members = await loadMembers(supabase, ctx.org.id).catch(() => []);
  const filterEntries: [string, string][] = [];
  const meta = (title: string, count: number) => [
    ["Report", title],
    ["Date generated", new Date().toISOString()],
    ["Reporting period", `${period.label} (${period.start_date} to ${period.end_date})`],
    ["Filters applied", filterEntries.length ? filterEntries.map(([k, v]) => `${k}=${v}`).join("; ") : "None"],
    ["Prepared by", ctx.userEmail ?? ctx.userId],
    ["Data scope", `Organization ${ctx.org.name}; ${count} record(s) as stored in Benve Control at generation time`],
    ["Status", "Draft (unapproved export; not a management-approved report)"],
  ];
  const metaCsv = (title: string, count: number) => meta(title, count).map(([k, v]) => `${k},${JSON.stringify(v)}`).join("\r\n") + "\r\n\r\n";
  const respond = (name: string, body: string) =>
    new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${period.label.replace(/[^\w-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });

  if (kind === "exceptions") {
    const f: ExceptionFilters = { period: period.id };
    for (const k of ["status", "severity", "rule", "assigned", "source", "month", "q"] as const) {
      const v = sp.get(k); if (v) { f[k] = v; filterEntries.push([k, v]); }
    }
    const { data, error } = await applyExceptionFilters(supabase.from("ccm_exceptions").select(EXCEPTION_COLUMNS).eq("organization_id", ctx.org.id), f).order("detected_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const csv = toCsv(
      ["id", "detected_at", "source_reference", "description", "rule_code", "control_code", "severity", "status", "assigned_to", "amount", "origin", "linked_deficiency_id", "linked_formal_exception_id", "false_positive_reason", "updated_at"],
      rows.map((r) => [r.id, r.detected_at, r.source_record_ref, r.description, one(r.ccm_rules as { rule_code: string } | null)?.rule_code, one(r.controls as { code: string } | null)?.code, r.severity, r.status, memberName(members, r.assigned_to as string | null), r.amount, r.source_type === "csv_import" ? "CSV import" : "Manual", r.linked_deficiency_id, r.linked_exception_id, r.false_positive_reason, r.updated_at])
    );
    return respond("ccm-exceptions", metaCsv("CCM exceptions", rows.length) + csv);
  }

  if (kind === "rules") {
    let q = supabase.from("ccm_rules").select("id, rule_code, name, description, logic_summary, frequency, severity, status, owner_user_id, updated_at, controls(code)").eq("organization_id", ctx.org.id).order("rule_code");
    const status = sp.get("status"), severity = sp.get("severity"), text = sp.get("q");
    if (status) { q = q.eq("status", status); filterEntries.push(["status", status]); }
    if (severity) { q = q.eq("severity", severity); filterEntries.push(["severity", severity]); }
    if (text) { q = q.or(`name.ilike.%${text.replace(/[%,()]/g, " ")}%,rule_code.ilike.%${text.replace(/[%,()]/g, " ")}%,description.ilike.%${text.replace(/[%,()]/g, " ")}%`); filterEntries.push(["q", text]); }
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return respond("ccm-rules", metaCsv("CCM rules", rows.length) + toCsv(["rule_code", "name", "description", "logic_summary", "control_code", "frequency", "severity", "status", "owner", "updated_at"],
      rows.map((r) => [r.rule_code, r.name, r.description, r.logic_summary, one(r.controls as { code: string } | null)?.code, r.frequency, r.severity, r.status, memberName(members, r.owner_user_id as string | null), r.updated_at])));
  }

  if (kind === "follow-ups") {
    let q = supabase.from("follow_ups").select("id, description, owner_user_id, due_date, status, escalation_status, completed_at, ccm_exceptions!inner(source_record_ref, reporting_period_id)").eq("organization_id", ctx.org.id).eq("ccm_exceptions.reporting_period_id", period.id).order("due_date");
    const status = sp.get("status"), esc = sp.get("escalation"), owner = sp.get("owner"), text = sp.get("q"), overdue = sp.get("overdue");
    if (status) { q = q.eq("status", status); filterEntries.push(["status", status]); }
    if (esc) { q = q.eq("escalation_status", esc); filterEntries.push(["escalation", esc]); }
    if (owner) { q = q.eq("owner_user_id", owner); filterEntries.push(["owner", owner]); }
    if (text) { q = q.ilike("description", `%${text.replace(/[%,()]/g, " ")}%`); filterEntries.push(["q", text]); }
    if (overdue === "1") { q = q.neq("status", "closed").lt("due_date", new Date().toISOString().slice(0, 10)); filterEntries.push(["overdue", "1"]); }
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return respond("ccm-follow-ups", metaCsv("CCM follow-ups", rows.length) + toCsv(["description", "exception_source_reference", "owner", "due_date", "status", "escalation_status", "completed_at"],
      rows.map((r) => [r.description, one(r.ccm_exceptions as { source_record_ref: string } | null)?.source_record_ref, memberName(members, r.owner_user_id as string | null), r.due_date, r.status, r.escalation_status, r.completed_at])));
  }

  return NextResponse.json({ error: "Unknown export kind." }, { status: 400 });
}
