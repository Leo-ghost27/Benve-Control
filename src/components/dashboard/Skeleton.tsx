export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-line/50 ${className}`}
      aria-hidden="true"
    />
  );
}
