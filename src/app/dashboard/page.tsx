import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">
          Benve Control
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
          Welcome back
        </h1>
        <p className="mt-2 text-mute">
          Signed in as {user.email ?? user.id}
        </p>

        <div className="mt-10 rounded-xl border border-line bg-panel p-6">
          <p className="text-sm text-mute">
            This is a placeholder dashboard. Organization, control, and test
            plan views will land here as the compliance workspace is built
            out.
          </p>
        </div>
      </div>
    </main>
  );
}
