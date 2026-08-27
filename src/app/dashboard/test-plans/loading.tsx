import { Skeleton } from "@/components/dashboard/Skeleton";

export default function TestPlansLoading() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="mt-2 h-4 w-52" />
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="space-y-px bg-line/30">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 bg-ink px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
