"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type HeaderPeriod = { id: string; label: string; status: string };

/** Reporting-period selector for the header. Sets ?period=<id>; pages read it server-side. */
export function HeaderPeriodSelect({ periods }: { periods: HeaderPeriod[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  if (periods.length === 0) return null;
  const current = sp.get("period") ?? periods[0].id;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="header-period" className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">Period</label>
      <select
        id="header-period"
        value={periods.some((p) => p.id === current) ? current : periods[0].id}
        onChange={(e) => {
          const next = new URLSearchParams(sp.toString());
          next.set("period", e.target.value);
          next.delete("notice");
          next.delete("error");
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="rounded-md border border-line bg-panel px-2 py-1.5 text-xs text-paper focus:outline-none focus:ring-1 focus:ring-signal"
      >
        {periods.map((p) => (
          <option key={p.id} value={p.id}>{p.label}{p.status === "closed" ? " · closed" : ""}</option>
        ))}
      </select>
    </div>
  );
}
