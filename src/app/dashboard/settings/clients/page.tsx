import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Banner, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDate, inputClass, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { claimClientAccessAction, createClientAction, decideDeletionAction, switchWorkspaceAction } from "@/lib/actions/workspaces";

type ClientRow = { id: string; name: string; status: string; created_at: string; i_am_member: boolean };

export default async function ClientAccess({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization" description="You're not part of an organization yet." />;
  if (ctx.orgKind !== "firm")
    return (
      <PermissionDenied message="Client access is managed from your firm workspace. Use the workspace selector in the header to switch to your firm, or convert your organization to a firm under Organization." />
    );
  if (ctx.role !== "owner" && ctx.role !== "admin")
    return <PermissionDenied message="Only firm owners and admins can manage clients." />;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_firm_clients", { p_firm: ctx.org.id });
  if (error) return <PermissionDenied message={error.message} />;
  const clients = (data ?? []) as ClientRow[];
  // Firm owners/admins decide deletion requests for their clients without needing access to the client's workpapers.
  const { data: pendingRows } = await supabase
    .from("deletion_requests")
    .select("id, organization_id, reason, requested_by, created_at")
    .eq("status", "requested");
  const pending = ((pendingRows ?? []) as { id: string; organization_id: string; reason: string; requested_by: string | null; created_at: string }[])
    .filter((r) => clients.some((c) => c.id === r.organization_id));

  return (
    <div className="space-y-6">
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <p className="text-sm text-mute">
        Each client is a separate, confidential workspace. Being part of the firm does <span className="text-paper">not</span> let anyone open a client&apos;s
        workpapers — access is a membership in that client. This list shows names and status only.
      </p>

      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-paper">Client workspaces</h2>
        {clients.length === 0 ? <p className="text-sm text-mute">No clients yet.</p> : (
          <TableShell>
            <thead className="bg-panel text-xs text-mute"><tr><Th>Client</Th><Th>Status</Th><Th>Created</Th><Th>Access</Th></tr></thead>
            <tbody>{clients.map((c) => (
              <tr key={c.id} className="border-t border-line align-top">
                <td className="px-3 py-2 text-paper">{c.name}</td>
                <td className="px-3 py-2"><StatusBadge value={c.status} /></td>
                <td className="px-3 py-2">{fmtDate(c.created_at)}</td>
                <td className="px-3 py-2">
                  {c.i_am_member ? (
                    <form action={switchWorkspaceAction}>
                      <input type="hidden" name="workspace_id" value={c.id} />
                      <button className={secondaryBtn} type="submit">Open workspace</button>
                    </form>
                  ) : (
                    <form action={claimClientAccessAction} className="space-y-1">
                      <input type="hidden" name="org_id" value={c.id} />
                      <select name="role" className={`${inputClass} !py-1 text-xs`} defaultValue="internal_auditor" aria-label="Role to claim">
                        <option value="internal_auditor">Internal auditor</option><option value="adviser">Adviser</option><option value="viewer">Viewer</option>
                      </select>
                      <input name="reason" required minLength={10} placeholder="Reason (logged, min 10 chars)" className={`${inputClass} !py-1 text-xs`} aria-label="Reason for access" />
                      <button className={secondaryBtn} type="submit">Claim access (logged)</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </TableShell>
        )}
      </div>

      {pending.length > 0 && (
        <div className={`${cardClass} border-amber-900/50`}>
          <h2 className="mb-3 text-sm font-semibold text-amber-300">Pending deletion requests</h2>
          <ul className="space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="rounded-md border border-line p-3 text-sm">
                <p className="text-paper">{clients.find((c) => c.id === r.organization_id)?.name}: {r.reason}</p>
                <p className="mt-1 text-xs text-mute">Approval is refused during the retention period or under legal hold, and never deletes data. The requester cannot decide their own request.</p>
                {r.requested_by !== ctx.userId && (
                  <form action={decideDeletionAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="request_id" value={r.id} />
                    <input name="note" placeholder="Note" className={`${inputClass} !w-56 !py-1 text-xs`} aria-label="Decision note" />
                    <button name="approve" value="true" className={secondaryBtn} type="submit">Approve</button>
                    <button name="approve" value="false" className={`${secondaryBtn} text-rose-300`} type="submit">Reject</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={createClientAction} className={`${cardClass} grid gap-3 sm:grid-cols-2`}>
        <input type="hidden" name="firm_id" value={ctx.org.id} />
        <h2 className="text-sm font-semibold text-paper sm:col-span-2">Add a client workspace</h2>
        {([["name", "Client display name *", true], ["legal_name", "Legal name", false], ["industry", "Industry", false],
           ["fiscal_year_end", "Fiscal year end (MM-DD)", false], ["contact_name", "Primary contact", false],
           ["contact_email", "Contact email", false], ["engagement_type", "Engagement type", false]] as const).map(([n, t, req]) => (
          <div key={n}><label className={labelClass} htmlFor={`c-${n}`}>{t}</label><input id={`c-${n}`} name={n} required={req} className={inputClass} /></div>
        ))}
        <p className="text-xs text-mute sm:col-span-2">You become the engagement owner of the new workspace (recorded in its audit trail). Invite staff, your CPA and client users from that workspace&apos;s Team settings.</p>
        <button className={`${primaryBtn} sm:w-fit`} type="submit">Create client workspace</button>
      </form>
    </div>
  );
}
