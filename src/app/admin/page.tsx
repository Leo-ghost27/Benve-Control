import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const inputClass =
  "rounded-md border border-line px-4 py-2 text-sm font-medium text-paper transition-colors hover:border-mute";
const cardClass = "rounded-xl border border-line bg-ink p-6";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const statusStyles: Record<string, string> = {
  draft: "border-line text-mute",
  sent: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  signed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  declined: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  active: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  trialing: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  past_due: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  canceled: "border-line text-mute",
  none: "border-line text-mute",
};

export default async function AdminPage() {
  const supabase = await createClient();

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) {
    redirect("/dashboard");
  }

  const [{ data: organizations }, { data: billing }, { data: contracts }] = await Promise.all([
    supabase.from("organizations").select("id, name, slug, created_at"),
    supabase.from("organization_billing").select("*"),
    supabase
      .from("contracts")
      .select("id, client_name, client_email, status, sent_at, signed_at")
      .order("created_at", { ascending: false }),
  ]);

  const billingByOrg = new Map((billing ?? []).map((b) => [b.organization_id, b]));

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Benve Control — Operator Workspace
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          Admin Console
        </h1>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">{organizations?.length ?? 0}</p>
          <p className="text-xs text-mute">Client organizations</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">
            {(billing ?? []).filter((b) => b.billing_status === "active").length}
          </p>
          <p className="text-xs text-mute">Active subscriptions</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-bold text-paper">
            {(contracts ?? []).filter((c) => c.status === "sent").length}
          </p>
          <p className="text-xs text-mute">Contracts awaiting signature</p>
        </div>
      </div>

      <div className="space-y-6">
        <section className={cardClass}>
          <h2 className="mb-4 text-sm font-semibold text-paper">Client Organizations</h2>
          {organizations && organizations.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-panel text-xs uppercase tracking-wide text-mute">
                  <tr>
                    <th className="px-3 py-2 font-medium">Organization</th>
                    <th className="px-3 py-2 font-medium">Plan</th>
                    <th className="px-3 py-2 font-medium">Billing status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-ink">
                  {organizations.map((o) => {
                    const b = billingByOrg.get(o.id);
                    return (
                      <tr key={o.id}>
                        <td className="px-3 py-2 text-paper">{o.name}</td>
                        <td className="px-3 py-2 text-mute">{b?.plan ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              statusStyles[b?.billing_status ?? "none"]
                            }`}
                          >
                            {formatLabel(b?.billing_status ?? "none")}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-mute">No client organizations yet.</p>
          )}
        </section>

        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-paper">Contracts</h2>
            <Link href="/admin/contracts/new" className={inputClass}>
              Draft New Contract
            </Link>
          </div>
          {contracts && contracts.length > 0 ? (
            <ul className="divide-y divide-line">
              {contracts.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/admin/contracts/${c.id}`} className="text-paper hover:text-signal">
                    {c.client_name} ({c.client_email})
                  </Link>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      statusStyles[c.status] ?? statusStyles.draft
                    }`}
                  >
                    {formatLabel(c.status)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">No contracts drafted yet.</p>
          )}
        </section>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-mute">
        Admin Console is for the Benve operator only. Client billing here connects to a real
        Stripe account once STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and plan price IDs are
        configured — see the Stripe Dashboard setup notes.
      </p>
    </div>
  );
}
