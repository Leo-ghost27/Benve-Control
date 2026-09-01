const ledger = [
  {
    id: "CTRL-014",
    framework: "SOX 404",
    name: "Access review",
    status: "Cleared",
  },
  {
    id: "CTRL-021",
    framework: "ICFR",
    name: "Change management",
    status: "In review",
  },
  {
    id: "CTRL-032",
    framework: "OCC",
    name: "Third-party risk",
    status: "Cleared",
  },
  {
    id: "CTRL-045",
    framework: "SOX 404",
    name: "Segregation of duties",
    status: "Scheduled",
  },
] as const;

const statusStyles: Record<string, string> = {
  Cleared: "bg-emerald-400",
  "In review": "bg-amber-400",
  Scheduled: "bg-mute",
};

export default function Home() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-lg font-bold tracking-tight">
          Benve Control
        </span>
        <a
          href="/login"
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-paper transition-colors hover:border-signal"
        >
          Log in
        </a>
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 pb-20 pt-4 md:pb-28 lg:flex-row lg:items-center lg:gap-12">
        {/* Hero */}
        <div className="flex-1">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">
            Compliance infrastructure
          </p>
          <h1 className="mt-5 font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Benve Control
          </h1>
          <p className="mt-6 max-w-xl text-xl font-medium text-paper/90 sm:text-2xl">
            The Digital Compliance Platform for Fintechs
          </p>
          <p className="mt-4 max-w-lg text-base text-mute sm:text-lg">
            SOX 404/ICFR and OCC readiness—built for fintechs.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="/demos"
              className="rounded-md bg-signal px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
            >
              Explore the product tour
            </a>
            <a
              href="mailto:hello@benvecontrol.com"
              className="rounded-md border border-line px-5 py-3 text-sm font-semibold text-paper transition-colors hover:border-signal"
            >
              Talk to us
            </a>
          </div>
          <p className="mt-4 text-sm text-mute">
            35 modules covering the full SOX 404 / ICFR workflow —{" "}
            <a href="/demos" className="text-signal underline underline-offset-2 hover:text-signal/80">
              see the full list
            </a>
            .
          </p>
        </div>

        {/* Signature element: control ledger */}
        <div
          id="ledger"
          className="w-full flex-1 rounded-xl border border-line bg-panel p-2 shadow-2xl shadow-black/40 lg:max-w-md"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-mono text-xs uppercase tracking-[0.15em] text-mute">
              Control ledger
            </span>
            <span className="font-mono text-xs text-mute">Q3</span>
          </div>
          <ul>
            {ledger.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${statusStyles[item.status]}`}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium text-paper">
                      {item.name}
                    </p>
                    <p className="font-mono text-xs text-mute">
                      {item.id} · {item.framework}
                    </p>
                  </div>
                </div>
                <span className="whitespace-nowrap font-mono text-xs text-mute">
                  {item.status}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-3 text-center">
            <a
              href="/demos"
              className="font-mono text-xs uppercase tracking-[0.1em] text-signal hover:text-signal/80"
            >
              View the full product tour →
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
