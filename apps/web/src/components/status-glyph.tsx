import { STATUS } from "@/lib/runs/status";
import type { RunStatus } from "@trace/core";

export function StatusGlyph({ status, size = 13 }: { status: RunStatus; size?: number }) {
  const s = STATUS[status];
  return (
    <span
      aria-hidden
      className="inline-block flex-none rounded-full"
      style={{ width: size, height: size, border: s.ring, padding: size > 12 ? 2 : 1.5, background: s.fill }}
    />
  );
}

export function StatusPill({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-line-3 pr-[9px] pl-[7px] text-xs"
      style={{ color: s.text }}
    >
      <StatusGlyph status={status} size={11} />
      {s.label}
    </span>
  );
}
