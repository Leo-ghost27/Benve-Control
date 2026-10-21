import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { memberName } from "@/lib/phase2/ccm-queries";
import { WORKFLOW_TRANSITIONS } from "@/lib/phase2/workflow";
import { EDITABLE_STATUSES, loadReadinessBase, PLANNING_DISCLAIMER } from "@/lib/phase2/readiness-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, KpiLink, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDate, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { createAssessmentAction, deleteAreaAction, saveAreaAction, saveAssessmentAction, transitionAssessmentAction } from "@/lib/actions/readiness";

type SP = { period?: string; assessment?: string; notice?: string; error?: string };
const MATURITY = ["initial", "developing", "defined", "managed", "optimized"];
const FILER = ["pre_ipo", "emerging_growth", "non_accelerated", "accelerated", "large_accelerated", "other"];

export default async function ReadinessOverview({ searchParams }: { searchParams: SP }) {
  let base;
  try { base = await loadReadinessBase(searchParams); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="Pre-IPO / accelerated-filer readiness" title="ICFR readiness assessment" subtitle={base?.p2.ctx.org.name} />;
  if (!base) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { p2, assessments, assessment, members } = base;
  const { ctx, periods, period } = p2;
  const internal = can(ctx.role, "readiness.view_internal");
  if (!internal && !can(ctx.role, "readiness.view_approved")) return <>{header}<PermissionDenied /></>;
  if (!period) return <>{header}<Banner notice={searchParams.notice} error={searchParams.error} /><NoPeriod canCreate={can(ctx.role, "readiness.review")} returnTo="/dashboard/readiness" /></>;

  const supabase = await createClient();
  const canPrepare = can(ctx.role, "readiness.prepare");
  const canReview = can(ctx.role, "readiness.review");
  const here = withParams("/dashboard/readiness", { period: period.id, assessment: assessment?.id });

  const [areasRes, gapsRes] = assessment
    ? await Promise.all([
        supabase.from("readiness_areas").select("*").eq("organization_id", ctx.org.id).eq("assessment_id", assessment.id).order("area_name"),
        supabase.from("readiness_gaps").select("id, gap_severity, status, target_date").eq("organization_id", ctx.org.id).eq("readiness_assessment_id", assessment.id),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const err = areasRes.error ?? gapsRes.error;
  if (err) return <>{header}<ErrorState message={err.message} /></>;
  const areas = areasRes.data ?? [];
  const gaps = gapsRes.data ?? [];
  const scored = areas.filter((a) => a.readiness_score !== null);
  const suggested = scored.length ? Math.round(scored.reduce((s, a) => s + Number(a.readiness_score), 0) / scored.length) : null;
  const editable = !!assessment && EDITABLE_STATUSES.includes(assessment.status);
  const next = assessment ? WORKFLOW_TRANSITIONS[assessment.status] ?? [] : [];
  const G = (extra: Record<string, string>) => withParams("/dashboard/readiness/gaps", { period: period.id, assessment: assessment?.id, ...extra });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/readiness" />
      <p className="mb-5 rounded-md border border-line bg-panel px-4 py-2 text-xs text-mute">{PLANNING_DISCLAIMER}</p>

      <section className={`${cardClass} mb-5`}>
        <h2 className="mb-3 text-sm font-semibold text-paper">Assessments for {period.label}</h2>
        {assessments.length === 0 ? (
          <p className="mb-3 text-sm text-mute">No assessment yet for this period.{canPrepare ? " Create one below." : ""}</p>
        ) : (
          <ul className="mb-4 flex flex-wrap gap-2">
            {assessments.map((a) => (
              <li key={a.id}>
                <Link href={withParams("/dashboard/readiness", { period: period.id, assessment: a.id })} className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${a.id === assessment?.id ? "border-signal text-paper" : "border-line text-mute hover:text-paper"}`}>
                  {a.target_milestone ?? "Untitled"} <StatusBadge value={a.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {canPrepare && (
          <form action={createAssessmentAction} className="grid grid-cols-4 items-end gap-3">
            <input type="hidden" name="return_to" value={here} /><input type="hidden" name="reporting_period_id" value={period.id} />
            <div className="col-span-2"><label className={labelClass} htmlFor="c_ms">Target milestone *</label><input id="c_ms" name="target_milestone" required placeholder="e.g. IPO — Q3 2027, or first 404(b) audit" className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="c_td">Target date</label><input id="c_td" name="target_date" type="date" className={inputClass} /></div>
            <div><button className={primaryBtn} type="submit">New assessment</button></div>
          </form>
        )}
      </section>

      {!assessment ? (
        assessments.length === 0 && !canPrepare ? <EmptyState title="No readiness assessment" description={internal ? "An internal auditor, admin or owner can create one." : "Management hasn't shared an approved readiness assessment for this period."} /> : null
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiLink href={G({})} value={gaps.length} label="Gaps in this assessment" />
            <KpiLink href={G({ severity: "high" })} value={gaps.filter((g) => g.gap_severity === "high").length} label="High-priority gaps" tone="crit" />
            <KpiLink href={G({ overdue: "1" })} value={gaps.filter((g) => g.target_date && g.target_date < today && g.status !== "archived").length} label="Past target date" tone="warn" />
            <KpiLink href={G({ status: "approved" })} value={gaps.filter((g) => g.status === "approved").length} label="Approved gaps" />
          </div>

          <section className={`${cardClass} mb-5`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3"><h2 className="text-sm font-semibold text-paper">{assessment.target_milestone}</h2><StatusBadge value={assessment.status} /></div>
              <div className="flex gap-2 print:hidden">
                <Link className={secondaryBtn} href={withParams("/dashboard/readiness/pack", { period: period.id, assessment: assessment.id })}>Readiness pack</Link>
                {internal && <a className={secondaryBtn} href={withParams("/dashboard/readiness/export", { period: period.id, assessment: assessment.id })}>Export CSV</a>}
              </div>
            </div>
            {assessment.review_note && assessment.status !== "approved" && <p className="mb-3 rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-300">Reviewer note: {assessment.review_note}</p>}

            {editable && canPrepare ? (
              <form action={saveAssessmentAction} className="grid grid-cols-3 gap-3">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={assessment.id} />
                <div><label className={labelClass} htmlFor="e_ms">Target milestone</label><input id="e_ms" name="target_milestone" defaultValue={assessment.target_milestone ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="e_td">Target date</label><input id="e_td" name="target_date" type="date" defaultValue={assessment.target_date ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="e_fs">Current filer status</label><select id="e_fs" name="current_filer_status" defaultValue={assessment.current_filer_status ?? ""} className={inputClass}><option value="">—</option>{FILER.map((f) => <option key={f} value={f}>{label(f)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="e_ml">Maturity level</label><select id="e_ml" name="maturity_level" defaultValue={assessment.maturity_level ?? ""} className={inputClass}><option value="">—</option>{MATURITY.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="e_os">Overall score (0–100, management&apos;s judgement)</label><input id="e_os" name="overall_score" type="number" min={0} max={100} step="1" defaultValue={assessment.overall_score ?? ""} className={inputClass} />
                  {suggested !== null && <p className="mt-1 text-[11px] text-mute">Planning aid: simple average of scored areas = {suggested}</p>}</div>
                <div />
                <div className="col-span-3"><label className={labelClass} htmlFor="e_mc">Management conclusion (min. 20 characters to submit)</label><textarea id="e_mc" name="management_conclusion" rows={3} defaultValue={assessment.management_conclusion ?? ""} className={inputClass} /></div>
                <div className="col-span-3 grid grid-cols-2 gap-3">
                  <div><label className={labelClass} htmlFor="e_as">Assumptions</label><textarea id="e_as" name="assumptions" rows={2} defaultValue={assessment.assumptions ?? ""} className={inputClass} /></div>
                  <div><label className={labelClass} htmlFor="e_tr">Timeline risks</label><textarea id="e_tr" name="timeline_risks" rows={2} defaultValue={assessment.timeline_risks ?? ""} className={inputClass} /></div>
                </div>
                <div><button className={primaryBtn} type="submit">Save assessment</button></div>
              </form>
            ) : (
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <div><dt className="text-xs text-mute">Target date</dt><dd className="mt-1 text-paper">{fmtDate(assessment.target_date)}</dd></div>
                <div><dt className="text-xs text-mute">Filer status</dt><dd className="mt-1 text-paper">{label(assessment.current_filer_status)}</dd></div>
                <div><dt className="text-xs text-mute">Maturity level</dt><dd className="mt-1 text-paper">{label(assessment.maturity_level)}</dd></div>
                <div><dt className="text-xs text-mute">Overall score (planning)</dt><dd className="mt-1 text-paper">{assessment.overall_score ?? "—"}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-mute">Prepared by</dt><dd className="mt-1 text-paper">{memberName(members, assessment.prepared_by)}</dd></div>
                <div className="col-span-3"><dt className="text-xs text-mute">Management conclusion</dt><dd className="mt-1 whitespace-pre-wrap text-paper">{assessment.management_conclusion ?? "—"}</dd></div>
                <div className="col-span-3"><dt className="text-xs text-mute">Assumptions</dt><dd className="mt-1 whitespace-pre-wrap text-paper">{assessment.assumptions ?? "—"}</dd></div>
                <div className="col-span-3"><dt className="text-xs text-mute">Timeline risks</dt><dd className="mt-1 whitespace-pre-wrap text-paper">{assessment.timeline_risks ?? "—"}</dd></div>
              </dl>
            )}

            {internal && (
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4 print:hidden">
                <span className="text-xs text-mute">Workflow:</span>
                {next.map((to) => {
                  const review = ["approved", "returned", "reopened"].includes(to);
                  if (review ? !canReview : !canPrepare) return null;
                  const needsNote = to === "returned" || to === "reopened";
                  return (
                    <form key={to} action={transitionAssessmentAction} className="flex items-center gap-2">
                      <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={assessment.id} /><input type="hidden" name="from" value={assessment.status} /><input type="hidden" name="to" value={to} />
                      {needsNote && <input name="review_note" required minLength={5} placeholder="Review note (required)" className={`${inputClass} w-56`} />}
                      <button className={to === "approved" ? primaryBtn : secondaryBtn} type="submit">{to === "prepared" ? "Mark prepared" : to === "submitted" ? "Submit for review" : label(to)}</button>
                    </form>
                  );
                })}
                {next.length === 0 && <span className="text-xs text-mute">No further transitions.</span>}
              </div>
            )}
            <p className="mt-3 text-[11px] text-mute">
              {assessment.submitted_at && <>Submitted {fmtDateTime(assessment.submitted_at)} by {memberName(members, assessment.submitted_by)}. </>}
              {assessment.approved_at && <>Approved {fmtDateTime(assessment.approved_at)} by {memberName(members, assessment.reviewed_by)}.</>}
            </p>
          </section>

          <section className={cardClass}>
            <h2 className="mb-1 text-sm font-semibold text-paper">Readiness areas (manual scoring)</h2>
            <p className="mb-4 text-xs text-mute">Each score is management&apos;s judgement (0–100) with a written rationale. Areas lock while the assessment is submitted or approved.</p>
            {areas.length === 0 ? <p className="mb-4 text-sm text-mute">No areas yet.{editable && canPrepare ? " Add the first below (e.g. Entity-level controls, ITGC, Financial close)." : ""}</p> : (
              <TableShell>
                <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Area</Th><Th>Current → target</Th><Th>Score</Th><Th>Rationale</Th><Th>Owner</Th><Th>Actions</Th></tr></thead>
                <tbody className="divide-y divide-line bg-ink">
                  {areas.map((a) => (
                    <tr key={a.id} className="align-top">
                      {editable && canPrepare ? (
                        <>
                          <td colSpan={5} className="px-3 py-2">
                            <form action={saveAreaAction} className="grid grid-cols-12 items-start gap-2">
                              <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={a.id} />
                              <input name="area_name" defaultValue={a.area_name} required aria-label="Area name" className={`${inputClass} col-span-3`} />
                              <select name="current_maturity" defaultValue={a.current_maturity ?? ""} aria-label="Current maturity" className={`${inputClass} col-span-2`}><option value="">Current</option>{MATURITY.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>
                              <select name="target_maturity" defaultValue={a.target_maturity ?? ""} aria-label="Target maturity" className={`${inputClass} col-span-2`}><option value="">Target</option>{MATURITY.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>
                              <input name="readiness_score" type="number" min={0} max={100} defaultValue={a.readiness_score ?? ""} aria-label="Score" className={`${inputClass} col-span-1`} />
                              <textarea name="score_rationale" rows={1} defaultValue={a.score_rationale ?? ""} aria-label="Rationale" className={`${inputClass} col-span-3`} />
                              <select name="owner_user_id" defaultValue={a.owner_user_id ?? ""} aria-label="Owner" className={`${inputClass} col-span-12`}><option value="">No owner</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select>
                              <button className={`${secondaryBtn} col-span-2`} type="submit">Save</button>
                            </form>
                          </td>
                          <td className="px-3 py-2"><form action={deleteAreaAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={a.id} /><button className={secondaryBtn} type="submit">Remove</button></form></td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-paper">{a.area_name}</td>
                          <td className="px-3 py-2 text-mute">{label(a.current_maturity)} → {label(a.target_maturity)}</td>
                          <td className="px-3 py-2 tabular-nums text-paper">{a.readiness_score ?? "—"}</td>
                          <td className="max-w-sm px-3 py-2 text-mute">{a.score_rationale ?? "—"}</td>
                          <td className="px-3 py-2 text-mute">{memberName(members, a.owner_user_id)}</td>
                          <td />
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
            {editable && canPrepare && (
              <form action={saveAreaAction} className="mt-4 grid grid-cols-12 items-end gap-2 border-t border-line pt-4">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="assessment_id" value={assessment.id} />
                <div className="col-span-4"><label className={labelClass} htmlFor="n_area">New area *</label><input id="n_area" name="area_name" required placeholder="e.g. IT general controls" className={inputClass} /></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="n_cm">Current</label><select id="n_cm" name="current_maturity" className={inputClass}><option value="">—</option>{MATURITY.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="n_tm">Target</label><select id="n_tm" name="target_maturity" className={inputClass}><option value="">—</option>{MATURITY.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></div>
                <div className="col-span-1"><label className={labelClass} htmlFor="n_sc">Score</label><input id="n_sc" name="readiness_score" type="number" min={0} max={100} className={inputClass} /></div>
                <div className="col-span-3"><button className={primaryBtn} type="submit">Add area</button></div>
                <div className="col-span-12"><label className={labelClass} htmlFor="n_rat">Score rationale</label><input id="n_rat" name="score_rationale" className={inputClass} /></div>
              </form>
            )}
          </section>
          <div className="mt-3"><LastUpdated at={assessment.updated_at} /></div>
        </>
      )}
    </>
  );
}
