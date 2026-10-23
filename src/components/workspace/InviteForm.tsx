"use client";

import { useFormState, useFormStatus } from "react-dom";
import { inviteMemberAction, type InviteState } from "@/lib/actions/team";
import { inputClass, labelClass, primaryBtn } from "@/components/phase2/ui";

function Submit() {
  const { pending } = useFormStatus();
  return <button className={primaryBtn} disabled={pending} type="submit">{pending ? "Creating…" : "Create invitation"}</button>;
}

export function InviteForm({ orgId, roles }: { orgId: string; roles: string[] }) {
  const [state, action] = useFormState<InviteState, FormData>(inviteMemberAction, null);
  return (
    <div>
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <input type="hidden" name="org_id" value={orgId} />
        <div>
          <label className={labelClass} htmlFor="invite-email">Email (must match their sign-in email)</label>
          <input id="invite-email" name="email" type="email" required className={inputClass} placeholder="name@example.com" />
        </div>
        <div>
          <label className={labelClass} htmlFor="invite-role">Role in this workspace</label>
          <select id="invite-role" name="role" className={inputClass} defaultValue="internal_auditor">
            {roles.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <Submit />
      </form>
      {state?.error && <p role="alert" className="mt-3 text-sm text-rose-300">{state.error}</p>}
      {state?.link && (
        <div role="status" className="mt-3 rounded-md border border-emerald-900/60 bg-emerald-950/30 p-3 text-sm text-emerald-300">
          <p>Invitation created for {state.email}. Copy this single-use link and send it to them — it is shown only once and expires in 7 days.</p>
          <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} mt-2 font-mono text-xs`} aria-label="Invitation link" />
          <p className="mt-2 text-xs text-emerald-400/80">No email is sent automatically: an email provider has not been configured for this app.</p>
        </div>
      )}
    </div>
  );
}
