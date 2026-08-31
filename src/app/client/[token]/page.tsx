import { notFound } from "next/navigation";
import Link from "next/link";
import { resolveClientToken } from "@/lib/actions/client-evidence";
import { createAdminClient } from "@/lib/supabase/admin";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const statusStyles: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-50 text-blue-700",
  submitted: "bg-indigo-50 text-indigo-700",
  under_review: "bg-amber-50 text-amber-700",
  accepted: "bg-emerald-50 text-emerald-700",
  clarification_requested: "bg-amber-50 text-amber-700",
  rejected: "bg-rose-50 text-rose-700",
};

export default async function ClientActionsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await resolveClientToken(token);
  if (!link) notFound();

  const admin = createAdminClient();
  const { data: requests } = await admin
    .from("evidence_requests")
    .select("id, title, due_date, status, controls(code, title)")
    .eq("organization_id", link.organizationId)
    .eq("owner_email", link.ownerEmail)
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-12 text-gray-900">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          {link.organizationName}
        </p>
        <h1 className="mt-2 text-2xl font-bold">
          Good morning, {link.ownerName.split(" ")[0]}. Here are the items Benve needs from
          you.
        </h1>

        <h2 className="mt-8 mb-3 text-sm font-semibold text-gray-500">My evidence requests</h2>
        {!requests || requests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            No requests assigned to you right now.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Request</th>
                  <th className="px-4 py-3 font-medium">Related control</th>
                  <th className="px-4 py-3 font-medium">Due date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.map((req) => {
                  const ctrl = Array.isArray(req.controls) ? req.controls[0] : req.controls;
                  return (
                    <tr key={req.id}>
                      <td className="px-4 py-3 font-medium">{req.title}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {ctrl ? (ctrl as { title: string }).title : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{req.due_date ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            statusStyles[req.status] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {formatLabel(req.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/client/${token}/requests/${req.id}`}
                          className="text-sm font-medium text-indigo-600 hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <h2 className="mt-8 mb-3 text-sm font-semibold text-gray-500">
          My remediation actions
        </h2>
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Remediation actions aren&apos;t connected to this view yet — check with your auditor
          for any outstanding items.
        </div>

        <p className="mt-8 text-xs leading-relaxed text-gray-400">
          Benve helps you submit requested information and track assigned actions. Benve&apos;s
          auditor remains responsible for determining the audit procedures, evaluating
          evidence, and documenting conclusions.
        </p>
      </div>
    </main>
  );
}
