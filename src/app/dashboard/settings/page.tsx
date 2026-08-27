import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";

export default async function SettingsPage() {
  const ctx = await getOrgContext();

  if (!ctx) {
    return null;
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-paper">
          Settings
        </h1>
        <p className="mt-1 text-sm text-mute">Account and organization details.</p>
      </div>

      <div className="max-w-xl space-y-4">
        <div className="rounded-xl border border-line bg-panel p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-mute">
            Account
          </p>
          <p className="mt-2 text-sm text-paper">{ctx.userEmail ?? "—"}</p>
        </div>

        {ctx.org ? (
          <div className="rounded-xl border border-line bg-panel p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-mute">
              Organization
            </p>
            <p className="mt-2 text-sm text-paper">{ctx.org.name}</p>
            <p className="mt-1 text-xs text-mute">Role: {ctx.role}</p>
          </div>
        ) : (
          <EmptyState
            title="No organization"
            description="You're not part of an organization yet."
          />
        )}
      </div>
    </div>
  );
}
