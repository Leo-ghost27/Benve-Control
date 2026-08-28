import Link from "next/link";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { loadStarterTemplateAction } from "@/lib/actions/templates";

type ControlRow = {
  id: string;
  code: string | null;
  title: string;
  framework: string | null;
  risk_rating: string | null;
  status: string;
};

const statusStyles: Record<string, string> = {
  active: "bg-emerald-400",
  under_testing: "bg-blue-400",
  completed: "bg-signal",
  retired: "bg-mute",
  draft: "bg-amber-400",
};

const riskStyles: Record<string, string> = {
  high: "text-rose-400",
  medium: "text-amber-400",
  low: "text-mute",
};

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    .select("id, code, title, framework, risk_rating, status")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
            Auditor Workspace
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
            Controls
          </h1>
          <p className="mt-1 text-sm text-mute">
            The control library for {ctx.org.name}.
          </p>
        </div>
        <Link
          href="/dashboard/controls/new"
          className="shrink-0 rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
        >
          New control
        </Link>
      </div>

      {error ? (
        <ErrorState />
      ) : !controls || controls.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            title="No controls yet"
            description="Create your first control, or load the Payments starter template to see a fully worked example."
            action={{ label: "New control", href: "/dashboard/controls/new" }}
          />
          <form action={loadStarterTemplateAction} className="flex justify-center">
            <button
              type="submit"
              className="rounded-md border border-line px-4 py-2 text-sm font-medium text-paper transition-colors hover:border-signal"
            >
              Load starter template — Payments: Dual Approval for High-Value Payments
            </button>
          </form>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Framework</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-ink">
              {(controls as ControlRow[]).map((control) => (
                <tr key={control.id} className="transition-colors hover:bg-panel/60">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/controls/${control.id}`}
                      className="font-mono text-xs text-mute hover:text-signal"
                    >
                      {control.code || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/controls/${control.id}`}
                      className="text-paper hover:text-signal"
                    >
                      {control.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-mute">{control.framework ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={riskStyles[control.risk_rating ?? ""] ?? "text-mute"}>
                      {formatLabel(control.risk_rating)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-mute">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          statusStyles[control.status] ?? "bg-mute"
                        }`}
                      />
                      {formatLabel(control.status)}
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
