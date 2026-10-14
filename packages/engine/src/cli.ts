// Usage: node src/cli.ts --checkout <dir> --report <report.json> --repo owner/name [--id BUG-1] [--out run.json]
//                        [--model claude-haiku-5-5|claude-sonnet-5-5|claude-opus-5-5] [--effort low|medium|high] [--budget 0.25]
//                        [--resume]   continue the run saved in --out, e.g. after an interruption
//                        [--install <cmd>] [--prepare <cmd>] [--scripts]   how to set up the checkout (see Setup)
//
// Without --model, Trace tries Haiku 5.5 and then Sonnet 5.5 (see DEFAULT_LADDER). --budget caps spend per model in dollars.
//
// <report.json> is { "title": "...", "body": "..." }. The checkout is moved between commits and
// reset during the history search, so point this at a disposable clone, never your working copy.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Run } from "@trace/core";
import { DEFAULT_LADDER, type Effort, type ModelId, type Tier } from "./models.ts";
import { trace } from "./run.ts";
import { git } from "./shell.ts";

// Secrets such as ANTHROPIC_API_KEY come from packages/engine/.env (gitignored) if it exists.
const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values } = parseArgs({
  options: {
    checkout: { type: "string" },
    report: { type: "string" },
    repo: { type: "string" },
    id: { type: "string", default: "BUG-1" },
    out: { type: "string" },
    install: { type: "string" },
    prepare: { type: "string" },
    scripts: { type: "boolean", default: false },
    model: { type: "string" },
    effort: { type: "string" },
    budget: { type: "string" },
    resume: { type: "boolean", default: false },
  },
});

const MODELS: ModelId[] = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
if (values.model && !MODELS.includes(values.model as ModelId)) {
  console.error(`--model must be one of ${MODELS.join(", ")}`);
  process.exit(2);
}
if (values.effort && !["low", "medium", "high"].includes(values.effort)) {
  console.error("--effort must be low, medium or high");
  process.exit(2);
}
const budget = values.budget ? Number(values.budget) : undefined;
const ladder: Tier[] = values.model
  ? [{ model: values.model as ModelId, effort: (values.effort as Effort) ?? "medium", budgetUsd: budget ?? 0.5 }]
  : DEFAULT_LADDER.map((t) => ({ ...t, ...(values.effort ? { effort: values.effort as Effort } : {}), ...(budget ? { budgetUsd: budget } : {}) }));

if (!values.checkout || !values.report || !values.repo) {
  console.error("usage: node src/cli.ts --checkout <dir> --report <report.json> --repo owner/name [--id BUG-1] [--out run.json]");
  process.exit(2);
}

const dirty = git(values.checkout, "status", "--porcelain", "--untracked-files=normal").split("\n").filter((l) => l && !/node_modules/.test(l));
if (dirty.length && !values.resume) {
  console.error(`${values.checkout} has uncommitted changes, and the history search resets the checkout:\n${dirty.slice(0, 10).join("\n")}`);
  process.exit(2);
}

const [owner, name] = values.repo.split("/");
const report = JSON.parse(readFileSync(values.report, "utf8")) as { title: string; body: string };
if (values.resume && !values.out) {
  console.error("--resume needs --out: it continues from the run saved there");
  process.exit(2);
}
const resume = values.resume && existsSync(values.out!) ? (JSON.parse(readFileSync(values.out!, "utf8")) as Run) : undefined;
const save = (r: Run) => values.out && writeFileSync(values.out, JSON.stringify(r, null, 2));
const t0 = Date.now();
const run = await trace({
  id: values.id!,
  root: values.checkout,
  repo: { owner, name, defaultBranch: "main" },
  report: { title: report.title, body: report.body, source: { kind: "manual" }, attachments: [], createdAt: new Date().toISOString() },
  setup: { install: values.install, prepare: values.prepare, scripts: values.scripts },
  ladder,
  resume,
  onProgress: save,
  log: (l) => console.log(`[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] ${l}`),
});

console.log(`\n${run.status}${run.error ? `: ${run.error}` : ""} (${Math.round((Date.now() - t0) / 1000)}s)`);
const cost = (run.usage ?? []).reduce((a, u) => a + u.costUsd, 0);
console.log(`model cost: $${cost.toFixed(3)} (${(run.usage ?? []).map((u) => `${u.model} $${u.costUsd.toFixed(3)}`).join(", ") || "none"})`);
if (run.rootCause) console.log(`root cause: ${run.rootCause.symbol} at ${run.rootCause.file}:${run.rootCause.line}`);
if (run.bisect) console.log(`culprit: ${run.bisect.culprit.sha.slice(0, 9)} ${run.bisect.culprit.subject}`);
if (values.out) {
  save(run);
  console.log(`wrote ${values.out}`);
}
