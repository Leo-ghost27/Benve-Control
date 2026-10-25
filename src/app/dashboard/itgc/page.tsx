import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { GAP_LABELS } from "@/lib/phase2/itgc";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDateTime, label, secondaryBtn } from "@/components/phase2/ui";

type SP = { gap?: string; notice?: string; error?: string };
type Gap = { code: string; ref: string | null };
type Sys = {
  id: string; name: string; system_type: string | null; relevance: string | null; criticality: string | null; in_scope: boolean;
  categories: Record<string, number>; itgc_count: number; automated_count: number; dependent_controls: number;
  controls: { id: string; ref: string; category: string; test_plan_id: string | null; plan_status: string | null; steps_total: number; steps_pass: number; steps_exception: number; open_exceptions: number }[];
  automated: { id: string; ref: string; config_approved: boolean }[];
  depends: { control_id: string; code: string; type: string }[];
  gaps: Gap[];
};
type Coverage = { generated_at: string; systems: Sys[]; totals: Record<string, number> };

export default async function ItgcCoverage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="ITGC & automated-control assurance" title="ITGC coverage" subtitle={p2?.ctx.org.name} />;
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  if (!can(ctx.role, "itgc.view_internal")) return <>{header}<PermissionDenied message="ITGC workpapers are internal. External auditors and viewers see approved configuration conclusions and approved reports." /></>;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_itgc_coverage", { p_org: ctx.org.id });
  if (error) return <>{header}<ErrorState message={error.message} /></>;
  const cov = data as Coverage;
  const t = cov.totals;
  const filter = searchParams.gap;
  const systems = filter ? cov.systems.filter((s) => s.gaps.some((g) => g.code === filter)) : cov.systems;
  const codes = Array.from(new Set(cov.systems.flatMap((s) => s.gaps.map((g) => g.code)))).sort();

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <p className="mb-5 rounded-md border border-line bg-panel px-4 py-2 text-xs text-mute">Coverage is computed from the records below. A system is only shown as covered when ITGCs exist in all three categories <em>and</em> have been tested through the testing engine; nothing is marked effective automatically. Every conclusion is entered and approved by a person.</p>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/dashboard/itgc/systems" className="rounded-xl border border-line bg-panel p-4 hover:border-mute"><p className="text-2xl font-bold tabular-nums text-paper">{t.systems_in_scope}<span className="text-sm font-normal text-mute"> in scope</span></p><p className="mt-1 text-xs text-mute">Systems →</p></Link>
        <Link href="/dashboard/itgc?gap=" className="rounded-xl border border-line bg-panel p-4 hover:border-mute"><p className={`text-2xl font-bold tabular-nums ${t.gaps ? "text-amber-400" : "text-paper"}`}>{t.gaps}<span className="text-sm font-normal text-mute"> in {t.systems_with_gaps} systems</span></p><p className="mt-1 text-xs text-mute">Coverage gaps</p></Link>
        <Link href="/dashboard/itgc/controls" className="rounded-xl border border-line bg-panel p-4 hover:border-mute"><p className="text-2xl font-bold tabular-nums text-paper">{t.itgc_tested}<span className="text-sm font-normal text-mute"> of {t.itgc_controls} tested</span></p><p className="mt-1 text-xs text-mute">ITGC controls →</p></Link>
        <Link href="/dashboard/itgc/exceptions" className="rounded-xl border border-line bg-panel p-4 hover:border-mute"><p className={`text-2xl font-bold tabular-nums ${t.open_exceptions ? "text-rose-400" : "text-paper"}`}>{t.open_exceptions}</p><p className="mt-1 text-xs text-mute">Open exceptions awaiting review →</p></Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form method="get" action="/dashboard/itgc" className="flex items-center gap-2">
          <label className="text-xs text-mute" htmlFor="gap">Gap type</label>
          <select id="gap" name="gap" defaultValue={filter ?? ""} className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper">
            <option value="">All systems</option>{codes.map((c) => <option key={c} value={c}>{GAP_LABELS[c] ?? label(c)}</option>)}
          </select>
          <button className={secondaryBtn} type="submit">Apply</button>
          {filter && <Link className={secondaryBtn} href="/dashboard/itgc">Clear</Link>}
        </form>
        <div className="flex gap-2">
          <a className={secondaryBtn} href="/dashboard/itgc/export?kind=coverage">Export coverage (CSV)</a>
          <a className={secondaryBtn} href="/dashboard/itgc/export?kind=controls">Export ITGC & automated controls (CSV)</a>
        </div>
      </div>

      {systems.length === 0 ? (
        <EmptyState title={filter ? "No systems have that gap" : "No systems recorded yet"} description={filter ? "Clear the filter to see all systems." : "Add the systems that support financial reporting, then map ITGCs and automated controls to them."} action={filter ? undefined : { label: "Add a system", href: "/dashboard/itgc/systems" }} />
      ) : (
        <div className="space-y-4">
          {systems.map((s) => (
            <section key={s.id} className={cardClass}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Link href={`/dashboard/itgc/systems/${s.id}`} className="text-sm font-semibold text-signal hover:underline">{s.name}</Link>
                  <span className="text-xs text-mute">{s.system_type ?? "—"}</span>
                  {s.relevance && <span className="text-xs text-mute">Relevance: <span className="text-paper">{label(s.relevance)}</span></span>}
                  {!s.in_scope && <StatusBadge value="inactive" />}
                </div>
                <div className="flex gap-4 text-xs text-mute">
                  {(["access", "change", "operations"] as const).map((c) => <span key={c}>{label(c)}: <span className={s.categories[c] ? "text-paper" : "text-amber-300"}>{s.categories[c]}</span></span>)}
                  <span>Automated: <span className="text-paper">{s.automated_count}</span></span>
                  <span>Dependent controls: <span className="text-paper">{s.dependent_controls}</span></span>
                </div>
              </div>
              {s.gaps.length === 0 ? <p className="text-sm text-emerald-300">No coverage gaps detected from the records.</p> : (
                <ul className="space-y-1 text-sm">
                  {s.gaps.map((g, i) => <li key={i} className="flex gap-2 text-amber-300"><span aria-hidden>•</span><span>{GAP_LABELS[g.code] ?? label(g.code)}{g.ref ? <span className="text-mute"> — {g.ref}</span> : null}</span></li>)}
                </ul>
              )}
              {s.depends.length > 0 && <p className="mt-3 text-xs text-mute">Financial controls relying on this system: {s.depends.map((d) => <Link key={`${d.control_id}-${d.type}`} href={`/dashboard/controls/${d.control_id}`} className="mr-2 text-signal hover:underline">{d.code} ({label(d.type)})</Link>)}</p>}
            </section>
          ))}
        </div>
      )}
      <div className="mt-4"><LastUpdated at={cov.generated_at} /> <span className="text-[11px] text-mute">· Generated {fmtDateTime(cov.generated_at)}</span></div>
    </>
  );
}
