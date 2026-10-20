import Link from "next/link";
import type { Period } from "@/lib/phase2/context";

export const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
export const cardClass = "rounded-xl border border-line bg-ink p-6";
export const primaryBtn =
  "rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90 disabled:opacity-50";
export const secondaryBtn =
  "rounded-md border border-line px-3 py-1.5 text-xs font-medium text-paper transition-colors hover:border-mute";
export const labelClass = "mb-1 block text-xs font-medium text-mute";

export function label(value: string | null | undefined) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

export function fmtDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

const STATUS_TONES: Record<string, string> = {
  active: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  approved: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  closed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  validated: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  open: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  in_review: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  in_investigation: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  in_progress: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  pending_approval: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  partially_valid: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  submitted: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  prepared: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  linked: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  requested: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  overdue: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  returned: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  rejected: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  invalid: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  critical: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  high: "border-orange-400/40 bg-orange-400/10 text-orange-300",
  medium: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  low: "border-line text-mute",
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-mute">—</span>;
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONES[value] ?? "border-line text-mute"}`}>
      {label(value)}
    </span>
  );
}

export function Banner({ notice, error }: { notice?: string; error?: string }) {
  if (!notice && !error) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-5 rounded-md border px-4 py-3 text-sm ${
        error ? "border-rose-900/60 bg-rose-950/30 text-rose-300" : "border-emerald-900/60 bg-emerald-950/30 text-emerald-300"
      }`}
    >
      {error ?? notice}
    </div>
  );
}

export function PermissionDenied({ message }: { message?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-xl border border-amber-900/50 bg-amber-950/20 px-6 py-16 text-center">
      <p className="text-sm font-semibold text-amber-300">Not available for your role</p>
      <p className="mt-1.5 max-w-md text-sm text-mute">
        {message ?? "Your role doesn't have access to this view. Ask an owner or admin if you believe this is a mistake."}
      </p>
    </div>
  );
}

export function LastUpdated({ at }: { at: string | null | undefined }) {
  return <p className="text-[11px] text-mute">Last updated: {at ? fmtDateTime(at) : "no records yet"}</p>;
}

/** Period selector as a plain GET form (works without client JS). Keeps other filters. */
export function PeriodBar({
  periods,
  current,
  keep = {},
  action,
}: {
  periods: Period[];
  current: Period | null;
  keep?: Record<string, string | undefined>;
  action: string;
}) {
  return (
    <form method="get" action={action} className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-panel px-4 py-3">
      {Object.entries(keep).map(([k, v]) => v && k !== "period" ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <div>
        <span className={labelClass}>Reporting period</span>
        <select name="period" defaultValue={current?.id ?? ""} className={`${inputClass} min-w-[12rem]`} aria-label="Reporting period">
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.start_date} → {p.end_date}){p.status === "closed" ? " · closed" : ""}
            </option>
          ))}
        </select>
      </div>
      <button className={secondaryBtn} type="submit">Switch period</button>
      {current && <p className="ml-auto text-xs text-mute">Showing {current.label}</p>}
    </form>
  );
}

export function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

export function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">{eyebrow}</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-mute">{subtitle}</p>}
    </div>
  );
}

export function KpiLink({ href, value, label: text, tone }: { href: string; value: number; label: string; tone?: "warn" | "crit" }) {
  const color = tone === "crit" ? "text-rose-400" : tone === "warn" ? "text-amber-400" : "text-paper";
  return (
    <Link href={href} className="rounded-xl border border-line bg-panel p-5 transition-colors hover:border-mute">
      <p className={`text-3xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-mute">{text} →</p>
    </Link>
  );
}
