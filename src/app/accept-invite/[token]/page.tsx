import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { acceptInvitationAction } from "@/lib/actions/team";

/**
 * Invitation landing page. Accepting is an explicit POST (never on page load, so link
 * previews and scanners cannot consume the token). The database verifies the token hash,
 * expiry, single use and that the signed-in email matches the invited email.
 */
export default async function AcceptInvite({ params, searchParams }: { params: { token: string }; searchParams: { error?: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && params.token !== "invalid") redirect(`/login?next=${encodeURIComponent(`/accept-invite/${params.token}`)}`);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-6 text-paper">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">Benve Control</p>
        {params.token === "invalid" ? (
          <>
            <h1 className="mt-3 font-display text-xl font-bold tracking-tight">Invitation problem</h1>
            <p role="alert" className="mt-3 text-sm text-rose-300">{searchParams.error ?? "This invitation is not valid."}</p>
            <p className="mt-3 text-sm text-mute">Ask the person who invited you to send a new link, and make sure you sign in with the invited email address.</p>
          </>
        ) : (
          <>
            <h1 className="mt-3 font-display text-xl font-bold tracking-tight">Join a client workspace</h1>
            <p className="mt-2 text-sm text-mute">Signed in as {user?.email}. Accepting adds this workspace and your assigned role to your account. It does not give access to any other workspace.</p>
            <form action={acceptInvitationAction} className="mt-6">
              <input type="hidden" name="token" value={params.token} />
              <button type="submit" className="w-full rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90">Accept invitation</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
