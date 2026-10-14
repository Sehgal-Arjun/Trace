import type { Bisect, Probe } from "./types";

/**
 * One row of the history search: the window of commits still in doubt before
 * this probe, and where the probe landed.
 *
 * Positions are first-parent indexes: 0 is the commit the search started from
 * (newest), larger numbers are further in the past.
 */
export type SearchStep = {
  probe: Probe;
  /** Newest commit known to fail before this probe. */
  bad: number;
  /** Newest commit known to pass before this probe, or the far edge of history if none yet. */
  good: number;
  isCulprit: boolean;
};

export function searchSteps(b: Bisect): SearchStep[] {
  const far = Math.max(b.commitsSearched, ...b.probes.map((p) => p.index));
  let bad = 0;
  let good = far;
  const steps: SearchStep[] = [];
  for (const probe of b.probes) {
    if (probe.index === 0 && probe.outcome === "fail") continue; // the starting point, not a search step
    steps.push({ probe, bad, good, isCulprit: probe.commit.sha === b.culprit.sha });
    if (probe.outcome === "pass") good = Math.min(good, probe.index);
    else if (probe.outcome === "fail") bad = Math.max(bad, probe.index);
  }
  return steps;
}

/** Commits skipped without running the test: everything in range minus what we actually ran. */
export function commitsSkipped(b: Bisect): number {
  return Math.max(0, b.commitsSearched - b.probes.length);
}
