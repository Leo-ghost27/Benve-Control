import { notFound } from "next/navigation";
import Link from "next/link";
import { resolveClientToken, submitClientEvidenceAction } from "@/lib/actions/client-evidence";
import { createAdminClient } from "@/lib/supabase/admin";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function ClientEvidenceRequestPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const link = await resolveClientToken(token);
  if (!link) notFound();

  const admin = createAdminClient();
  const { data: request, error } = await admin
    .from("evidence_requests")
    .select("*, controls(code, title)")
    .eq("id", id)
    .eq("organization_id", link.organizationId)
    .eq("owner_email", link.ownerEmail)
    .single();

  if (error || !request) notFound();

  const control = Array.isArray(request.controls) ? request.controls[0] : request.controls;
  const alreadySubmitted = Boolean(request.submitted_file_name);

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-12 text-gray-900">
      <div className="mx-auto max-w-xl">
        <Link href={`/client/${token}`} className="text-sm text-gray-500 hover:text-gray-800">
          &larr; Back to my actions
        </Link>

        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-7">
          <h1 className="text-xl font-bold">{request.title}</h1>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              What we need
            </p>
            <p className="mt-1.5 text-sm text-gray-700">{request.instructions ?? "—"}</p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Related control
              </p>
              <p className="mt-1 text-sm font-medium">
                {control ? (control as { title: string }).title : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Due date
              </p>
              <p className="mt-1 text-sm font-medium">{request.due_date ?? "—"}</p>
            </div>
          </div>

          {alreadySubmitted ? (
            <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-5">
              <p className="text-sm font-semibold text-gray-700">Submitted</p>
              <p className="mt-2 text-sm text-gray-600">File: {request.submitted_file_name}</p>
              <p className="text-sm text-gray-600">Submitted by: {request.submitted_by}</p>
              <p className="text-sm text-gray-600">
                Submitted:{" "}
                {request.submitted_at ? new Date(request.submitted_at).toLocaleString() : "—"}
              </p>
              <p className="mt-2 inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                {formatLabel(request.status)}
              </p>
              {request.auditor_comment && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span className="font-medium">Auditor comment:</span>{" "}
                  {request.auditor_comment}
                </div>
              )}
            </div>
          ) : (
            <form action={submitClientEvidenceAction} className="mt-6 space-y-4">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="requestId" value={id} />

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Your name
                </label>
                <input
                  type="text"
                  name="submitted_by"
                  required
                  defaultValue={link.ownerName}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Note (optional)
                </label>
                <textarea
                  name="client_note"
                  rows={2}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="Add any context for your auditor."
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">File</label>
                <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center">
                  <input
                    type="file"
                    name="file"
                    required
                    accept=".pdf,.xlsx,.csv,.png,.jpg,.jpeg,.docx"
                    className="mx-auto block text-sm text-gray-700"
                  />
                  <p className="mt-3 text-xs text-gray-400">
                    PDF, XLSX, CSV, PNG, JPG, or DOCX. Max file size 20 MB.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  Submit evidence
                </button>
                <button
                  type="button"
                  className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Ask a question
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-6 text-xs leading-relaxed text-gray-400">
          Benve helps you submit requested information and track assigned actions. Benve&apos;s
          auditor remains responsible for determining the audit procedures, evaluating
          evidence, and documenting conclusions.
        </p>
      </div>
    </main>
  );
}
