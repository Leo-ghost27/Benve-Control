import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/dashboard/TopBar";
import { createOrganizationAction } from "@/lib/actions/organizations";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getOrgContext();

  if (!ctx) {
    redirect("/login");
  }

  if (!ctx.org) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink px-6 text-paper">
        <div className="w-full max-w-md rounded-xl border border-line bg-panel p-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">
            Benve Control
          </p>
          <h1 className="mt-3 font-display text-xl font-bold tracking-tight">
            Create your organization
          </h1>
          <p className="mt-2 text-sm text-mute">
            You&apos;re signed in as {ctx.userEmail}. Create an organization
            to start using the Auditor Workspace — you&apos;ll be added as
            its owner.
          </p>
          <form action={createOrganizationAction} className="mt-6">
            <label htmlFor="name" className="mb-2 block text-xs font-medium text-mute">
              Organization name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="e.g. Meridian Pay"
              className="w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal"
            />
            <button
              type="submit"
              className="mt-4 w-full rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
            >
              Create organization
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-ink text-paper">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          orgName={ctx.org?.name ?? null}
          userEmail={ctx.userEmail}
          role={ctx.role}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
