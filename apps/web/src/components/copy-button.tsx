"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="h-[26px] flex-none rounded-md border border-line-4 bg-raised px-2.5 text-xs text-fg-2 hover:bg-hover"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
