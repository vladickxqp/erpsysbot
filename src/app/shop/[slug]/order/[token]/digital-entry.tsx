"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** One delivered entry (a code, an account) with a button to copy it. */
export function DigitalEntry({ text, copyLabel }: { text: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md bg-slate-100 px-3 py-2 font-mono text-sm">{text}</code>
      <button
        type="button"
        aria-label={copyLabel}
        title={copyLabel}
        className="grid size-9 shrink-0 place-items-center rounded-md border border-[var(--site-border)] hover:bg-[var(--site-soft)]"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
