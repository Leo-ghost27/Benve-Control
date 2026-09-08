"use client";

import { useState } from "react";

const plans = [
  { id: "starter", label: "Starter" },
  { id: "growth", label: "Growth" },
  { id: "enterprise", label: "Enterprise" },
];

export function BillingCard({
  planLabel,
  status,
  canManage,
}: {
  planLabel: string;
  status: string;
  canManage: boolean;
}) {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(plan: string) {
    setError(null);
    setLoadingPlan(plan);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      window.location.href = data.url;
    } catch (err) {
      setError((err as Error).message);
      setLoadingPlan(null);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-mute">Billing</p>
      <p className="mt-2 text-sm text-paper">
        Plan: {planLabel} · Status: {status}
      </p>
      {canManage && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {plans.map((p) => (
              <button
                key={p.id}
                onClick={() => startCheckout(p.id)}
                disabled={loadingPlan !== null}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-paper transition-colors hover:border-signal disabled:opacity-50"
              >
                {loadingPlan === p.id ? "Redirecting…" : `Subscribe to ${p.label}`}
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        </>
      )}
    </div>
  );
}
