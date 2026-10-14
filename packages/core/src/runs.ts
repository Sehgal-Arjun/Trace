// A Run is one bug Trace investigated, from the report it started with to the
// pull request it opened. Each stage is filled in as the pipeline gets there.

export type RunStatus =
  | "queued"
  | "tracing" // looking for the root cause
  | "testing" // writing and confirming the failing test
  | "bisecting" // searching history for the culprit commit
  | "culprit_found"
  | "pr_opened"
  // Terminal outcomes where Trace couldn't finish the whole story.
  | "not_regression" // test fails as far back as we can run it
  | "not_reproduced" // couldn't write a test that fails at HEAD
  | "errored";

export type Repo = {
  owner: string;
  name: string;
  defaultBranch: string;
  language?: string;
  testRunner?: "vitest" | "jest";
};

export type ReportSource =
  | { kind: "linear"; issueId: string; url: string }
  | { kind: "github"; issueNumber: number; url: string }
  | { kind: "manual" };

export type Attachment = {
  kind: "image" | "video" | "har" | "log" | "link";
  name: string;
  url: string;
  meta?: string; // e.g. "0:42 · 1920×1080"
};

export type Report = {
  title: string;
  body: string; // what the reporter wrote, untouched
  reporter?: string;
  source: ReportSource;
  attachments: Attachment[];
  createdAt: string;
};

/** One step from the user-visible symptom back toward the root cause. */
export type TraceHop = {
  layer: "ui" | "client" | "network" | "server" | "data";
  title: string; // e.g. "saveCart(cart)"
  location: string; // file:line, or "200 · 142 ms" for network hops
  value?: string; // the tracked value at this hop, e.g. "total 71.40"
  details?: { key: string; value: string; wrong?: boolean }[];
};

export type RootCause = {
  symbol: string; // e.g. "applyDiscount(cart, discount)"
  file: string;
  line: number;
  summary: string; // one or two sentences, plain language
  snippet?: { startLine: number; code: string; highlightLine?: number; note?: string };
  path: TraceHop[];
  downstream?: { title: string; note: string }[];
};

export type ReproTest = {
  file: string;
  code: string;
  /** Full names of the tests in the file that reproduce the bug. */
  names?: string[];
  runner: "vitest" | "jest";
  command: string;
  fixtures?: { file: string; code: string; note?: string }[];
  runs: { total: number; failed: number };
  output: string; // runner output from a failing run at HEAD
};

export type Commit = {
  sha: string;
  subject: string;
  author: string;
  email?: string;
  date: string;
  pr?: { number: number; title: string; url: string };
};

export type ProbeOutcome = "pass" | "fail" | "skip";

/** A single test run at one commit during the history search. */
export type Probe = {
  commit: Commit;
  outcome: ProbeOutcome;
  seconds: number;
  /** Position in first-parent history, 0 = the commit the search started from. */
  index: number;
  reason?: string; // for skips: why the test couldn't run there
};

export type Bisect = {
  culprit: Commit;
  lastGood: Commit;
  /** Commits on first-parent history between lastGood and the starting commit. */
  commitsSearched: number;
  probes: Probe[];
  seconds: number;
  diff?: { file: string; additions: number; deletions: number; patch: string }[];
  whyMissed?: string; // why CI didn't catch it, when we can tell
};

export type PullRequest = {
  number: number;
  url: string;
  title: string;
  branch: string;
  state: "open" | "merged" | "closed";
  openedAt: string;
  reviewers: { name: string; reason: string }[];
};

/** One pass of the pipeline over a run. A run's top-level fields describe the latest attempt. */
export type Attempt = {
  n: number;
  trigger:
    | { kind: "initial" }
    | { kind: "ticket_changed"; reason: string }
    | { kind: "command"; by: string; context?: string }
    | { kind: "button"; by: string };
  /** The report as it read when this attempt started. */
  report: Pick<Report, "title" | "body">;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  /** e.g. "culprit 2c3e2a3, pushed to #1497" or "couldn't reproduce". */
  summary?: string;
};

export type Run = {
  id: string; // short human id, e.g. "BUG-218"
  repo: Repo;
  /** The commit Trace investigated: where the report was filed. */
  commit?: string;
  status: RunStatus;
  report: Report;
  rootCause?: RootCause;
  test?: ReproTest;
  bisect?: Bisect;
  pr?: PullRequest;
  error?: string;
  /** Model spend for the latest attempt, one entry per model tried. */
  usage?: { model: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number }[];
  /** Earlier and current attempts, oldest first. */
  attempts?: Attempt[];
  startedAt?: string;
  finishedAt?: string;
};
