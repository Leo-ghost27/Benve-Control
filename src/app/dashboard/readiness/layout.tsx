import { Suspense } from "react";
import { SectionNav } from "@/components/phase2/SectionNav";

const TABS = [
  { href: "/dashboard/readiness", label: "Overview", exact: true },
  { href: "/dashboard/readiness/checklist", label: "Checklist" },
  { href: "/dashboard/readiness/gaps", label: "Gaps" },
  { href: "/dashboard/readiness/roadmap", label: "Roadmap" },
  { href: "/dashboard/readiness/pack", label: "Readiness pack" },
];

export default function ReadinessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl p-8">
      <Suspense fallback={<div className="mb-6 h-10 border-b border-line" />}>
        <SectionNav tabs={TABS} label="Readiness sections" />
      </Suspense>
      {children}
    </div>
  );
}
