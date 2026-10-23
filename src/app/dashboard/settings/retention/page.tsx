import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Banner, StatusBadge, cardClass, fmtDate, fmtDateTime, inputClass, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import {
  archiveClientAction, decideDeletionAction, requestDeletionAction, restoreClientAction, setLegalHoldAction, setRetentionAction,
} from "@/lib/actions/workspaces";

type Req = { id: string; reason: string; status: string; requested_by: string | null; created_at: string; decision_note: string | null };

export default async function RetentionSettings({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization" description="You're not part of an organization yet." />;
  if (ctx.orgKind !== "client")
    return <div className={cardClass}><p className="text-sm text-mute">Retention, archival and deletion requests apply to client workspaces. Switch to a client workspace to manage them.</p></div>;
  const supabase = await createClient();
  const { data: s } = await supabase.from("org_retention_settings").select("*").eq("organization_id", ctx.org.id).maybeSingle();
  const { data: reqRows } = await supabase.from("deletion_requests").select("id, reason, status, requested_by, created_at, decision_note").eq("organization_id", ctx.org.id).order("created_at", { ascending: false });
  const reqs = (reqRows ?? []) as Req[];
  const archived = ctx.orgStatus === "archived";
  const isAdmin = ctx.role === "owner" || ctx.role === "admin";
  const o = ctx.org.id;

  return (
    <div className="space-y-6">
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className={cardClass}>
        <div className="flex items-center gap-3"><h2 className="text-sm font-semibold text-paper">{ctx.org.name}</h2><StatusBadge value={archived ? "closed" : "active"} /><span className="text-xs text-mute">{archived ? "Archived" : "Active"}</span></div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-mute">Retention period</dt><dd className="text-paper">{s?.retention_years ?? 7} years</dd></div>
          <div><dt className="text-xs text-mute">Retain until</dt><dd className="text-paper">{s?.retention_until ? fmtDate(s.retention_until) : archived ? "—" : "Starts when archived"}</dd></div>
          <div><dt className="text-xs text-mute">Legal hold</dt><dd className={s?.legal_hold ? "text-rose-300" : "text-paper"}>{s?.legal_hold ? `On — ${s.legal_hold_reason ?? ""}` : "Off"}</dd></div>
        </dl>
      </div>

      {isAdmin ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <form action={setRetentionAction} className={cardClass}>
              <input type="hidden" name="org_id" value={o} />
              <label className={labelClass} htmlFor="years">Retention period (years)</label>
              <input id="years" name="years" type="number" min={1} max={99} defaultValue={s?.retention_years ?? 7} className={inputClass} />
              <button className={`${secondaryBtn} mt-3`} type="submit">Save retention</button>
            </form>
            <form action={setLegalHoldAction} className={cardClass}>
              <input type="hidden" name="org_id" value={o} /><input type="hidden" name="on" value={String(!s?.legal_hold)} />
              <label className={labelClass} htmlFor="hold-reason">{s?.legal_hold ? "Reason for releasing the hold" : "Reason for the legal hold"}</label>
              <input id="hold-reason" name="reason" required minLength={5} className={inputClass} />
              <button className={`${secondaryBtn} mt-3`} type="submit">{s?.legal_hold ? "Release legal hold" : "Place legal hold"}</button>
            </form>
          </div>

          {!archived ? (
            <form action={archiveClientAction} className={`${cardClass} border-amber-900/50`}>
              <input type="hidden" name="org_id" value={o} />
              <h3 className="text-sm font-semibold text-amber-300">Archive this client</h3>
              <p className="mt-1 text-sm text-mute">Archiving ends the engagement and starts the retention clock. It does not delete anything. To confirm, type the client name exactly: <span className="font-mono text-paper">{ctx.org.name}</span></p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div><label className={labelClass} htmlFor="confirm">Client name</label><input id="confirm" name="confirm_name" required autoComplete="off" className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="arch-reason">Reason</label><input id="arch-reason" name="reason" required minLength={5} className={inputClass} /></div>
              </div>
              <button className={`${primaryBtn} mt-3`} type="submit">Archive client</button>
            </form>
          ) : (
            <>
              <form action={restoreClientAction} className={cardClass}>
                <input type="hidden" name="org_id" value={o} />
                <label className={labelClass} htmlFor="restore-reason">Reason for restoring</label>
                <input id="restore-reason" name="reason" required minLength={5} className={inputClass} />
                <button className={`${secondaryBtn} mt-3`} type="submit">Restore client</button>
              </form>
              <form action={requestDeletionAction} className={cardClass}>
                <input type="hidden" name="org_id" value={o} />
                <h3 className="text-sm font-semibold text-paper">Request deletion</h3>
                <p className="mt-1 text-sm text-mute">Records a request only. A different firm owner/admin must approve it, and approval is refused during the retention period or under legal hold. Approval does not delete data — purging is a separate, deliberate step outside this app.</p>
                <label className={`${labelClass} mt-3`} htmlFor="del-reason">Reason</label>
                <input id="del-reason" name="reason" required minLength={10} className={inputClass} />
                <button className={`${secondaryBtn} mt-3`} type="submit">Submit deletion request</button>
              </form>
            </>
          )}
        </>
      ) : <p className="text-xs text-mute">Only owners and admins can change retention, archive or request deletion.</p>}

      {reqs.length > 0 && (
        <div className={cardClass}>
          <h3 className="mb-3 text-sm font-semibold text-paper">Deletion requests</h3>
          <ul className="space-y-3">
            {reqs.map((r) => (
              <li key={r.id} className="rounded-md border border-line p-3 text-sm">
                <div className="flex items-center gap-2"><StatusBadge value={r.status} /><span className="text-xs text-mute">{fmtDateTime(r.created_at)}</span></div>
                <p className="mt-1 text-paper">{r.reason}</p>
                {r.decision_note && <p className="mt-1 text-xs text-mute">Decision note: {r.decision_note}</p>}
                {r.status === "requested" && r.requested_by !== ctx.userId && (
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
    </div>
  );
}
