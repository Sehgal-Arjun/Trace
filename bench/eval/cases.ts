// Builds bench/eval/cases.jsonl from the triaged candidates in bench/data/kept.jsonl.
// A case is everything an eval run needs: the repo, the fix, and the report as a non-technical
// person would have written it. Only the rewrite is used; the original issue can name the culprit.
//
// Usage: node bench/eval/cases.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
type Kept = {
  repo: string;
  issue: { number: number; url: string };
  fix: { pr: number; url: string; mergeCommit: string; testFiles: string[] };
  sharedFix?: boolean;
  triage: { regression: string; testTargetsBug: string; nonTechnicalReport: string };
};

const kept = readFileSync(join(ROOT, "data", "kept.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Kept)
  .filter((k) => !k.sharedFix);

const lines = kept.map((k) => {
  const body = k.triage.nonTechnicalReport.trim();
  return JSON.stringify({
    id: `${k.repo}#${k.issue.number}`,
    repo: k.repo,
    issueUrl: k.issue.url,
    fix: { pr: k.fix.pr, url: k.fix.url, commit: k.fix.mergeCommit, testFiles: k.fix.testFiles },
    // Triage confidence: "strong" when it judged both the regression and the fix's test as clear.
    confidence: k.triage.regression === "yes" && k.triage.testTargetsBug === "yes" ? "strong" : "likely",
    report: { title: titleOf(body), body },
  });
});
writeFileSync(join(ROOT, "eval", "cases.jsonl"), lines.join("\n") + "\n");
console.log(`wrote ${lines.length} cases`);

/** A short ticket title from the report's first sentence, the way someone filing it might. */
function titleOf(body: string): string {
  const first = body.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "");
  return first.length <= 80 ? first : `${first.slice(0, 77).replace(/\s+\S*$/, "")}…`;
}
