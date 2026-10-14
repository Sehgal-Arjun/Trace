// Runs one eval case end to end and scores Trace against the maintainers' own fix.
//
//   1. Ground truth: the fix PR's tests pass at the fix and fail just before it; the history
//      search with those tests finds the commit that introduced the bug.
//   2. Trace: the engine starts at the commit before the fix with only the non-technical report.
//   3. Score: did Trace find the same culprit, and does Trace's test pass once the real fix is in?
//
// Usage: node bench/eval/case.ts --id owner/repo#123 [--work bench/.cache] [--out bench/data/eval] [--checkout <dir>]
// --checkout reuses an existing clone of the case's repo instead of cloning one under --work.
// --scripts lets packages run install scripts; use it on throwaway machines (CI), not locally.
// Per-repo setup (build or codegen steps the tests need) comes from recipes.json.
// Writes <out>/<slug>.json (scores) and <out>/<slug>.run.json (the engine's Run).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Run } from "@trace/core";
import { DEFAULT_LADDER, ensureInstalled, findCulprit, git, runTestFile, trace, tryGit, type SearchResult, type Setup } from "@trace/engine";

const HERE = dirname(fileURLToPath(import.meta.url));
const envFile = join(HERE, "..", "..", "packages", "engine", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

type Case = {
  id: string;
  repo: string;
  fix: { pr: number; commit: string; testFiles: string[] };
  confidence: string;
  report: { title: string; body: string };
};

export type Truth =
  | { status: "invalid"; reason: string; diagnostics?: string[] }
  | { status: "found"; culprit: string; subject: string; testFile: string; testNames: string[]; searchSeconds: number }
  | { status: "not-regression" | "inconclusive"; reason?: string; testFile: string; testNames: string[] };

export type CaseResult = {
  id: string;
  repo: string;
  confidence: string;
  truth: Truth;
  trace?: {
    status: Run["status"];
    error?: string;
    culprit?: string;
    rootCause?: string;
    costUsd: number;
    models: string[];
    seconds: number;
  };
  score?: {
    /** Trace's test failed at the reported commit (it reproduced the bug). */
    reproduced: boolean;
    /** Trace's test passes with the maintainers' fix applied: it tests this bug. */
    passesWithFix: boolean | null;
    /** Trace named the same culprit commit as the maintainers' test. */
    culpritMatches: boolean | null;
  };
  seconds: number;
};

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    work: { type: "string", default: join(HERE, "..", ".cache") },
    out: { type: "string", default: join(HERE, "..", "data", "eval") },
    checkout: { type: "string" },
    scripts: { type: "boolean", default: false },
    // Caps the last (most expensive) model in the ladder, to bound what a whole eval can cost.
    "max-budget": { type: "string" },
  },
});
const maxBudget = values["max-budget"] ? Number(values["max-budget"]) : undefined;
const ladder = DEFAULT_LADDER.map((t) => (maxBudget !== undefined ? { ...t, budgetUsd: Math.min(t.budgetUsd, maxBudget) } : t));
if (!values.id) {
  console.error("usage: node bench/eval/case.ts --id owner/repo#123");
  process.exit(2);
}

const cases = readFileSync(join(HERE, "cases.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Case);
const c = cases.find((x) => x.id === values.id);
if (!c) throw new Error(`no case ${values.id} in cases.jsonl`);

const recipes = JSON.parse(readFileSync(join(HERE, "recipes.json"), "utf8")) as Record<string, Setup & { note?: string; skip?: boolean }>;
const { note: _note, skip: _skip, ...recipe } = recipes[c.repo] ?? {};
const setup: Setup = { scripts: values.scripts, ...recipe };

const slug = c.id.replace(/[/#]/g, "__");
const outDir = resolve(values.out!);
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const log = (l: string) => console.log(`[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] ${l}`);
const result: CaseResult = { id: c.id, repo: c.repo, confidence: c.confidence, truth: { status: "invalid", reason: "not run" }, seconds: 0 };
const save = () => {
  result.seconds = Math.round((Date.now() - t0) / 1000);
  writeFileSync(join(outDir, `${slug}.json`), JSON.stringify(result, null, 2));
};

try {
  const root = checkoutOf(c.repo);
  const fix = c.fix.commit;
  const pre = git(root, "rev-parse", `${fix}^1`);
  log(`${c.id}: fix ${fix.slice(0, 9)}, reported at ${pre.slice(0, 9)}`);

  result.truth = await groundTruth(root, pre, fix);
  log(`ground truth: ${describeTruth(result.truth)}`);
  save();
  if (result.truth.status === "invalid") process.exit(0);

  // Trace starts from a clean checkout at the reported commit, knowing only the report.
  reset(root, pre);
  const t1 = Date.now();
  const run = await trace({
    id: c.id,
    root,
    repo: { owner: c.repo.split("/")[0], name: c.repo.split("/")[1], defaultBranch: "main" },
    report: { title: c.report.title, body: c.report.body, source: { kind: "manual" }, attachments: [], createdAt: new Date().toISOString() },
    setup,
    ladder,
    log: (l) => log(`trace: ${l}`),
  });
  writeFileSync(join(outDir, `${slug}.run.json`), JSON.stringify(run, null, 2));
  result.trace = {
    status: run.status,
    ...(run.error ? { error: run.error } : {}),
    ...(run.bisect ? { culprit: run.bisect.culprit.sha } : {}),
    ...(run.rootCause ? { rootCause: `${run.rootCause.file}:${run.rootCause.line}` } : {}),
    costUsd: (run.usage ?? []).reduce((a, u) => a + u.costUsd, 0),
    models: (run.usage ?? []).map((u) => u.model),
    seconds: Math.round((Date.now() - t1) / 1000),
  };

  const reproduced = !!run.test && (run.test.runs.failed === run.test.runs.total);
  const passesWithFix = run.test?.names?.length ? await passesAt(root, fix, run) : null;
  const truthCulprit = result.truth.status === "found" ? result.truth.culprit : null;
  result.score = {
    reproduced,
    passesWithFix,
    culpritMatches: truthCulprit && run.bisect ? run.bisect.culprit.sha === truthCulprit : truthCulprit ? false : null,
  };
  log(`score: ${JSON.stringify(result.score)}, $${result.trace.costUsd.toFixed(3)}`);
} catch (e) {
  result.truth = result.truth.status === "invalid" && result.truth.reason === "not run" ? { status: "invalid", reason: `crashed: ${(e as Error).message}` } : result.truth;
  log(`error: ${(e as Error).stack ?? e}`);
} finally {
  save();
}

/** A blobless clone with full history, reused across cases from the same repo. */
function checkoutOf(repo: string): string {
  if (values.checkout) return resolve(values.checkout);
  const dir = join(resolve(values.work!), "eval", repo.replace("/", "__"));
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dirname(dir), { recursive: true });
    log(`cloning ${repo}`);
    git(dirname(dir), "clone", "--quiet", "--filter=blob:none", "--no-checkout", `https://github.com/${repo}.git`, dir);
  }
  return dir;
}

function reset(root: string, sha: string) {
  tryGit(root, "reset", "--hard", "--quiet");
  git(root, "clean", "-fdq", "-e", "node_modules", "-e", "**/node_modules");
  git(root, "checkout", "--quiet", "--detach", sha);
}

function writeFiles(root: string, files: Map<string, string>) {
  for (const [p, content] of files) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), content);
  }
}

/** Finds which of the fix's tests reproduce the bug, then searches history with them. */
async function groundTruth(root: string, pre: string, fix: string): Promise<Truth> {
  const changed = git(root, "diff", "--name-only", "--diff-filter=AM", pre, fix).split("\n").filter(Boolean);
  const tests = changed.filter((f) => c!.fix.testFiles.includes(f));
  if (tests.length === 0) return { status: "invalid", reason: "the fix changes none of its listed test files" };
  // Fixtures and helpers the fix added or changed next to its tests come along with them.
  const support = changed.filter((f) => !tests.includes(f) && /(__snapshots__|__fixtures__|fixtures?|__mocks__|test-?utils|testing)\//.test(f));
  const files = new Map([...tests, ...support].map((f) => [f, git(root, "show", `${fix}:${f}`)]));

  reset(root, fix);
  const installAtFix = await ensureInstalled(root, setup);
  if (installAtFix) return { status: "invalid", reason: `install failed at the fix: ${installAtFix.slice(-200)}` };
  // What each test file did at the fix and before it, kept so an invalid case can be understood.
  const diagnostics: string[] = [];
  const describe = (at: string, f: string, r: Awaited<ReturnType<typeof runTestFile>>) => {
    const line = r.ran
      ? `${at} ${f}: ${r.cases.filter((x) => x.status === "passed").length} passed, ${r.cases.filter((x) => x.status === "failed" && x.assertion).length} failed on assertions, ${r.cases.filter((x) => x.status === "failed" && !x.assertion).length} crashed`
      : `${at} ${f}: didn't run: ${(r.loadError ?? "").replace(/\s+/g, " ").trim().slice(-400)}`;
    diagnostics.push(line);
    log(`truth: ${line}`);
  };
  const passingAtFix = new Map<string, Set<string>>();
  for (const f of tests) {
    const r = await runTestFile(root, f, { setup });
    describe("at fix", f, r);
    passingAtFix.set(f, new Set(r.cases.filter((x) => x.status === "passed").map((x) => x.name)));
  }

  reset(root, pre);
  writeFiles(root, files);
  const installAtPre = await ensureInstalled(root, setup);
  if (installAtPre) return { status: "invalid", reason: `install failed before the fix: ${installAtPre.slice(-200)}` };
  let best: { file: string; names: string[] } | null = null;
  for (const f of tests) {
    const r = await runTestFile(root, f, { setup });
    describe("before fix", f, r);
    const names = r.cases.filter((x) => x.status === "failed" && x.assertion && passingAtFix.get(f)?.has(x.name)).map((x) => x.name);
    if (names.length && (!best || names.length > best.names.length)) best = { file: f, names };
  }
  if (!best) return { status: "invalid", reason: "none of the fix's tests pass at the fix and fail on an assertion before it", diagnostics };

  const t = Date.now();
  const s: SearchResult = await findCulprit({ root, start: pre, files, testFile: best.file, testNames: best.names, setup, log: (l) => log(`truth: ${l}`) });
  if (s.status === "found") {
    return {
      status: "found",
      culprit: s.culprit,
      subject: git(root, "show", "-s", "--format=%s", s.culprit),
      testFile: best.file,
      testNames: s.testNames,
      searchSeconds: Math.round((Date.now() - t) / 1000),
    };
  }
  return { status: s.status, ...(s.status === "inconclusive" ? { reason: s.reason } : {}), testFile: best.file, testNames: best.names };
}

/** Whether Trace's test passes with the maintainers' fix applied. */
async function passesAt(root: string, fix: string, run: Run): Promise<boolean | null> {
  const t = run.test!;
  reset(root, fix);
  writeFiles(root, new Map([[t.file, t.code], ...(t.fixtures ?? []).map((f) => [f.file, f.code] as [string, string])]));
  if (await ensureInstalled(root, setup)) return null;
  const r = await runTestFile(root, t.file, { names: t.names, setup });
  return r.ran && r.cases.length > 0 && r.cases.every((x) => x.status === "passed");
}

function describeTruth(t: Truth): string {
  if (t.status === "invalid") return `invalid case: ${t.reason}`;
  if (t.status === "found") return `culprit ${t.culprit.slice(0, 9)} "${t.subject}" (${t.testNames.length} tests)`;
  return `${t.status}${t.reason ? `: ${t.reason}` : ""}`;
}
