import Link from "next/link";
import type { ReportSection } from "@/lib/phase2/reports";
import { recordHref } from "@/lib/phase2/reports";
import { StatusBadge, TableShell, Th, fmtDate, cardClass } from "@/components/phase2/ui";

/**
 * One report section: every count shows its counting basis and, on request, the exact records
 * behind it. `linkRecords` is false for external readers (no links into internal workpapers).
 * The same component renders live calculations and stored snapshots.
 */
export function ReportSectionView({ section, periodId, linkRecords }: { section: ReportSection; periodId: string; linkRecords: boolean }) {
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby={`sec-${section.section}`}>
      <h2 id={`sec-${section.section}`} className="text-base font-semibold text-paper">{section.title}</h2>
      {section.notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-mute">
          {section.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      <div className="mt-4">
        <TableShell>
          <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
            <tr><Th>Measure</Th><Th>Count</Th><Th>Counting basis</Th><Th>Records</Th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {section.metrics.map((m) => {
              const indent = m.label.startsWith("  ");
              return (
                <tr key={m.key} className="align-top">
                  <td className={`px-3 py-2 text-paper ${indent ? "pl-8 text-mute" : ""}`}>{m.label.trim()}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-paper">{m.count.toLocaleString()}</td>
                  <td className="max-w-md px-3 py-2 text-xs text-mute">{m.basis}</td>
                  <td className="px-3 py-2">
                    {m.count === 0 ? (
                      <span className="text-xs text-mute">None</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-xs text-signal">View {m.records.length}{m.truncated ? ` of ${m.count}` : ""} record(s)</summary>
                        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-2 text-xs">
                          {m.records.map((r, i) => {
                            const href = linkRecords ? recordHref(r, periodId) : null;
                            return (
                              <li key={`${r.rid}-${i}`} className="flex flex-wrap items-center gap-2">
                                {href ? <Link href={href} className="text-paper underline decoration-line hover:decoration-signal">{r.ref ?? r.rid}</Link> : <span className="text-paper">{r.ref ?? r.rid}</span>}
                                {r.status && <StatusBadge value={r.status} />}
                                {r.detail && <span className="text-mute">{r.detail}</span>}
                                {r.due && <span className="text-mute">due {fmtDate(r.due)}</span>}
                              </li>
                            );
                          })}
                          {m.truncated && <li className="text-mute">List truncated at 500; the count above is complete. Use the underlying module to see all.</li>}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </div>
    </section>
  );
}
