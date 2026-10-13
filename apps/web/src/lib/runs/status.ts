import type { RunStatus } from "@trace/core";

type StatusStyle = {
  label: string;
  /** Ring around the status glyph. */
  ring: string;
  /** Fill inside the ring: a solid color, or a pie showing how far along the run is. */
  fill: string;
  text: string;
  /** Still working, as opposed to finished one way or another. */
  active: boolean;
};

const pie = (color: string, pct: number) => `conic-gradient(${color} 0 ${pct}%, transparent 0) content-box`;

export const STATUS: Record<RunStatus, StatusStyle> = {
  queued: { label: "Queued", ring: "1.5px dashed #6b707a", fill: "transparent", text: "#8a8f98", active: true },
  tracing: { label: "Tracing", ring: "1.5px solid #8a8f98", fill: pie("#8a8f98", 25), text: "#a1a5ae", active: true },
  testing: { label: "Writing test", ring: "1.5px solid #a1a5ae", fill: pie("#a1a5ae", 50), text: "#a1a5ae", active: true },
  bisecting: { label: "Searching history", ring: "1.5px solid #c9ccd3", fill: pie("#c9ccd3", 75), text: "#c9ccd3", active: true },
  culprit_found: { label: "Culprit found", ring: "1.5px solid #ff5f4a", fill: "#ff5f4a content-box", text: "#ff8a7a", active: false },
  pr_opened: { label: "PR opened", ring: "1.5px solid #3fb27f", fill: "#3fb27f content-box", text: "#3fb27f", active: false },
  not_regression: { label: "Not a regression", ring: "1.5px solid #a1a5ae", fill: "#a1a5ae content-box", text: "#a1a5ae", active: false },
  not_reproduced: { label: "Couldn't reproduce", ring: "1.5px solid #6b707a", fill: "transparent", text: "#7d828c", active: false },
  errored: { label: "Errored", ring: "1.5px solid #ff8a7a", fill: "transparent", text: "#ff8a7a", active: false },
};
