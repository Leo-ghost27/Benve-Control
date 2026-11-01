import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { PACK_LABELS, PACK_TYPES, SECTION_TYPES, isPackType, type PackType, type ReportSnapshot } from "@/lib/phase2/reports";
import { generatePackAction } from "@/lib/actions/reports";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { NoPeriod } from "@/components/phase2/NoPeriod";
import { ReportSectionView } from "@/components/phase2/ReportSectionView";
import { Banner, PageHeader, PeriodBar, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDateTime, inputClass, labelClass, label, primaryBtn, secondaryBtn } from "@/components/phase2/ui";

type SP = { period?: string; section?: string; entity?: string; type?: string; status?: string; notice?: string; error?: string };
type PackListRow = { id: string; pack_type: PackType; title: string; version: number; status: string; as_of: string; generated_by_label: string | null; shared_with_external: boolean; entity_id: string | null };

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  const header = <PageHeader eyebrow="Reporting & governance" title="Reports and governance packs" subtitle={p2?.ctx.org.name} />;
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx, periods, period } = p2;
  const internal = can(ctx.role, "reports.view_internal");
  const external = can(ctx.role, "reports.view_approved");
  if (!internal && !external) return <>{header}<PermissionDenied /></>;
  if (!period) return <>{header}<NoPeriod canCreate={["owner", "admin", "cfo", "controller"].includes(ctx.role ?? "")} returnTo="/dashboard/reports" /></>;

  const supabase = await createClient();
  const section = isPackType(searchParams.section) && searchParams.section !== "governance_pack" ? searchParams.section : "ccm_aging";
  const typeFilter = isPackType(searchParams.type) ? searchParams.type : undefined;

  let packQuery = supabase.from("report_packs")
    .select("id, pack_type, title, version, status, as_of, generated_by_label, shared_with_external, entity_id")
    .eq("organization_id", ctx.org.id).eq("reporting_period_id", period.id)
    .order("generated_at", { ascending: false }).limit(200);
  if (typeFilter) packQuery = packQuery.eq("pack_type", typeFilter);
  if (searchParams.status) packQuery = packQuery.eq("status", searchParams.status);
  const [{ data: packRows, error: packErr }, { data: entityRows }] = await Promise.all([
    packQuery,
    internal ? supabase.from("entities").select("id, name").eq("organization_id", ctx.org.id).order("name") : Promise.resolve({ data: [] }),
  ]);
  if (packErr) return <>{header}<ErrorState message={packErr.message} /></>;
  const packs = (packRows ?? []) as PackListRow[];
  const entities = (entityRows ?? []) as { id: string; name: string }[];
  const entityName = (id: string | null) => entities.find((e) => e.id === id)?.name ?? (id ? "Entity" : "All entities");

  let live: ReportSnapshot | null = null;
  let liveError: string | null = null;
  if (internal) {
    const { data, error } = await supabase.rpc("p2_report_compute", { p_org: ctx.org.id, p_period: period.id, p_type: section, p_entity: searchParams.entity || null });
    if (error) liveError = error.message; else live = data as ReportSnapshot;
  }
  const keep = { section, entity: searchParams.entity, type: searchParams.type, status: searchParams.status };
  const canGenerate = can(ctx.role, "reports.generate");

  return (
    <>
      {header}
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <PeriodBar periods={periods} current={period} keep={keep} action="/dashboard/reports" />

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel px-4 py-2 text-xs text-mute">
        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-300">Manual / import-based inputs</span>
        <span>Reports summarise records entered or imported in Benve Control. No live system is scanned, and a report is not an audit opinion, an ICFR conclusion or a regulatory filing. Approved packs are frozen snapshots; live figures below change as records change.</span>
      </div>

      {internal && (
        <>
          <nav aria-label="Report sections" className="mb-4 flex flex-wrap gap-1 border-b border-line">
            {SECTION_TYPES.map((t) => {
              const sp = new URLSearchParams({ period: period.id, section: t });
              if (searchParams.entity) sp.set("entity", searchParams.entity);
              return (
                <Link key={t} href={`/dashboard/reports?${sp.toString()}`} aria-current={t === section ? "page" : undefined}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${t === section ? "border-signal text-paper" : "border-transparent text-mute hover:text-paper"}`}>
                  {PACK_LABELS[t]}
                </Link>
              );
            })}
          </nav>

          <form method="get" action="/dashboard/reports" className="mb-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="period" value={period.id} />
            <input type="hidden" name="section" value={section} />
            <div>
              <label htmlFor="entity-filter" className={labelClass}>Entity filter</label>
              <select id="entity-filter" name="entity" defaultValue={searchParams.entity ?? ""} className={`${inputClass} min-w-[12rem]`}>
                <option value="">All entities (client-wide)</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <button className={secondaryBtn} type="submit">Apply</button>
            <p className="text-xs text-mute">Applies to questionnaires, group coverage and remediation only.</p>
          </form>

          <p className="mb-3 rounded-md border border-sky-900/60 bg-sky-950/30 px-4 py-2 text-xs text-sky-300">
            Live view: recalculated from current records on every load. It is not a report. Generate a snapshot to preserve these figures for review.
          </p>
          {liveError && <ErrorState message={liveError} />}
          {live && live.sections.map((s) => <ReportSectionView key={s.section} section={s} periodId={period.id} linkRecords />)}
          {live && live.filter_notes.length > 0 && <p className="mb-6 text-xs text-amber-300">{live.filter_notes.join(" ")}</p>}
        </>
      )}

      {canGenerate && (
        <form action={generatePackAction} className={`${cardClass} mb-6`}>
          <h2 className="text-sm font-semibold text-paper">Generate a snapshot</h2>
          <p className="mt-1 text-xs text-mute">Freezes the figures as at now into a new draft version. A reviewer with explicit approval authority then approves that exact version; editing is never possible, so a correction is a new version.</p>
          <input type="hidden" name="period" value={period.id} />
          <input type="hidden" name="return_to" value={`/dashboard/reports?period=${period.id}`} />
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="gen-type" className={labelClass}>Report</label>
              <select id="gen-type" name="pack_type" defaultValue="governance_pack" className={`${inputClass} min-w-[16rem]`}>
                {PACK_TYPES.map((t) => <option key={t} value={t}>{PACK_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="gen-entity" className={labelClass}>Entity (optional)</label>
              <select id="gen-entity" name="entity_id" defaultValue={searchParams.entity ?? ""} className={`${inputClass} min-w-[12rem]`}>
                <option value="">All entities (client-wide)</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <button type="submit" className={primaryBtn}>Generate draft snapshot</button>
          </div>
        </form>
      )}

      <section aria-labelledby="packs-h" className={cardClass}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="packs-h" className="text-base font-semibold text-paper">{external && !internal ? "Approved packs shared with you" : "Snapshots for this period"}</h2>
          <form method="get" action="/dashboard/reports" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="period" value={period.id} />
            <input type="hidden" name="section" value={section} />
            <select name="type" defaultValue={searchParams.type ?? ""} aria-label="Filter by report" className={inputClass}>
              <option value="">All reports</option>
              {PACK_TYPES.map((t) => <option key={t} value={t}>{PACK_LABELS[t]}</option>)}
            </select>
            <select name="status" defaultValue={searchParams.status ?? ""} aria-label="Filter by status" className={inputClass}>
              <option value="">All statuses</option>
              {["draft", "submitted", "returned", "approved", "superseded", "archived"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
            <button className={secondaryBtn} type="submit">Filter</button>
          </form>
        </div>
        <div className="mt-4">
          {packs.length === 0 ? (
            <p className="text-sm text-mute">{external && !internal ? "No approved pack has been shared with you for this period yet." : "No snapshots yet for this period."}</p>
          ) : (
            <TableShell>
              <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
                <tr><Th>Report</Th><Th>Version</Th><Th>Scope</Th><Th>Status</Th><Th>Snapshot as at</Th><Th>Prepared by</Th>{internal && <Th>External</Th>}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {packs.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2"><Link href={`/dashboard/reports/${p.id}`} className="text-paper underline decoration-line hover:decoration-signal">{p.title}</Link></td>
                    <td className="px-3 py-2 font-mono text-mute">v{p.version}</td>
                    <td className="px-3 py-2 text-mute">{entityName(p.entity_id)}</td>
                    <td className="px-3 py-2"><StatusBadge value={p.status} /></td>
                    <td className="px-3 py-2 text-mute">{fmtDateTime(p.as_of)}</td>
                    <td className="px-3 py-2 text-mute">{p.generated_by_label ?? "—"}</td>
                    {internal && <td className="px-3 py-2 text-mute">{p.shared_with_external ? "Shared" : "Not shared"}</td>}
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </div>
      </section>
    </>
  );
}
