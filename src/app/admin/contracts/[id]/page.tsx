import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateContractDraftAction, markContractSentAction } from "@/lib/actions/contracts";
import { CopyLinkButton } from "@/components/admin/CopyLinkButton";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const cardClass = "rounded-xl border border-line bg-ink p-6";
const primaryBtn =
  "rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const statusStyles: Record<string, string> = {
  draft: "border-line text-mute",
  sent: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  signed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  declined: "border-rose-400/40 bg-rose-400/10 text-rose-300",
};

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/dashboard");

  const { data: contract, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !contract) notFound();

  const signingPath = `/sign/${contract.access_token}`;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Admin Console
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          {contract.client_name}
        </h1>
        <p className="mt-1 text-sm text-mute">{contract.client_email}</p>
        <span
          className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            statusStyles[contract.status] ?? statusStyles.draft
          }`}
        >
          {formatLabel(contract.status)}
        </span>
      </div>

      <div className="space-y-6">
        <div className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Contract</h2>
          <form action={updateContractDraftAction} className="space-y-4">
            <input type="hidden" name="contractId" value={contract.id} />
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mute">
                Title
              </label>
              <input
                className={inputClass}
                name="title"
                defaultValue={contract.title}
                disabled={contract.status !== "draft"}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mute">
                Body text
              </label>
              <textarea
                className={inputClass}
                name="body_text"
                rows={16}
                defaultValue={contract.body_text}
                disabled={contract.status !== "draft"}
              />
            </div>
            {contract.status === "draft" && (
              <button type="submit" className={primaryBtn}>
                Save Changes
              </button>
            )}
          </form>
        </div>

        {contract.status === "draft" && (
          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Send for Signature</h2>
            <p className="mb-4 text-sm text-mute">
              This app has no email-sending integration configured. Marking this as sent generates
              a signing link — copy it and send it to the client yourself (email, message, etc.).
            </p>
            <form action={markContractSentAction}>
              <input type="hidden" name="contractId" value={contract.id} />
              <button type="submit" className={primaryBtn}>
                Mark as Sent &amp; Generate Link
              </button>
            </form>
          </div>
        )}

        {contract.status !== "draft" && (
          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Signing Link</h2>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-line bg-panel px-3 py-2 text-xs text-paper">
                {signingPath}
              </code>
              <CopyLinkButton path={signingPath} />
            </div>
          </div>
        )}

        {contract.status === "signed" && (
          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Signature Record</h2>
            <div className="space-y-1 text-sm">
              <p className="text-paper">
                Signed by <strong>{contract.signer_name}</strong>
                {contract.signer_title ? `, ${contract.signer_title}` : ""}
              </p>
              <p className="text-mute">
                {contract.signed_at ? new Date(contract.signed_at).toLocaleString() : "—"}
              </p>
              <p className="text-mute">IP address: {contract.signer_ip || "—"}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
