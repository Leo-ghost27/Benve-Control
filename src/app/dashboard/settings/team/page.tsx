import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { InviteForm } from "@/components/workspace/InviteForm";
import { Banner, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDateTime, inputClass, label, secondaryBtn } from "@/components/phase2/ui";
import { changeMemberRoleAction, removeMemberAction, revokeInvitationAction, setPermissionAction } from "@/lib/actions/team";
import { setReviewSettingAction } from "@/lib/actions/reviews";

const ALL_ROLES = ["owner", "admin", "cfo", "controller", "internal_auditor", "external_auditor", "adviser", "viewer"];
const PERMS: [string, string][] = [["review.approve", "Can approve reviews"], ["scope.sign", "Can sign scope"]];

type Member = { user_id: string; role: string; full_name: string | null; email: string | null };
type Invite = { id: string; email: string; role: string; status: string; expires_at: string; created_at: string };

export default async function TeamSettings({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization" description="You're not part of an organization yet." />;
  const isManager = ctx.role === "owner" || ctx.role === "admin";
  const grantable = ctx.role === "owner" ? ALL_ROLES : ALL_ROLES.filter((r) => r !== "owner" && r !== "admin");
  const supabase = await createClient();
  const { data: memberRows, error } = await supabase.rpc("p2_org_members", { p_org: ctx.org.id });
  if (error) return <PermissionDenied message={error.message} />;
  const members = (memberRows ?? []) as Member[];
  const { data: inviteRows } = isManager
    ? await supabase.from("org_invitations").select("id, email, role, status, expires_at, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false })
    : { data: [] };
  const invites = (inviteRows ?? []) as Invite[];
  const { data: permRows } = await supabase.from("engagement_permissions").select("user_id, permission").eq("organization_id", ctx.org.id);
  const { data: rsRow } = await supabase.from("engagement_review_settings").select("require_separate_review").eq("organization_id", ctx.org.id).maybeSingle();
  const requireSeparate = rsRow?.require_separate_review ?? true;
  const perms = new Set((permRows ?? []).map((p: { user_id: string; permission: string }) => `${p.user_id}:${p.permission}`));

  return (
    <div className="space-y-6">
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <p className="text-sm text-mute">
        People and roles for <span className="text-paper">{ctx.org.name}</span> only. The same person can hold a different role in each client workspace.
      </p>

      {isManager && (
        <form action={setReviewSettingAction} className={`${cardClass} flex flex-wrap items-center gap-3`}>
          <input type="hidden" name="org_id" value={ctx.org.id} /><input type="hidden" name="require_separate" value={String(!requireSeparate)} />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-paper">Separate review</h2>
            <p className="text-xs text-mute">{requireSeparate ? "Required: the person who prepared or is assigned a workpaper cannot approve it." : "Not required: preparers with approval authority may approve their own work."}</p>
          </div>
          <button className={secondaryBtn} type="submit">{requireSeparate ? "Allow self-review" : "Require separate review"}</button>
        </form>
      )}

      {isManager && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-paper">Invite someone to this workspace</h2>
          <InviteForm orgId={ctx.org.id} roles={grantable} />
        </div>
      )}

      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-paper">Members</h2>
        <TableShell>
          <thead className="bg-panel text-xs text-mute"><tr><Th>Person</Th><Th>Role here</Th><Th>Engagement permissions</Th>{isManager && <Th>Manage</Th>}</tr></thead>
          <tbody>
            {members.map((m) => {
              const self = m.user_id === ctx.userId;
              return (
                <tr key={m.user_id} className="border-t border-line align-top">
                  <td className="px-3 py-2 text-paper">{m.full_name ?? m.email ?? m.user_id}{self && <span className="ml-1 text-xs text-mute">(you)</span>}<div className="text-xs text-mute">{m.email}</div></td>
                  <td className="px-3 py-2">{label(m.role)}</td>
                  <td className="px-3 py-2">
                    {PERMS.map(([p, text]) => {
                      const has = perms.has(`${m.user_id}:${p}`);
                      return isManager ? (
                        <form key={p} action={setPermissionAction} className="mb-1 flex items-center gap-2 text-xs">
                          <input type="hidden" name="org_id" value={ctx.org!.id} /><input type="hidden" name="user_id" value={m.user_id} />
                          <input type="hidden" name="permission" value={p} /><input type="hidden" name="granted" value={String(!has)} />
                          <button className={secondaryBtn} type="submit">{has ? "Revoke" : "Grant"}</button><span className={has ? "text-emerald-300" : "text-mute"}>{text}</span>
                        </form>
                      ) : has ? <div key={p} className="text-xs text-emerald-300">{text}</div> : null;
                    })}
                  </td>
                  {isManager && (
                    <td className="px-3 py-2">
                      {self ? <span className="text-xs text-mute">—</span> : (
                        <div className="flex flex-wrap gap-2">
                          <form action={changeMemberRoleAction} className="flex gap-1">
                            <input type="hidden" name="org_id" value={ctx.org!.id} /><input type="hidden" name="user_id" value={m.user_id} />
                            <select name="role" defaultValue={m.role} className={`${inputClass} !w-auto !py-1 text-xs`} aria-label={`Role for ${m.email ?? m.user_id}`}>
                              {ALL_ROLES.map((r) => <option key={r} value={r} disabled={!grantable.includes(r) && r !== m.role}>{label(r)}</option>)}
                            </select>
                            <button className={secondaryBtn} type="submit">Change</button>
                          </form>
                          <form action={removeMemberAction}>
                            <input type="hidden" name="org_id" value={ctx.org!.id} /><input type="hidden" name="user_id" value={m.user_id} />
                            <button className={`${secondaryBtn} text-rose-300`} type="submit">Revoke access</button>
                          </form>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </TableShell>
        <p className="mt-2 text-xs text-mute">Role changes are checked in the database: admins cannot grant or change owner/admin roles, you cannot change your own role, and the last owner cannot be removed.</p>
      </div>

      {isManager && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-paper">Invitations</h2>
          {invites.length === 0 ? <p className="text-sm text-mute">No invitations yet.</p> : (
            <TableShell>
              <thead className="bg-panel text-xs text-mute"><tr><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Expires</Th><Th>{" "}</Th></tr></thead>
              <tbody>{invites.map((i) => {
                const expired = i.status === "pending" && new Date(i.expires_at) < new Date();
                return (
                  <tr key={i.id} className="border-t border-line">
                    <td className="px-3 py-2 text-paper">{i.email}</td><td className="px-3 py-2">{label(i.role)}</td>
                    <td className="px-3 py-2"><StatusBadge value={expired ? "rejected" : i.status === "pending" ? "requested" : i.status === "accepted" ? "approved" : "returned"} /> <span className="text-xs text-mute">{expired ? "expired" : i.status}</span></td>
                    <td className="px-3 py-2">{fmtDateTime(i.expires_at)}</td>
                    <td className="px-3 py-2">{i.status === "pending" && !expired && (
                      <form action={revokeInvitationAction}><input type="hidden" name="invitation_id" value={i.id} /><button className={secondaryBtn} type="submit">Revoke</button></form>
                    )}</td>
                  </tr>
                );
              })}</tbody>
            </TableShell>
          )}
        </div>
      )}
    </div>
  );
}
