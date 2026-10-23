export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 rounded bg-panel" />
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-panel" />)}
      </div>
      <div className="h-64 rounded-xl bg-panel" />
    </div>
  );
}
