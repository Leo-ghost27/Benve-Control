"use client";

export default function CcmError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-900/50 bg-rose-950/20 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-rose-400">Couldn&apos;t load Continuous Controls Monitoring</p>
      <p className="mt-1.5 text-sm text-mute">{error.message}</p>
      <button onClick={reset} className="mt-4 rounded-md border border-line px-4 py-2 text-sm text-paper hover:border-mute">
        Try again
      </button>
    </div>
  );
}
