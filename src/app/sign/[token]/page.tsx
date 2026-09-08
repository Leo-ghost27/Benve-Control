import { createAdminClient } from "@/lib/supabase/admin";
import { signContractAction } from "@/lib/actions/contracts";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const cardClass = "rounded-xl border border-line bg-ink p-6";
const primaryBtn =
  "rounded-md bg-signal px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-signal/90";

export default async function SignContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ signed?: string }>;
}) {
  const { token } = await params;
  const { signed } = await searchParams;

  const admin = createAdminClient();
  const { data: contract, error } = await admin
    .from("contracts")
    .select("id, client_name, title, body_text, status, signer_name, signed_at")
    .eq("access_token", token)
    .maybeSingle();

  if (error || !contract) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-8 text-center">
        <div>
          <h1 className="font-display text-xl font-bold text-paper">Link not found</h1>
          <p className="mt-2 text-sm text-mute">
            This signing link is invalid or has expired. Please contact the sender for a new one.
          </p>
        </div>
      </main>
    );
  }

  const justSigned = signed === "1";
  const isSigned = contract.status === "signed";

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">
        Benve Control — Engagement Letter
      </p>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-paper">
        {contract.title}
      </h1>
      <p className="mt-1 text-sm text-mute">Prepared for {contract.client_name}</p>

      <div className={`${cardClass} mt-6`}>
        <p className="whitespace-pre-line text-sm leading-relaxed text-paper/90">
          {contract.body_text}
        </p>
      </div>

      {isSigned ? (
        <div className="mt-6 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-6 text-center">
          <p className="font-display text-lg font-bold text-paper">
            {justSigned ? "Thank you — signed successfully." : "This engagement letter has been signed."}
          </p>
          <p className="mt-2 text-sm text-mute">
            Signed by {contract.signer_name} on{" "}
            {contract.signed_at ? new Date(contract.signed_at).toLocaleDateString() : "—"}.
          </p>
        </div>
      ) : (
        <div className={`${cardClass} mt-6`}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Sign this Engagement Letter</h2>
          <form action={signContractAction} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mute">
                Type your full legal name to sign
              </label>
              <input className={inputClass} name="signer_name" required placeholder="Jane Doe" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mute">
                Title (optional)
              </label>
              <input className={inputClass} name="signer_title" placeholder="Chief Financial Officer" />
            </div>
            <label className="flex items-start gap-2 text-sm text-paper/90">
              <input
                type="checkbox"
                name="agreed"
                required
                className="mt-1 h-4 w-4 rounded border-line bg-panel accent-signal"
              />
              I have read and agree to the terms of this engagement letter, and I am authorised to
              sign on behalf of {contract.client_name}. I understand that typing my name above and
              submitting this form constitutes my electronic signature.
            </label>
            <button type="submit" className={primaryBtn}>
              Sign Engagement Letter
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
