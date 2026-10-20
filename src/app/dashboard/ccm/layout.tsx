import { Suspense } from "react";
import { CcmNav } from "@/components/phase2/CcmNav";

export default function CcmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl p-8">
      <Suspense fallback={<div className="mb-6 h-10 border-b border-line" />}>
        <CcmNav />
      </Suspense>
      {children}
    </div>
  );
}
