"use client";

import { useState } from "react";

export function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const fullUrl = `${window.location.origin}${path}`;
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md border border-line px-3 py-2 text-xs font-medium text-paper transition-colors hover:border-mute"
    >
      {copied ? "Copied!" : "Copy Link"}
    </button>
  );
}
