"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-paper hover:border-mute print:hidden">
      Print / save as PDF
    </button>
  );
}
