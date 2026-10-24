"use client";

import { Suspense } from "react";
import { SectionNav } from "@/components/phase2/SectionNav";

const TABS = [
  { href: "/dashboard/entities", label: "Entities" },
  { href: "/dashboard/subsidiary-questionnaires", label: "Subsidiary questionnaires" },
  { href: "/dashboard/group-icfr", label: "Group ICFR roll-up" },
];

export function GroupNav() {
  return (
    <Suspense fallback={<div className="mb-6 h-10 border-b border-line" />}>
      <SectionNav tabs={TABS} label="Group ICFR sections" carry={["period"]} />
    </Suspense>
  );
}
