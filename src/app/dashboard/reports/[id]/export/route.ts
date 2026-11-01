import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { buildPackCsv, csvFileName, type PackRow } from "@/lib/phase2/reports";

export const dynamic = "force-dynamic";

/**
 * CSV export of a STORED pack. Visibility is decided by RLS (internal roles; external auditors and
 * viewers only for approved + explicitly shared packs). The export is logged by the database.
 * It never recomputes from live records, so an approved export always matches the approved snapshot.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return NextResponse.json({ error: "Not signed in or no organization." }, { status: 401 });
  if (!can(ctx.role, "reports.view_internal") && !can(ctx.role, "reports.view_approved")) {
    return NextResponse.json({ error: "Your role cannot export reports." }, { status: 403 });
  }
  const supabase = await createClient();
  const { data } = await supabase.from("report_packs").select("*").eq("id", params.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Report pack not found." }, { status: 404 });
  const pack = data as PackRow;

  // Log first: if the audit event cannot be written the file is not released.
  const { error: logError } = await supabase.rpc("p2_report_log_export", { p_id: pack.id, p_format: "csv" });
  if (logError) return NextResponse.json({ error: "Export could not be logged, so it was not released." }, { status: 500 });

  const internal = can(ctx.role, "reports.view_internal");
  const members = internal ? await loadMembers(supabase, ctx.org.id).catch(() => []) : [];
  const csv = buildPackCsv(pack, {
    exportedAt: new Date().toISOString(),
    exportedBy: ctx.userEmail ?? ctx.userId,
    approverName: internal && pack.decided_by ? memberName(members, pack.decided_by) : pack.decided_by ? "Reviewer" : null,
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(pack)}"`,
      "Cache-Control": "no-store",
    },
  });
}
