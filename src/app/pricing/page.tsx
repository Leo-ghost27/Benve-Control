import Link from "next/link";

const plans = [
  {
    name: "Starter",
    audience: "Pre-seed / seed companies preparing for SOX readiness",
    price: "$499",
    features: [
      "Risk & control framework",
      "Testing methodology & sampling",
      "Deficiency tracking",
      "Single organization",
    ],
    featured: false,
  },
  {
    name: "Growth",
    audience: "Series B/C, pre-IPO companies building formal ICFR",
    price: "$1,299",
    features: [
      "Everything in Starter",
      "ICFR annual report & SOX 302 certification",
      "External auditor coordination hub",
      "Continuous controls monitoring",
      "Pre-IPO readiness centre",
    ],
    featured: true,
  },
  {
    name: "Enterprise",
    audience: "Public companies and groups with multiple entities",
    price: "$2,499",
    features: [
      "Everything in Growth",
      "Multi-entity / group ICFR roll-up",
      "ITGC depth & automated control library",
      "Priority support",
    ],
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="font-display text-lg font-bold tracking-tight">
          Benve Control
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-paper transition-colors hover:border-signal"
        >
          Log in
        </Link>
      </div>

      <div className="mx-auto max-w-4xl px-6 pb-6 pt-8 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">Pricing</p>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Simple, transparent pricing for SOX/ICFR
        </h1>
        <p className="mt-4 text-base text-mute sm:text-lg">
          Every plan includes the full risk &amp; control framework, testing workbench, and
          deficiency tracking. Higher tiers add reporting, external audit coordination, and
          multi-entity depth.
        </p>
      </div>

      <div className="mx-auto grid max-w-5xl gap-6 px-6 pb-24 md:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`flex flex-col rounded-xl border p-6 ${
              plan.featured ? "border-signal shadow-lg shadow-signal/10" : "border-line"
            } bg-panel`}
          >
            <p className="font-display text-lg font-bold text-paper">{plan.name}</p>
            <p className="mt-1 text-xs text-mute">{plan.audience}</p>
            <p className="mt-6 font-display text-3xl font-bold text-paper">
              {plan.price}
              <span className="text-sm font-normal text-mute"> /month</span>
            </p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-paper/90">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-signal" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className={`mt-8 rounded-md px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                plan.featured
                  ? "bg-signal text-white hover:bg-signal/90"
                  : "border border-line text-paper hover:border-signal"
              }`}
            >
              Start Free Trial
            </Link>
          </div>
        ))}
      </div>

      <p className="mx-auto max-w-2xl px-6 pb-16 text-center text-xs text-mute">
        Pricing is indicative and depends on entity count, users, and modules enabled. Contact{" "}
        <a href="mailto:hello@benvecontrol.com" className="text-signal hover:underline">
          hello@benvecontrol.com
        </a>{" "}
        for an Enterprise quote.
      </p>
    </main>
  );
}
