import type { Bisect, Commit, Probe, Repo, Report, ReproTest, RootCause, Run } from "@trace/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findCulprit, type SearchResult } from "./bisect.ts";
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
  install?: string;
  /** Models to try in order; the next one runs only if the previous couldn't reproduce the bug. */
  ladder?: Tier[];
  /** Direction from a person, e.g. an "@trace that's not it, …" correction. */
  context?: string;
  log?: (line: string) => void;
};

/** Runs the whole pipeline on a disposable checkout and returns the Run record. */
export async function trace(o: TraceOptions): Promise<Run> {
  const log = o.log ?? (() => {});
  const startedAt = new Date().toISOString();
  const sandbox = new Sandbox(o.root);
  const base: Run = { id: o.id, repo: o.repo, report: o.report, status: "tracing", startedAt };

  try {
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

    log("searching history");
    const search = await findCulprit({
      root: sandbox.root,
      start: sandbox.head,
      files: f.files,
      testFile: f.testFile,
      testNames: f.testNames,
      install: o.install,
      log: (l) => log(`  ${l}`),
    });
    const finishedAt = new Date().toISOString();
    if (search.status === "found") {
      return { ...base, status: "culprit_found", rootCause, test, bisect: bisectOf(sandbox.root, search), finishedAt };
    }
    if (search.status === "not-regression") return { ...base, status: "not_regression", rootCause, test, finishedAt };
    return { ...base, status: "errored", rootCause, test, error: search.reason, finishedAt };
  } catch (e) {
    return { ...base, status: "errored", error: (e as Error).message, finishedAt: new Date().toISOString() };
  } finally {
    sandbox.cleanup();
  }
}

function reproTest(sandbox: Sandbox, f: Finding, runs: { total: number; failed: number }): ReproTest {
  const runner = detectRunner(sandbox.root, f.testFile)?.runner ?? "vitest";
  const fixtures = [...f.files].filter(([p]) => p !== f.testFile).map(([file, code]) => ({ file, code }));
  return {
    file: f.testFile,
    code: f.files.get(f.testFile) ?? "",
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

function commitOf(root: string, sha: string): Commit {
  const [full, author, email, date, subject] = git(root, "show", "-s", "--format=%H%n%an%n%ae%n%aI%n%s", sha).split("\n");
  const pr = subject.match(/\(#(\d+)\)\s*$/);
  return { sha: full, subject: subject.trim(), author, email, date, ...(pr ? { pr: { number: Number(pr[1]), title: subject.replace(/\s*\(#\d+\)\s*$/, "").trim(), url: "" } } : {}) };
}

function bisectOf(root: string, s: Extract<SearchResult, { status: "found" }>): Bisect {
  const probes: Probe[] = s.probes.map((p) => ({ commit: commitOf(root, p.sha), outcome: p.outcome, seconds: p.seconds, index: p.index, ...(p.reason ? { reason: p.reason } : {}) }));
  const stat = git(root, "show", "--numstat", "--format=", s.culprit).split("\n").filter(Boolean);
  const diff = stat.slice(0, 8).map((row) => {
    const [add, del, file] = row.split("\t");
    const patch = git(root, "show", "--format=", "--unified=3", s.culprit, "--", file);
    return { file, additions: Number(add) || 0, deletions: Number(del) || 0, patch: patch.split("\n").slice(4, 80).join("\n") };
  });
  return { culprit: commitOf(root, s.culprit), lastGood: commitOf(root, s.lastGood), commitsSearched: s.commitsSearched, probes, seconds: s.seconds, diff };
}
