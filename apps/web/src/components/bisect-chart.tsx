"use client";

import { useState } from "react";
import type { SearchStep } from "@/lib/runs/bisect";

const PASS = "#3fb27f";
const FAIL = "#ff5f4a";
const SKIP = "#6b707a";
const MIN_SPAN = 14;

/**
 * The history search drawn as one row per step: the window of commits still in
 * doubt, and where the test ran. Oldest history is on the left, the commit the
 * search started from on the right.
 */
export function BisectChart({
  steps,
  far,
  culpritIndex,
  culpritLabel,
}: {
  steps: SearchStep[];
  /** Index of the oldest commit in range (0 = where the search started). */
  far: number;
  culpritIndex: number;
  culpritLabel: string;
}) {
  // View window in "commits from the oldest" coordinates: 0 = oldest, far = newest.
  const full: [number, number] = [-far * 0.01, far * 1.01];
  const around: [number, number] = [far - culpritIndex - MIN_SPAN, far - culpritIndex + MIN_SPAN];
  const [view, setView] = useState<[number, number]>(full);

  const [v0, v1] = view;
  const span = v1 - v0;
  const x = (index: number) => ((far - index - v0) / span) * 100;
  const zoom = (k: number) => {
    const c = (v0 + v1) / 2;
    const s = Math.min(Math.max(span * k, MIN_SPAN), full[1] - full[0]);
    setView([c - s / 2, c + s / 2]);
  };
  const presets: [string, [number, number]][] = [
    ["All history", full],
    ["Around culprit", around],
  ];
  const cx = x(culpritIndex);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="flex rounded-[7px] border border-line-3 bg-field p-0.5">
          {presets.map(([label, v]) => {
            const on = Math.abs(v[0] - v0) < 0.5 && Math.abs(v[1] - v1) < 0.5;
            return (
              <button
                key={label}
                onClick={() => setView(v)}
                className={`h-6 rounded-[5px] px-2.5 text-xs font-medium whitespace-nowrap ${on ? "bg-line-3 text-fg-strong" : "text-[#8a8f98]"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1">
          <ZoomButton label="Zoom out" onClick={() => zoom(2)}>
            −
          </ZoomButton>
          <ZoomButton label="Zoom in" onClick={() => zoom(0.5)}>
            +
          </ZoomButton>
        </div>
        <div className="ml-auto flex flex-wrap gap-3.5 text-[11.5px] text-fg-3">
          <Legend color={PASS}>Test passes</Legend>
          <Legend color={FAIL}>Test fails</Legend>
          <Legend color={SKIP}>Couldn&apos;t run</Legend>
        </div>
      </div>

      <div className="relative px-4 pt-7 select-none">
        {cx >= -1 && cx <= 101 && (
          <div className="pointer-events-none absolute top-0 right-4 bottom-0 left-20">
            <div
              className="absolute top-6 bottom-0 w-[1.5px] bg-accent shadow-[0_0_10px_rgb(255_95_74/0.55)]"
              style={{ left: `${cx}%` }}
            />
            <div
              className="absolute top-1 rounded bg-accent px-2 py-0.5 font-mono text-[11px] leading-4 font-semibold whitespace-nowrap text-bg"
              style={{ left: `${cx}%`, transform: cx > 62 ? "translateX(calc(-100% + 1px))" : "translateX(-1px)" }}
            >
              {culpritLabel}
            </div>
          </div>
        )}

        {steps.map((s, k) => {
          const px = x(s.probe.index);
          const color = s.probe.outcome === "pass" ? PASS : s.probe.outcome === "fail" ? FAIL : SKIP;
          const left = px > 30;
          return (
            <div key={k} className="flex h-[26px]">
              <div className="w-16 flex-none font-mono text-[11px] leading-[26px] text-faint">
                Step {String(k + 1).padStart(2, "0")}
              </div>
              <div className="relative h-full flex-1 overflow-hidden">
                <div
                  className="absolute top-3 h-0.5 bg-[#3a3e47]"
                  style={{ left: `${x(s.good)}%`, width: `${x(s.bad) - x(s.good)}%` }}
                />
                <div
                  className="absolute top-[13px] -mt-[5px] -ml-[5px] size-2.5 rounded-full"
                  style={{
                    left: `${px}%`,
                    background: color,
                    boxShadow: s.isCulprit ? "0 0 0 3px rgb(255 95 74 / .25), 0 0 12px rgb(255 95 74 / .7)" : undefined,
                  }}
                />
                <span
                  className="absolute top-[5px] font-mono text-[11px] leading-4 font-medium whitespace-nowrap"
                  style={{
                    color: s.isCulprit ? "#ff8a7a" : s.probe.outcome === "pass" ? "#8fcfb0" : "#c9ccd3",
                    ...(left ? { right: `calc(${100 - px}% + 10px)` } : { left: `calc(${px}% + 10px)` }),
                  }}
                >
                  {s.probe.commit.sha.slice(0, 7)} {s.probe.outcome}
                  {s.isCulprit ? " · culprit" : ""}
                </span>
              </div>
            </div>
          );
        })}
        <div className="h-3" />
      </div>
    </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="size-7 rounded-md border border-line-4 bg-raised text-[15px] leading-none text-fg-2 hover:bg-hover"
    >
      {children}
    </button>
  );
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}
