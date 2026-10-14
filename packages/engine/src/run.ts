import type { Bisect, Commit, Probe, Repo, Report, ReproTest, RootCause, Run } from "@trace/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureInstalled, findCulprit, type SearchResult, type Setup } from "./bisect.ts";
import { investigate, type BugReport, type Finding, type InvestigateResult, type Usage } from "./investigate.ts";
import { DEFAULT_LADDER, type Tier } from "./models.ts";
import { Sandbox } from "./sandbox.ts";
import { git } from "./shell.ts";
import { detectRunner, runTestFile, testCommand } from "./tests.ts";

export type TraceOptions = {
  id: string;
  root: string;
  repo: Repo;
  report: Report;
  /** How many times to rerun the test at HEAD to check it isn't flaky. */
  reruns?: number;
  setup?: Setup;
  /** Models to try in order; the next one runs only if the previous couldn't reproduce the bug. */
  ladder?: Tier[];
  /** Direction from a person, e.g. an "@trace that's not it, …" correction. */
  context?: string;
  /** A run saved partway: if it has an accepted test, skip straight to the history search. */
  resume?: Run;
  /** Called whenever the run reaches a new stage, so it can be saved and shown. */
  onProgress?: (run: Run) => void;
  log?: (line: string) => void;
};

/** Runs the whole pipeline on a disposable checkout and returns the Run record. */
export async function trace(o: TraceOptions): Promise<Run> {
  const log = o.log ?? (() => {});
  const startedAt = new Date().toISOString();
  // A resumed run may find the checkout wherever an interrupted search left it.
  if (o.resume?.commit) {
    git(o.root, "reset", "--hard", "--quiet");
    git(o.root, "clean", "-fdq", "-e", "node_modules", "-e", "**/node_modules");
    git(o.root, "checkout", "--quiet", "--detach", o.resume.commit);
  }
  const sandbox = new Sandbox(o.root);
  const base: Run = { id: o.id, repo: o.repo, commit: sandbox.head, report: o.report, status: "tracing", startedAt };
  const progress = o.onProgress ?? (() => {});

  try {
    const saved = o.resume;
    if (saved?.test?.names?.length && saved.rootCause) {
      log(`resuming with the saved test ${saved.test.file}`);
      const files = new Map([[saved.test.file, saved.test.code], ...(saved.test.fixtures ?? []).map((f) => [f.file, f.code] as [string, string])]);
      return await search({ ...base, ...saved, commit: sandbox.head, status: "bisecting" }, files, saved.test.file, saved.test.names);
    }
    progress(base);
    // Dependencies must match this commit before any test runs; an interrupted search can leave
    // another commit's node_modules behind.
    const installError = await ensureInstalled(sandbox.root, o.setup);
    if (installError) return { ...base, status: "errored", error: installError, finishedAt: new Date().toISOString() };
    log(`investigating at ${sandbox.head.slice(0, 9)}`);
    const bug: BugReport = { title: o.report.title, body: o.report.body };
    const usage: Usage[] = [];
    let inv: InvestigateResult | undefined;
    for (const tier of o.ladder ?? DEFAULT_LADDER) {
      sandbox.cleanup();
      log(`trying ${tier.model} (effort ${tier.effort}, up to $${tier.budgetUsd.toFixed(2)})`);
      inv = await investigate(sandbox, bug, tier, { context: o.context, onEvent: (e) => log(`  ${e}`) });
      usage.push(inv.usage);
      log(`  ${inv.usage.requests} requests, ${inv.usage.inputTokens} in / ${inv.usage.outputTokens} out tokens, $${inv.usage.costUsd.toFixed(3)}`);
      if (inv.ok) break;
      log(`  ${inv.reason}`);
    }
    base.usage = usage;
    if (!inv?.ok) return { ...base, status: "not_reproduced", error: inv?.reason ?? "no models to try", finishedAt: new Date().toISOString() };
    const f = inv.finding;

    // The test has to fail every time, not just once.
    const reruns = o.reruns ?? 10;
    let failed = 0;
    for (let i = 0; i < reruns; i++) {
      const r = await runTestFile(sandbox.root, f.testFile, { names: f.testNames, timeoutSec: 300 });
      if (r.cases.some((c) => c.status === "failed" && c.assertion)) failed++;
    }
    log(`test failed ${failed} of ${reruns} reruns`);
    const test = reproTest(sandbox, f, { total: reruns, failed });
    const rootCause = rootCauseOf(sandbox.root, f);
    if (failed < reruns) {
      return { ...base, status: "not_reproduced", rootCause, test, error: `The test is flaky: it failed ${failed} of ${reruns} runs.`, finishedAt: new Date().toISOString() };
    }

    return await search({ ...base, status: "bisecting", rootCause, test }, f.files, f.testFile, f.testNames);
  } catch (e) {
    return { ...base, status: "errored", error: (e as Error).message, finishedAt: new Date().toISOString() };
  } finally {
    sandbox.cleanup();
  }

  async function search(run: Run, files: Map<string, string>, testFile: string, testNames: string[]): Promise<Run> {
    progress(run);
    log("searching history");
    const s = await findCulprit({ root: sandbox.root, start: sandbox.head, files, testFile, testNames, setup: o.setup, log: (l) => log(`  ${l}`) });
    const finishedAt = new Date().toISOString();
    if (s.status === "found") return { ...run, status: "culprit_found", bisect: bisectOf(sandbox.root, s, o.repo), finishedAt };
    if (s.status === "not-regression") return { ...run, status: "not_regression", finishedAt };
    return { ...run, status: "errored", error: s.reason, finishedAt };
  }
}

function reproTest(sandbox: Sandbox, f: Finding, runs: { total: number; failed: number }): ReproTest {
  const runner = detectRunner(sandbox.root, f.testFile)?.runner ?? "vitest";
  const fixtures = [...f.files].filter(([p]) => p !== f.testFile).map(([file, code]) => ({ file, code }));
  return {
    file: f.testFile,
    code: f.files.get(f.testFile) ?? "",
    names: f.testNames,
    runner,
    command: testCommand(sandbox.root, f.testFile) ?? `npx ${runner} ${f.testFile}`,
    ...(fixtures.length ? { fixtures } : {}),
    runs,
    output: f.headRun.cases
      .filter((c) => c.status === "failed")
      .map((c) => `FAIL ${c.name}\n${c.message ?? ""}`)
      .join("\n\n")
      .slice(0, 4000),
  };
}

function rootCauseOf(root: string, f: Finding): RootCause {
  const { file, line, symbol, summary } = f.rootCause;
  let snippet: RootCause["snippet"];
  try {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    const startLine = Math.max(1, line - 4);
    snippet = { startLine, code: lines.slice(startLine - 1, line + 4).join("\n"), highlightLine: line };
  } catch {
    // The file may not exist where the model said; the summary still stands.
  }
  return { symbol, file, line, summary, path: f.path, ...(snippet ? { snippet } : {}) };
}

function commitOf(root: string, sha: string, repo: Repo): Commit {
  const [full, author, email, date, subject] = git(root, "show", "-s", "--format=%H%n%an%n%ae%n%aI%n%s", sha).split("\n");
  const pr = subject.match(/\(#(\d+)\)\s*$/);
  return { sha: full, subject: subject.trim(), author, email, date, ...(pr ? { pr: { number: Number(pr[1]), title: subject.replace(/\s*\(#\d+\)\s*$/, "").trim(), url: `https://github.com/${repo.owner}/${repo.name}/pull/${pr[1]}` } } : {}) };
}

function bisectOf(root: string, s: Extract<SearchResult, { status: "found" }>, repo: Repo): Bisect {
  const probes: Probe[] = s.probes.map((p) => ({ commit: commitOf(root, p.sha, repo), outcome: p.outcome, seconds: p.seconds, index: p.index, ...(p.reason ? { reason: p.reason } : {}) }));
  // Source changes first: that's where the bug came in. Tests the commit updated come after.
  const isTest = (row: string) => /(\.|_)(test|spec)\.|__tests__\//.test(row);
  const stat = git(root, "show", "--numstat", "--format=", s.culprit)
    .split("\n")
    .filter(Boolean)
    .sort((a, b) => Number(isTest(a)) - Number(isTest(b)));
  const diff = stat.slice(0, 8).map((row) => {
    const [add, del, file] = row.split("\t");
    const patch = git(root, "show", "--format=", "--unified=3", s.culprit, "--", file);
    return { file, additions: Number(add) || 0, deletions: Number(del) || 0, patch: patch.split("\n").slice(4, 80).join("\n") };
  });
  return { culprit: commitOf(root, s.culprit, repo), lastGood: commitOf(root, s.lastGood, repo), commitsSearched: s.commitsSearched, probes, seconds: s.seconds, diff };
}
