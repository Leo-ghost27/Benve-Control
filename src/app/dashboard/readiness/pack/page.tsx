import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { memberName } from "@/lib/phase2/ccm-queries";
import { loadReadinessBase, PLANNING_DISCLAIMER } from "@/lib/phase2/readiness-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { PrintButton } from "@/components/phase2/PrintButton";
import { PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, fmtDate, fmtDateTime, label, secondaryBtn } from "@/components/phase2/ui";

type SP = { period?: string; assessment?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function ReadinessPack({ searchParams }: { searchParams: SP }) {
  let base;
  try { base = await loadReadinessBase(searchParams); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="Pre-IPO readiness" title="Management & audit-committee readiness pack" subtitle={base?.p2.ctx.org.name} />;
  if (!base) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { p2, assessment, members } = base;
  const { ctx, periods, period } = p2;
  const internal = can(ctx.role, "readiness.view_internal");
  if (!internal && !can(ctx.role, "readiness.view_approved")) return <>{header}<PermissionDenied /></>;
  if (!period) return <>{header}<NoPeriod canCreate={can(ctx.role, "readiness.review")} returnTo="/dashboard/readiness/pack" /></>;
  if (!assessment) return <>{header}<PeriodBar periods={periods} current={period} action="/dashboard/readiness/pack" /><EmptyState title="No readiness assessment to report on" description="Create and complete an assessment first." /></>;

  const supabase = await createClient();
  const [{ data: areas, error: e1 }, { data: gaps, error: e2 }] = await Promise.all([
    supabase.from("readiness_areas").select("area_name, current_maturity, target_maturity, readiness_score, score_rationale").eq("organization_id", ctx.org.id).eq("assessment_id", assessment.id).order("area_name"),
    supabase.from("readiness_gaps").select("id, requirement, description, gap_severity, status, target_date, owner_user_id, remediation_action, readiness_areas(area_name)").eq("organization_id", ctx.org.id).eq("readiness_assessment_id", assessment.id).order("gap_severity").order("target_date"),
  ]);
  const gapIds = (gaps ?? []).map((g) => g.id);
  const { data: actions, error: e3 } = gapIds.length
    ? await supabase.from("readiness_roadmap_actions").select("gap_id, action_ref, description, owner_user_id, target_date, status, priority").eq("organization_id", ctx.org.id).in("gap_id", gapIds).order("target_date")
    : { data: [], error: null };
  const err = e1 ?? e2 ?? e3;
  if (err) return <>{header}<ErrorState message={err.message} /></>;

  const approved = assessment.status === "approved";
  const gapName = new Map((gaps ?? []).map((g) => [g.id, g.requirement ?? g.description ?? "Gap"]));

  return (
    <>
      <div className="print:hidden">{header}<PeriodBar periods={periods} current={period} action="/dashboard/readiness/pack" keep={{ assessment: assessment.id }} /></div>
      <div className="mb-4 flex gap-2 print:hidden"><PrintButton />{internal && <a className={secondaryBtn} href={withParams("/dashboard/readiness/export", { period: period.id, assessment: assessment.id })}>Export CSV</a>}</div>

      <article className="space-y-6 rounded-xl border border-line bg-ink p-8 print:border-0 print:p-0 print:text-black">
        <header className="border-b border-line pb-4">
          <h1 className="font-display text-xl font-bold text-paper print:text-black">{ctx.org.name} — ICFR readiness pack</h1>
          <p className="mt-1 text-sm text-mute">{assessment.target_milestone} · target {fmtDate(assessment.target_date)}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-mute">
            <div className="flex gap-2"><dt>Date generated:</dt><dd className="text-paper print:text-black">{fmtDateTime(new Date().toISOString())}</dd></div>
            <div className="flex gap-2"><dt>Reporting period:</dt><dd className="text-paper print:text-black">{period.label} ({period.start_date} to {period.end_date})</dd></div>
            <div className="flex gap-2"><dt>Filters applied:</dt><dd className="text-paper print:text-black">Assessment “{assessment.target_milestone}”; all areas, gaps and actions</dd></div>
            <div className="flex gap-2"><dt>Prepared by:</dt><dd className="text-paper print:text-black">{internal ? memberName(members, assessment.prepared_by) : "Management"}</dd></div>
            <div className="flex gap-2"><dt>Data scope:</dt><dd className="text-paper print:text-black">{ctx.org.name}; records as stored at generation time</dd></div>
            <div className="flex gap-2"><dt>Status:</dt><dd className="text-paper print:text-black">{approved ? `Approved ${fmtDateTime(assessment.approved_at)}${internal ? ` by ${memberName(members, assessment.reviewed_by)}` : ""}` : `DRAFT — ${label(assessment.status)} (not approved)`}</dd></div>
          </dl>
          <p className="mt-3 rounded border border-line px-3 py-2 text-xs text-mute">{PLANNING_DISCLAIMER}</p>
        </header>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-paper print:text-black">1. Summary</h2>
          <dl className="grid grid-cols-4 gap-4 text-sm">
            <div><dt className="text-xs text-mute">Filer status</dt><dd className="text-paper print:text-black">{label(assessment.current_filer_status)}</dd></div>
            <div><dt className="text-xs text-mute">Maturity level</dt><dd className="text-paper print:text-black">{label(assessment.maturity_level)}</dd></div>
            <div><dt className="text-xs text-mute">Overall score (planning)</dt><dd className="text-paper print:text-black">{assessment.overall_score ?? "—"} / 100</dd></div>
            <div><dt className="text-xs text-mute">Open gaps</dt><dd className="text-paper print:text-black">{(gaps ?? []).filter((g) => g.status !== "archived").length} ({(gaps ?? []).filter((g) => g.gap_severity === "high").length} high)</dd></div>
          </dl>
          <h3 className="mb-1 mt-4 text-xs font-medium text-mute">Management conclusion</h3>
          <p className="whitespace-pre-wrap text-sm text-paper print:text-black">{assessment.management_conclusion ?? "Not yet recorded."}</p>
          {assessment.assumptions && <><h3 className="mb-1 mt-3 text-xs font-medium text-mute">Assumptions</h3><p className="whitespace-pre-wrap text-sm text-paper print:text-black">{assessment.assumptions}</p></>}
          {assessment.timeline_risks && <><h3 className="mb-1 mt-3 text-xs font-medium text-mute">Timeline risks</h3><p className="whitespace-pre-wrap text-sm text-paper print:text-black">{assessment.timeline_risks}</p></>}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-paper print:text-black">2. Readiness areas</h2>
          {(areas ?? []).length === 0 ? <p className="text-sm text-mute">No areas scored.</p> : (
            <TableShell><thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Area</Th><Th>Current → target</Th><Th>Score</Th><Th>Rationale</Th></tr></thead>
              <tbody className="divide-y divide-line">{(areas ?? []).map((a, i) => <tr key={i} className="align-top"><td className="px-3 py-2 text-paper print:text-black">{a.area_name}</td><td className="px-3 py-2 text-mute">{label(a.current_maturity)} → {label(a.target_maturity)}</td><td className="px-3 py-2 tabular-nums text-paper print:text-black">{a.readiness_score ?? "—"}</td><td className="px-3 py-2 text-mute">{a.score_rationale ?? "—"}</td></tr>)}</tbody></TableShell>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-paper print:text-black">3. Gaps</h2>
          {(gaps ?? []).length === 0 ? <p className="text-sm text-mute">No gaps recorded.</p> : (
            <TableShell><thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Requirement / description</Th><Th>Area</Th><Th>Priority</Th><Th>Owner</Th><Th>Target</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-line">{(gaps ?? []).map((g) => <tr key={g.id} className="align-top"><td className="max-w-md px-3 py-2 text-paper print:text-black">{g.requirement ?? "Gap"}<p className="text-xs text-mute">{g.description}</p>{g.remediation_action && <p className="mt-1 text-xs text-mute">Remediation: {g.remediation_action}</p>}</td><td className="px-3 py-2 text-mute">{one(g.readiness_areas as { area_name: string } | { area_name: string }[] | null)?.area_name ?? "—"}</td><td className="px-3 py-2"><StatusBadge value={g.gap_severity} /></td><td className="px-3 py-2 text-mute">{internal ? memberName(members, g.owner_user_id) : "—"}</td><td className="px-3 py-2 text-mute">{fmtDate(g.target_date)}</td><td className="px-3 py-2"><StatusBadge value={g.status} /></td></tr>)}</tbody></TableShell>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-paper print:text-black">4. Remediation roadmap</h2>
          {(actions ?? []).length === 0 ? <p className="text-sm text-mute">No roadmap actions.</p> : (
            <TableShell><thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Action</Th><Th>Gap</Th><Th>Owner</Th><Th>Target</Th><Th>Priority</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-line">{(actions ?? []).map((a, i) => <tr key={i} className="align-top"><td className="px-3 py-2 text-paper print:text-black">{a.action_ref ? `${a.action_ref} · ` : ""}{a.description}</td><td className="px-3 py-2 text-mute">{gapName.get(a.gap_id) ?? "—"}</td><td className="px-3 py-2 text-mute">{internal ? memberName(members, a.owner_user_id) : "—"}</td><td className="px-3 py-2 text-mute">{fmtDate(a.target_date)}</td><td className="px-3 py-2"><StatusBadge value={a.priority} /></td><td className="px-3 py-2"><StatusBadge value={a.status} /></td></tr>)}</tbody></TableShell>
          )}
        </section>
      </article>
    </>
  );
}
