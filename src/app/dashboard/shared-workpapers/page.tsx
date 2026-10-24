import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader, TableShell, Th, fmtDate } from "@/components/phase2/ui";

type Row = { id: string; name: string; approved_version: number; approved_at: string; content_hash: string };

/** Approved workpapers for external auditors / viewers. Drafts, private notes and storage paths are never served here. */
export default async function SharedWorkpapers() {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_shared_workpapers", { p_org: ctx.org.id });
  const rows = (data ?? []) as Row[];
  return (
    <div className="p-8">
      <PageHeader eyebrow="Shared" title="Approved workpapers" subtitle={`${ctx.org.name} — only workpapers approved by the engagement reviewer, as the exact approved version. Working notes are never shown.`} />
      {error ? <p role="alert" className="text-sm text-rose-300">{error.message}</p> : rows.length === 0 ? (
        <p className="text-sm text-mute">No workpapers have been approved and shared yet.</p>
      ) : (
        <TableShell>
          <thead className="bg-panel text-xs text-mute"><tr><Th>Workpaper</Th><Th>Approved version</Th><Th>Approved</Th><Th>Reference</Th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="px-3 py-2"><Link className="text-paper underline-offset-2 hover:underline" href={`/dashboard/shared-workpapers/${r.id}`}>{r.name}</Link></td>
              <td className="px-3 py-2">v{r.approved_version}</td><td className="px-3 py-2">{fmtDate(r.approved_at)}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-mute">{r.content_hash.slice(0, 12)}</td>
            </tr>
          ))}</tbody>
        </TableShell>
      )}
    </div>
  );
}
