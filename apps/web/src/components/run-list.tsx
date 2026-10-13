"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { StatusGlyph } from "@/components/status-glyph";
import { ago } from "@/lib/format";
import { STATUS } from "@/lib/runs/status";
import type { RunStatus } from "@/lib/runs/types";

type Item = { id: string; title: string; status: RunStatus; createdAt: string };

export function RunList({ runs }: { runs: Item[] }) {
  const { id: current } = useParams<{ id?: string }>();

  if (runs.length === 0) {
    return <p className="px-4 py-2 text-xs text-muted">No runs yet.</p>;
  }

  return (
    <nav className="flex flex-1 flex-col gap-px overflow-auto px-2 pb-2">
      {runs.map((r) => {
        const active = r.id === current;
        return (
          <Link
            key={r.id}
            href={`/runs/${r.id}`}
            aria-current={active ? "page" : undefined}
            className={`flex gap-2.5 rounded-[7px] p-2 hover:bg-[#15161a] ${active ? "bg-selected" : ""}`}
          >
            <span className="mt-0.5">
              <StatusGlyph status={r.status} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[13px] ${active ? "text-fg-strong" : "text-fg-2"}`}>{r.title}</span>
              <span className="mt-0.5 flex gap-[7px] text-[11.5px] text-muted">
                <span className="font-mono">{r.id}</span>
                <span style={{ color: STATUS[r.status].text }}>{STATUS[r.status].label}</span>
                <span className="ml-auto">{ago(r.createdAt)}</span>
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
