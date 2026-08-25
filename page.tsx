import { getSupabaseClient } from "@/lib/supabase/client";

type ControlRow = {
  control_id: string;
  framework: string;
  name: string;
  status: string;
};

// Shown if Supabase isn't configured yet, or the query fails,
// so the page never breaks for a visitor.
const fallbackLedger: ControlRow[] = [
  { control_id: "CTRL-014", framework: "SOX 404", name: "Access review", status: "Cleared" },
  { control_id: "CTRL-021", framework: "ICFR", name: "Change management", status: "In review" },
  { control_id: "CTRL-032", framework: "OCC", name: "Third-party risk", status: "Cleared" },
  { control_id: "CTRL-045", framework: "SOX 404", name: "Segregation of duties", status: "Scheduled" },
];

async function getLedger(): Promise<ControlRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return fallbackLedger;

  const { data, error } = await supabase
    .from("controls")
    .select("control_id, framework, name, status")
    .order("control_id", { ascending: true });

  if (error || !data || data.length === 0) return fallbackLedger;
  return data as ControlRow[];
}

const statusStyles: Record<string, string> = {
  Cleared: "bg-emerald-400",
  "In review": "bg-amber-400",
  Scheduled: "bg-mute",
};

export default async function Home() {
  const ledger = await getLedger();

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-20 md:py-28 lg:flex-row lg:items-center lg:gap-12">
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
              href="#ledger"
              className="rounded-md bg-signal px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
            >
              View a sample control
            </a>
            <a
              href="mailto:hello@benvecontrol.com"
              className="rounded-md border border-line px-5 py-3 text-sm font-semibold text-paper transition-colors hover:border-signal"
            >
              Talk to us
            </a>
          </div>
        </div>

        {/* Signature element: control ledger, pulled from Supabase */}
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
                key={item.control_id}
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      statusStyles[item.status] ?? "bg-mute"
                    }`}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium text-paper">
                      {item.name}
                    </p>
                    <p className="font-mono text-xs text-mute">
                      {item.control_id} · {item.framework}
                    </p>
                  </div>
                </div>
                <span className="whitespace-nowrap font-mono text-xs text-mute">
                  {item.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
