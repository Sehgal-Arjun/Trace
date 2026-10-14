// Turns a directory of eval results into a scorecard (Markdown on stdout).
//
// Usage: node bench/eval/summarize.ts <dir>

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseResult } from "./case.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node bench/eval/summarize.ts <dir>");
const results = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".run.json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CaseResult)
  .sort((a, b) => a.id.localeCompare(b.id));

const traced = results.filter((r) => r.trace);
const withTruth = traced.filter((r) => r.truth.status === "found");
const count = (xs: CaseResult[], f: (r: CaseResult) => boolean | null | undefined) => xs.filter((r) => f(r) === true).length;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "–");
const cost = traced.reduce((a, r) => a + (r.trace?.costUsd ?? 0), 0);

const lines = [
  "## Trace eval",
  "",
  `${plural(results.length, "case")}, ${results.filter((r) => r.truth.status === "invalid").length} invalid (the maintainers' own test couldn't be used), ${traced.length} traced.`,
  "",
  "| | |",
  "|---|---|",
  `| Reproduced the bug (test fails at the reported commit) | ${pct(count(traced, (r) => r.score?.reproduced), traced.length)} |`,
  `| Test passes with the real fix | ${pct(count(traced, (r) => r.score?.passesWithFix), traced.length)} |`,
  `| Found the same culprit commit | ${pct(count(withTruth, (r) => r.score?.culpritMatches), withTruth.length)} of cases with a known culprit |`,
  `| Found a culprit where the maintainers' test couldn't | ${traced.filter((r) => r.truth.status !== "found" && r.trace?.culprit).length} (check these by hand) |`,
  `| Model cost | $${cost.toFixed(3)} total, $${traced.length ? (cost / traced.length).toFixed(3) : "0"} per case |`,
  "",
  "| Case | Ground truth | Trace | Reproduced | Passes with fix | Culprit | Cost | Time |",
  "|---|---|---|---|---|---|---|---|",
  ...results.map((r) => {
    const truth = r.truth.status === "found" ? `\`${r.truth.culprit.slice(0, 7)}\`` : r.truth.status;
    const mark = (v: boolean | null | undefined) => (v === true ? "✅" : v === false ? "❌" : "–");
    return `| ${r.id} | ${truth} | ${r.trace?.status ?? "–"} | ${mark(r.score?.reproduced)} | ${mark(r.score?.passesWithFix)} | ${mark(r.score?.culpritMatches)} | ${r.trace ? `$${r.trace.costUsd.toFixed(3)}` : "–"} | ${Math.round(r.seconds / 60)} min |`;
  }),
];

const invalid = results.filter((r) => r.truth.status === "invalid");
if (invalid.length) {
  lines.push("", "<details><summary>Invalid cases</summary>", "", ...invalid.map((r) => `- ${r.id}: ${r.truth.status === "invalid" ? r.truth.reason : ""}`), "", "</details>");
}
console.log(lines.join("\n"));
