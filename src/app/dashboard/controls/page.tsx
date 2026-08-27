import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";

type ControlRow = {
  id: string;
  code: string | null;
  title: string;
  category: string | null;
  status: string;
};

const statusStyles: Record<string, string> = {
  active: "bg-emerald-400",
  retired: "bg-mute",
  draft: "bg-amber-400",
};

export default async function ControlsPage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to start tracking controls."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: controls, error } = await supabase
    .from("controls")
    .select("id, code, title, category, status")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-paper">
          Controls
        </h1>
        <p className="mt-1 text-sm text-mute">
          The control library for {ctx.org.name}.
        </p>
      </div>

      {error ? (
        <ErrorState />
      ) : !controls || controls.length === 0 ? (
        <EmptyState
          title="No controls yet"
          description="Controls added to this organization will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-ink">
              {(controls as ControlRow[]).map((control) => (
                <tr key={control.id}>
                  <td className="px-4 py-3 font-mono text-xs text-mute">
                    {control.code ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-paper">{control.title}</td>
                  <td className="px-4 py-3 text-mute">
                    {control.category ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-mute">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          statusStyles[control.status] ?? "bg-mute"
                        }`}
                      />
                      {control.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
