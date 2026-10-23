import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { WORKFLOW_TRANSITIONS } from "@/lib/phase2/workflow";
import { OUTCOME_LABELS } from "@/lib/phase2/questionnaire";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, KpiLink, LastUpdated, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { createGroupSummaryAction, saveGroupConclusionAction, transitionGroupSummaryAction } from "@/lib/actions/group";

type SP = { period?: string; notice?: string; error?: string };

type RollupEntity = {
  entity_id: string; name: string; is_parent: boolean; jurisdiction: string | null; included: boolean;
  questionnaire_id: string | null; questionnaire_status: string | null; group_review_status: string | null;
  controls_owned: number; group_controls_relied_on: number; deficiencies_open: number; exceptions_open: number;
  test_plans: number; test_plans_complete: number;
};
type Rollup = {
  generated_at?: string;
  data_scope?: string;
  entities: RollupEntity[];
  group_level: { controls: number; deficiencies_open: number; exceptions_open: number; test_plans: number; test_plans_complete: number };
  totals: { entities_in_scope: number; entities_included: number; entities_excluded: number; controls: number; deficiencies_open: number; exceptions_open: number; test_plans: number; test_plans_complete: number };
};

function RollupView({ r, periodId, internal }: { r: Rollup; periodId: string; internal: boolean }) {
  const t = r.totals;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-2xl font-bold tabular-nums text-paper">{t.entities_included} <span className="text-sm font-normal text-mute">of {t.entities_in_scope}</span></p><p className="mt-1 text-xs text-mute">Entities included (approved)</p></div>
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-2xl font-bold tabular-nums text-paper">{t.controls}</p><p className="mt-1 text-xs text-mute">Controls (each counted once)</p></div>
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-2xl font-bold tabular-nums text-amber-400">{t.deficiencies_open}</p><p className="mt-1 text-xs text-mute">Open deficiencies</p></div>
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-2xl font-bold tabular-nums text-amber-400">{t.exceptions_open}</p><p className="mt-1 text-xs text-mute">Open CCM exceptions</p></div>
      </div>
      <TableShell>
        <thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Entity</Th><Th>Questionnaire</Th><Th>Controls owned</Th><Th>Group controls relied on</Th><Th>Open deficiencies</Th><Th>Open exceptions</Th><Th>Test plans (done)</Th><Th>In roll-up</Th></tr></thead>
        <tbody className="divide-y divide-line bg-ink">
          {r.entities.map((e) => (
            <tr key={e.entity_id} className={`align-top ${e.included ? "" : "opacity-60"}`}>
              <td className="px-3 py-2">{internal ? <Link className="text-signal hover:underline" href={withParams(`/dashboard/entities/${e.entity_id}`, { period: periodId })}>{e.name}</Link> : <span className="text-paper">{e.name}</span>}{e.is_parent && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-[10px] text-mute">Group parent</span>}</td>
              <td className="px-3 py-2">{e.is_parent ? <span className="text-xs text-mute">Not required</span> : e.questionnaire_id ? <Link href={withParams(`/dashboard/subsidiary-questionnaires/${e.questionnaire_id}`, { period: periodId })} className="inline-flex items-center gap-2"><StatusBadge value={e.questionnaire_status} /><span className="text-xs text-mute">{OUTCOME_LABELS[e.group_review_status ?? ""] ?? ""}</span></Link> : <span className="text-xs text-mute">None</span>}</td>
              <td className="px-3 py-2 tabular-nums">{e.controls_owned}</td>
              <td className="px-3 py-2 tabular-nums">{e.group_controls_relied_on}</td>
              <td className="px-3 py-2 tabular-nums">{e.deficiencies_open}</td>
              <td className="px-3 py-2 tabular-nums">{e.exceptions_open}</td>
              <td className="px-3 py-2 tabular-nums">{e.test_plans} ({e.test_plans_complete})</td>
              <td className="px-3 py-2">{e.included ? <StatusBadge value="approved" /> : <span className="text-xs text-amber-300">Excluded — questionnaire not approved</span>}</td>
            </tr>
          ))}
          <tr className="bg-panel/60">
            <td className="px-3 py-2 font-medium text-paper">Group-level items</td><td className="px-3 py-2 text-xs text-mute">Counted once, at group</td>
            <td className="px-3 py-2 tabular-nums">{r.group_level.controls}</td><td className="px-3 py-2">—</td>
            <td className="px-3 py-2 tabular-nums">{r.group_level.deficiencies_open}</td><td className="px-3 py-2 tabular-nums">{r.group_level.exceptions_open}</td>
            <td className="px-3 py-2 tabular-nums">{r.group_level.test_plans} ({r.group_level.test_plans_complete})</td><td className="px-3 py-2"><StatusBadge value="approved" /></td>
          </tr>
          <tr className="bg-panel font-medium">
            <td className="px-3 py-2 text-paper">Group total (included entities + group-level)</td><td />
            <td className="px-3 py-2 tabular-nums text-paper">{t.controls}</td><td />
            <td className="px-3 py-2 tabular-nums text-paper">{t.deficiencies_open}</td><td className="px-3 py-2 tabular-nums text-paper">{t.exceptions_open}</td>
            <td className="px-3 py-2 tabular-nums text-paper">{t.test_plans} ({t.test_plans_complete})</td><td />
          </tr>
        </tbody>
      </TableShell>
      <p className="mt-2 text-[11px] text-mute">Each control, deficiency, exception and test plan is attributed to exactly one entity or to group level, so the total is the sum of the rows above. Only the group parent and entities whose questionnaire is approved contribute. {r.generated_at && `Generated ${fmtDateTime(r.generated_at)}.`}</p>
    </>
  );
}

export default async function GroupIcfrPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="Multi-entity / group ICFR" title="Group ICFR roll-up" subtitle={p2?.ctx.org.name} />;
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx, periods, period } = p2;
  const internal = can(ctx.role, "group.view_internal");
  if (!internal && !can(ctx.role, "group.view_approved")) return <>{header}<PermissionDenied /></>;
  if (!period) return <>{header}<Banner notice={searchParams.notice} error={searchParams.error} /><NoPeriod canCreate={can(ctx.role, "group.review")} returnTo="/dashboard/group-icfr" /></>;

  const supabase = await createClient();
  const base = withParams("/dashboard/group-icfr", { period: period.id });
  const canPrepare = can(ctx.role, "group.summary.prepare");
  const canReview = can(ctx.role, "group.review");

  const { data: sums, error: serr } = await supabase.from("group_icfr_summaries").select("*").eq("organization_id", ctx.org.id).eq("reporting_period_id", period.id).order("created_at", { ascending: false });
  if (serr) return <>{header}<ErrorState message={serr.message} /></>;

  // external auditors / viewers: approved summaries only (RLS enforces this too)
  if (!internal) {
    return (
      <>
        {header}
        <PeriodBar periods={periods} current={period} action="/dashboard/group-icfr" />
        <p className="mb-4 text-xs text-mute">You are viewing approved group summaries only. Drafts, entity workpapers and internal notes are not shared.</p>
        {(sums ?? []).length === 0 ? <EmptyState title="No approved group summary for this period" description="Management hasn't approved a group ICFR summary for this reporting period yet." /> : (
          (sums ?? []).map((s) => (
            <section key={s.id} className={`${cardClass} mb-5`}>
              <div className="mb-3 flex items-center gap-3"><h2 className="text-sm font-semibold text-paper">{s.title}</h2><StatusBadge value={s.status} /></div>
              <p className="mb-4 whitespace-pre-wrap text-sm text-paper">{s.conclusion}</p>
              <RollupView r={s.snapshot as Rollup} periodId={period.id} internal={false} />
              <p className="mt-3 text-[11px] text-mute">Approved {fmtDateTime(s.approved_at)} · {(s.snapshot as Rollup).data_scope}</p>
            </section>
          ))
        )}
      </>
    );
  }

  const { data: live, error: rerr } = await supabase.rpc("p2_group_rollup", { p_org: ctx.org.id, p_period: period.id });
  if (rerr) return <>{header}<ErrorState message={rerr.message} /></>;
  const r = live as Rollup;
  const lastUpdated = (sums ?? []).map((s) => s.updated_at as string).sort().pop();

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/group-icfr" />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-paper">Live roll-up for {period.label}</h2>
        <div className="flex gap-2">
          <Link className={secondaryBtn} href={withParams("/dashboard/deficiencies", {})}>Deficiencies</Link>
          <Link className={secondaryBtn} href={withParams("/dashboard/ccm/exceptions", { period: period.id, status: "open" })}>CCM exceptions</Link>
          <a className={secondaryBtn} href={withParams("/dashboard/group-icfr/export", { period: period.id, kind: "rollup" })}>Export roll-up (CSV)</a>
          <a className={secondaryBtn} href={withParams("/dashboard/group-icfr/export", { period: period.id, kind: "entities" })}>Export entity pack (CSV)</a>
        </div>
      </div>
      {r.entities.length === 0 ? (
        <EmptyState title="No entities in scope" description="Create the group parent and subsidiaries on the Entities tab, then collect questionnaires." action={{ label: "Go to Entities", href: withParams("/dashboard/entities", { period: period.id }) }} />
      ) : (
        <RollupView r={r} periodId={period.id} internal />
      )}

      <section className={`${cardClass} mt-8`}>
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="text-sm font-semibold text-paper">Group conclusion &amp; approved-view summary</h2><p className="text-xs text-mute">A snapshot freezes the roll-up at a point in time. External auditors and viewers see only approved summaries.</p></div>
          {canPrepare && <form action={createGroupSummaryAction}><input type="hidden" name="return_to" value={base} /><input type="hidden" name="reporting_period_id" value={period.id} /><button className={primaryBtn} type="submit">Snapshot current roll-up</button></form>}
        </div>
        {(sums ?? []).length === 0 ? <p className="text-sm text-mute">No summary has been prepared for this period.</p> : (
          <div className="space-y-5">
            {(sums ?? []).map((s) => {
              const snap = s.snapshot as Rollup;
              const next = WORKFLOW_TRANSITIONS[s.status] ?? [];
              const editable = ["draft", "prepared", "returned", "reopened"].includes(s.status) && canPrepare;
              return (
                <div key={s.id} className="rounded-lg border border-line p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-3"><span className="text-sm font-medium text-paper">{s.title}</span><StatusBadge value={s.status} /><span className="text-xs text-mute">Snapshot {fmtDateTime(snap.generated_at)} · {snap.totals?.entities_included ?? 0} entities, {snap.totals?.controls ?? 0} controls, {snap.totals?.deficiencies_open ?? 0} open deficiencies</span></div>
                  {s.review_note && s.status !== "approved" && <p className="mb-3 rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-300">Reviewer note: {s.review_note}</p>}
                  <p className="mb-2 text-xs text-mute">Underlying entity questionnaires: {(snap.entities ?? []).filter((e) => e.questionnaire_id && e.included).map((e) => <Link key={e.entity_id} className="mr-2 text-signal hover:underline" href={withParams(`/dashboard/subsidiary-questionnaires/${e.questionnaire_id}`, { period: period.id })}>{e.name}</Link>)}{(snap.entities ?? []).every((e) => !e.questionnaire_id || !e.included) && "none approved at snapshot time"}</p>
                  {editable ? (
                    <form action={saveGroupConclusionAction} className="space-y-2">
                      <input type="hidden" name="return_to" value={base} /><input type="hidden" name="id" value={s.id} />
                      <label className={labelClass} htmlFor={`c-${s.id}`}>Group conclusion (min. 20 characters to submit)</label>
                      <textarea id={`c-${s.id}`} name="conclusion" rows={3} defaultValue={s.conclusion ?? ""} className={inputClass} />
                      <button className={secondaryBtn} type="submit">Save conclusion</button>
                    </form>
                  ) : <p className="whitespace-pre-wrap text-sm text-paper">{s.conclusion ?? "No conclusion recorded."}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                    <span className="text-xs text-mute">Workflow:</span>
                    {next.map((to) => {
                      const review = ["approved", "returned", "reopened"].includes(to);
                      if (review ? !canReview : !canPrepare) return null;
                      const needsNote = to === "returned" || to === "reopened";
                      return (
                        <form key={to} action={transitionGroupSummaryAction} className="flex items-center gap-2">
                          <input type="hidden" name="return_to" value={base} /><input type="hidden" name="id" value={s.id} /><input type="hidden" name="from" value={s.status} /><input type="hidden" name="to" value={to} />
                          {needsNote && <input name="review_note" required minLength={5} placeholder="Review note (required)" className={`${inputClass} w-56`} />}
                          <button className={to === "approved" ? primaryBtn : secondaryBtn} type="submit">{to === "prepared" ? "Mark prepared" : to === "submitted" ? "Submit for review" : label(to)}</button>
                        </form>
                      );
                    })}
                    {next.length === 0 && <span className="text-xs text-mute">No further transitions.</span>}
                  </div>
                  {s.approved_at && <p className="mt-2 text-[11px] text-mute">Approved {fmtDateTime(s.approved_at)}.</p>}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3"><LastUpdated at={lastUpdated} /></div>
      </section>
    </>
  );
}
