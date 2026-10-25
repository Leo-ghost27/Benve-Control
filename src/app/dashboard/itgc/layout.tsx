import { Suspense } from "react";
import { SectionNav } from "@/components/phase2/SectionNav";

const TABS = [
  { href: "/dashboard/itgc", label: "Coverage", exact: true },
  { href: "/dashboard/itgc/systems", label: "Systems" },
  { href: "/dashboard/itgc/controls", label: "ITGC controls" },
  { href: "/dashboard/itgc/automated-controls", label: "Automated controls" },
  { href: "/dashboard/itgc/exceptions", label: "Exception review" },
];

export default function ItgcLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl p-8">
      <Suspense fallback={<div className="mb-6 h-10 border-b border-line" />}>
        <SectionNav tabs={TABS} label="ITGC sections" carry={[]} />
      </Suspense>
      {children}
    </div>
  );
}
