import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, cardClass, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { raiseItgcDeficiencyAction, reviewItgcExceptionAction } from "@/lib/actions/itgc";

type SP = { status?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const STATUSES = ["open", "in_review", "deficiency_raised", "cleared", "withdrawn"];

export default async function ExceptionsPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="ITGC & automated-control assurance" title="Exception review" subtitle={p2?.ctx.org.name} />;
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  if (!can(ctx.role, "itgc.view_internal")) return <>{header}<PermissionDenied /></>;

  const supabase = await createClient();
  const status = searchParams.status ?? "";
  let query = supabase.from("itgc_exceptions").select("id, status, description, review_note, raised_at, decided_at, decided_by, assigned_to, deficiency_id, test_plan_id, test_step_id, itgc_control_id, automated_control_id, itgc_controls(control_ref), automated_controls(control_ref), test_steps(step_number, description)").eq("organization_id", ctx.org.id).order("raised_at", { ascending: false });
  if (status) query = query.eq("status", status); else query = query.in("status", ["open", "in_review"]);
  const [{ data, error }, members] = await Promise.all([query, loadMembers(supabase, ctx.org.id).catch(() => [])]);
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = data ?? [];
  const canStart = can(ctx.role, "itgc.exception.start");
  const canDecide = can(ctx.role, "itgc.exception.decide");
  const here = withParams("/dashboard/itgc/exceptions", { status: status || undefined });

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <p className="mb-4 rounded-md border border-line bg-panel px-4 py-2 text-xs text-mute">A test step marked “exception” in the testing engine is routed here automatically. Taking it into review is open to internal audit and management; only a controller or CFO can clear it (with a written rationale) or raise it as a deficiency in the existing deficiency workflow.</p>
      <form method="get" action="/dashboard/itgc/exceptions" className="mb-4 flex items-end gap-3">
        <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={status} className={inputClass}><option value="">Awaiting review (open + in review)</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <button className={secondaryBtn} type="submit">Apply</button>
        {status && <Link className={secondaryBtn} href="/dashboard/itgc/exceptions">Clear</Link>}
        <a className={`${secondaryBtn} ml-auto`} href={withParams("/dashboard/itgc/export", { kind: "exceptions", status: status || undefined })}>Export (CSV)</a>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={status ? "No exceptions with that status" : "Nothing awaiting review"} description={status ? "Choose a different status." : "Failed ITGC and automated-control test steps will appear here for review."} />
      ) : (
        <div className="space-y-4">
          {rows.map((e) => {
            const ic = one(e.itgc_controls as { control_ref: string } | { control_ref: string }[] | null);
            const ac = one(e.automated_controls as { control_ref: string } | { control_ref: string }[] | null);
            const st = one(e.test_steps as { step_number: number; description: string } | { step_number: number; description: string }[] | null);
            const target = ic ? { ref: ic.control_ref, href: `/dashboard/itgc/controls/${e.itgc_control_id}` } : { ref: ac?.control_ref ?? "—", href: `/dashboard/itgc/automated-controls/${e.automated_control_id}` };
            return (
              <section key={e.id} className={cardClass}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3"><Link href={target.href} className="text-sm font-semibold text-signal hover:underline">{target.ref}</Link><StatusBadge value={e.status} /><span className="text-xs text-mute">Raised {fmtDateTime(e.raised_at)}</span></div>
                  {e.test_plan_id && <Link className={secondaryBtn} href={`/dashboard/test-plans/${e.test_plan_id}`}>Open test plan</Link>}
                </div>
                <p className="text-sm text-paper">{e.description ?? "Exception"}</p>
                {st && <p className="mt-1 text-xs text-mute">Step {st.step_number}: {st.description}</p>}
                {e.assigned_to && <p className="mt-1 text-xs text-mute">In review with {memberName(members, e.assigned_to)}</p>}
                {e.review_note && <p className="mt-2 text-sm text-mute">Note: {e.review_note}{e.decided_at && ` (${fmtDateTime(e.decided_at)}, ${memberName(members, e.decided_by)})`}</p>}
                {e.deficiency_id && <p className="mt-2 text-sm"><Link className="text-signal hover:underline" href={`/dashboard/deficiencies/${e.deficiency_id}`}>View deficiency</Link></p>}

                {e.status === "open" && canStart && (
                  <form action={reviewItgcExceptionAction} className="mt-3"><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={e.id} /><input type="hidden" name="action" value="start_review" /><button className={primaryBtn} type="submit">Take into review</button></form>
                )}
                {["open", "in_review"].includes(e.status) && canDecide && (
                  <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
                    {e.status === "in_review" && (
                      <form action={reviewItgcExceptionAction} className="space-y-2">
                        <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={e.id} /><input type="hidden" name="action" value="clear" />
                        <label className={labelClass} htmlFor={`clr-${e.id}`}>Clear — written rationale (min. 10 characters)</label>
                        <textarea id={`clr-${e.id}`} name="note" required minLength={10} rows={2} className={inputClass} />
                        <button className={secondaryBtn} type="submit">Clear exception</button>
                      </form>
                    )}
                    <form action={raiseItgcDeficiencyAction} className="space-y-2">
                      <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={e.id} />
                      <label className={labelClass} htmlFor={`def-${e.id}`}>Raise a deficiency</label>
                      <input id={`def-${e.id}`} name="title" required placeholder="Deficiency title" className={inputClass} />
                      <div className="flex gap-2"><select name="severity" defaultValue="medium" aria-label="Severity" className={inputClass}>{["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
                      <textarea name="description" rows={2} placeholder="What happened and why it matters" aria-label="Description" className={inputClass} />
                      <button className={primaryBtn} type="submit">Raise deficiency</button>
                    </form>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <div className="mt-3"><LastUpdated at={rows.map((r) => r.raised_at as string).sort().pop()} /></div>
    </>
  );
}
