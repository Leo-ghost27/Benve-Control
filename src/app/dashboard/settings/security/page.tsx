import { getOrgContext } from "@/lib/supabase/org";
import { cardClass } from "@/components/phase2/ui";

export default async function SecuritySettings() {
  const ctx = await getOrgContext();
  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <h2 className="text-sm font-semibold text-paper">Sign-in</h2>
        <p className="mt-2 text-sm text-mute">Signed in as {ctx?.userEmail ?? "—"} through GitHub. Invitations only work for the email address your GitHub account uses.</p>
      </div>
      <div className={cardClass}>
        <h2 className="text-sm font-semibold text-paper">What is enforced for this workspace</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">
          <li>Every record is scoped to one client workspace by database row-level security, not by what the screen shows.</li>
          <li>Firm membership gives no access to client workpapers. Access is a membership in that client, or a logged, reasoned firm access claim.</li>
          <li>Membership and role changes happen only through audited database functions; direct edits are rejected.</li>
          <li>Invitation tokens are stored only as hashes, are single-use, expire after 7 days, and are bound to an email address.</li>
        </ul>
      </div>
      <div className={`${cardClass} border-amber-900/50`}>
        <h2 className="text-sm font-semibold text-amber-300">Not configurable from this app</h2>
        <p className="mt-2 text-sm text-mute">
          Multi-factor authentication, single sign-on and session lifetime are controlled by your Supabase Auth and GitHub
          account settings. No setting is stored here, so none is shown as if it were active.
        </p>
      </div>
    </div>
  );
}
