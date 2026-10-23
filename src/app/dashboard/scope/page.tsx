import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { Banner, PageHeader, PeriodBar, StatusBadge, TableShell, Th, cardClass, fmtDate, inputClass, labelClass, primaryBtn } from "@/components/phase2/ui";
import { createScopeAction } from "@/lib/actions/scopes";

type SP = { period?: string; notice?: string; error?: string };
type Row = { id: string; title: string; status: string; version: number; submitted_at: string | null; decided_at: string | null };

export default async function ScopePage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx, periods, period } = p2;
  const header = <PageHeader eyebrow="Engagement" title="Scope & client sign-off" subtitle={`${ctx.org.name} — the controls and entities in scope, approved by the client against an exact version.`} />;
  if (!period) return <>{header}<NoPeriod canCreate={["owner", "admin", "cfo", "controller"].includes(ctx.role ?? "")} returnTo="/dashboard/scope" /></>;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("engagement_scopes")
    .select("id, title, status, version, submitted_at, decided_at")
    .eq("organization_id", ctx.org.id)
    .eq("reporting_period_id", period.id)
    .order("created_at", { ascending: false });
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const rows = (data ?? []) as Row[];
  const canPrepare = ["owner", "admin", "internal_auditor"].includes(ctx.role ?? "");
  const awaiting = rows.filter((r) => r.status === "submitted").length;
  const canSign = ["cfo", "controller"].includes(ctx.role ?? "");

  return (
    <div className="p-8">
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} action="/dashboard/scope" />
      {canSign && awaiting > 0 && (
        <div role="status" className="mb-5 rounded-md border border-sky-900/60 bg-sky-950/30 px-4 py-3 text-sm text-sky-300">
          {awaiting} scope{awaiting > 1 ? "s are" : " is"} waiting for your review and sign-off.
        </div>
      )}
      <div className="mb-6">
        {rows.length === 0 ? <p className="text-sm text-mute">No scope documents for {period.label} yet.</p> : (
          <TableShell>
            <thead className="bg-panel text-xs text-mute"><tr><Th>Scope</Th><Th>Status</Th><Th>Version</Th><Th>Submitted</Th><Th>Decided</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2"><Link className="text-paper underline-offset-2 hover:underline" href={`/dashboard/scope/${r.id}?period=${period.id}`}>{r.title}</Link></td>
                <td className="px-3 py-2"><StatusBadge value={r.status} /></td><td className="px-3 py-2">v{r.version}</td>
                <td className="px-3 py-2">{fmtDate(r.submitted_at)}</td><td className="px-3 py-2">{fmtDate(r.decided_at)}</td>
              </tr>
            ))}</tbody>
          </TableShell>
        )}
      </div>
      {canPrepare && (
        <form action={createScopeAction} className={`${cardClass} grid gap-3`}>
          <input type="hidden" name="period" value={period.id} />
          <h2 className="text-sm font-semibold text-paper">New scope for {period.label}</h2>
          <div><label className={labelClass} htmlFor="s-title">Title</label><input id="s-title" name="title" required defaultValue={`${period.label} ICFR scope`} className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="s-obj">Objective</label><textarea id="s-obj" name="objective" rows={2} className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="s-sum">Scope summary (required to submit)</label><textarea id="s-sum" name="scope_summary" rows={3} className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="s-exc">Exclusions</label><textarea id="s-exc" name="exclusions" rows={2} className={inputClass} /></div>
          <button className={`${primaryBtn} w-fit`} type="submit">Create draft scope</button>
        </form>
      )}
    </div>
  );
}
