import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";

type EvidenceRow = {
  id: string;
  file_name: string;
  description: string | null;
  due_date: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isDueSoon(dueDate: string | null) {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 14);
  return due >= now && due <= cutoff;
}

export default async function EvidencePage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to start collecting evidence."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: evidence, error } = await supabase
    .from("evidence")
    .select("id, file_name, description, due_date")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-paper">
          Evidence
        </h1>
        <p className="mt-1 text-sm text-mute">
          Supporting documentation for {ctx.org.name}.
        </p>
      </div>

      {error ? (
        <ErrorState />
      ) : !evidence || evidence.length === 0 ? (
        <EmptyState
          title="No evidence yet"
          description="Files and documentation collected for testing will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
              <tr>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-ink">
              {(evidence as EvidenceRow[]).map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-paper">{item.file_name}</td>
                  <td className="px-4 py-3 text-mute">
                    {item.description ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        isDueSoon(item.due_date)
                          ? "font-medium text-amber-400"
                          : "text-mute"
                      }
                    >
                      {formatDate(item.due_date)}
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
