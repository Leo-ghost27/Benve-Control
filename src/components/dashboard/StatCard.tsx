type StatCardProps = {
  label: string;
  value: number;
  hint?: string;
  tone?: "default" | "warning" | "critical";
};

const toneStyles: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-paper",
  warning: "text-amber-400",
  critical: "text-rose-400",
};

export function StatCard({ label, value, hint, tone = "default" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-mute">
        {label}
      </p>
      <p className={`mt-3 text-3xl font-bold tabular-nums ${toneStyles[tone]}`}>
        {value.toLocaleString()}
      </p>
      {hint && <p className="mt-1 text-xs text-mute">{hint}</p>}
    </div>
  );
}
