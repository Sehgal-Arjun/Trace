"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

export type Tab = {
  segment: string | null; // null = the run's index route (Report)
  label: string;
  hint?: string;
  hintTone?: "accent" | "pass" | "muted";
  available: boolean;
};

const HINT_COLOR = { accent: "#ff8a7a", pass: "#3fb27f", muted: "#a1a5ae" };

export function RunTabs({ runId, tabs }: { runId: string; tabs: Tab[] }) {
  const segment = useSelectedLayoutSegment();
  const currentIdx = tabs.findIndex((t) => t.segment === segment);

  return (
    <nav className="mt-3 flex gap-0.5 overflow-x-auto [scrollbar-width:none]">
      {tabs.map((t, i) => {
        const current = i === currentIdx;
        const done = t.available && !current;
        const dot = current
          ? "border-fg bg-fg text-bg"
          : done
            ? "border-line-2 bg-line-2 text-fg-3"
            : "border-line-4 text-muted";
        const body = (
          <>
            <span
              className={`flex size-[18px] items-center justify-center rounded-full border font-mono text-[10px] font-semibold ${dot}`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className="font-medium">{t.label}</span>
            {t.hint && t.available && (
              <span className="font-mono text-[11.5px] font-medium" style={{ color: HINT_COLOR[t.hintTone ?? "muted"] }}>
                {t.hint}
              </span>
            )}
          </>
        );
        const cls = `flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 ${
          current ? "border-fg text-fg-strong" : "border-transparent"
        }`;
        return t.available ? (
          <Link
            key={t.label}
            href={`/runs/${runId}${t.segment ? `/${t.segment}` : ""}`}
            className={`${cls} ${current ? "" : done ? "text-fg-3 hover:text-fg-strong" : "text-muted"}`}
          >
            {body}
          </Link>
        ) : (
          <span key={t.label} className={`${cls} cursor-default text-faint`} aria-disabled>
            {body}
          </span>
        );
      })}
    </nav>
  );
}
