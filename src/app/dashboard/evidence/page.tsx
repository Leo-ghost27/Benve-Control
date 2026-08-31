import Link from "next/link";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";

type RequestRow = {
  id: string;
  title: string;
  owner_name: string;
  status: string;
  priority: string;
  due_date: string | null;
  submitted_at: string | null;
  controls: { code: string; title: string } | { code: string; title: string }[] | null;
};

const statusStyles: Record<string, string> = {
  draft: "bg-mute",
  sent: "bg-blue-400",
  submitted: "bg-signal",
  under_review: "bg-amber-400",
  accepted: "bg-emerald-400",
  clarification_requested: "bg-amber-400",
  rejected: "bg-rose-400",
};

const priorityStyles: Record<string, string> = {
  high: "text-rose-400",
  medium: "text-amber-400",
  low: "text-mute",
};

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function control(controls: RequestRow["controls"]) {
  if (!controls) return null;
  return Array.isArray(controls) ? controls[0] ?? null : controls;
}

export default async function EvidenceReviewQueuePage() {
  const ctx = await getOrgContext();

  if (!ctx?.org) {
    return (
      <div className="p-8">
        <EmptyState
          title="No organization yet"
          description="Join or create an organization to start requesting evidence."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: requests, error } = await supabase
    .from("evidence_requests")
    .select("id, title, owner_name, status, priority, due_date, submitted_at, controls(code, title)")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Auditor Workspace
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          Evidence Review Queue
        </h1>
        <p className="mt-1 text-sm text-mute">
          Evidence requests for {ctx.org.name}.
        </p>
      </div>

      {error ? (
        <ErrorState />
      ) : !requests || requests.length === 0 ? (
        <EmptyState
          title="No evidence requests yet"
          description="Request evidence from a control's detail page to see it here."
          action={{ label: "Go to Controls", href: "/dashboard/controls" }}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
              <tr>
                <th className="px-4 py-3 font-medium">Request</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Related control</th>
                <th className="px-4 py-3 font-medium">Submitted by</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Due date</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-ink">
              {(requests as unknown as RequestRow[]).map((req) => {
                const ctrl = control(req.controls);
                return (
                  <tr key={req.id} className="transition-colors hover:bg-panel/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/evidence-requests/${req.id}`}
                        className="text-paper hover:text-signal"
                      >
                        {req.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-mute">{ctx.org!.name}</td>
                    <td className="px-4 py-3 text-mute">
                      {ctrl ? `${ctrl.code} — ${ctrl.title}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-mute">{req.owner_name}</td>
                    <td className="px-4 py-3 text-mute">
                      {req.submitted_at
                        ? new Date(req.submitted_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-mute">{req.due_date ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={priorityStyles[req.priority] ?? "text-mute"}>
                        {formatLabel(req.priority)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-mute">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            statusStyles[req.status] ?? "bg-mute"
                          }`}
                        />
                        {formatLabel(req.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
