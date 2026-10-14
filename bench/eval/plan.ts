// Picks the cases for an eval run and prints them as a GitHub Actions matrix.
//
// Usage: node bench/eval/plan.ts [--ids a#1,b#2] [--limit 30] [--per-repo 3] [--confidence strong|any]
// Without --ids: up to --per-repo cases from each repo, strong ones first, then trimmed to --limit.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    ids: { type: "string", default: "" },
    limit: { type: "string", default: "30" },
    "per-repo": { type: "string", default: "3" },
    confidence: { type: "string", default: "strong" },
  },
});

type Case = { id: string; repo: string; confidence: string };
// Repos whose tests need more than a prepare step (a database, a compile-to-JS test flow) are
// marked skip in recipes.json and left out of automatic picks.
const recipes = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "recipes.json"), "utf8")) as Record<string, { skip?: boolean }>;
const all = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cases.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Case);

let picked: string[];
const ids = values.ids.split(",").map((s) => s.trim()).filter(Boolean);
if (ids.length) {
  const known = new Set(all.map((c) => c.id));
  const unknown = ids.filter((i) => !known.has(i));
  if (unknown.length) throw new Error(`unknown case ids: ${unknown.join(", ")}`);
  picked = ids;
} else {
  const pool = all
    .filter((c) => !recipes[c.repo]?.skip)
    .filter((c) => values.confidence === "any" || c.confidence === values.confidence)
    .sort((a, b) => Number(b.confidence === "strong") - Number(a.confidence === "strong"));
  const perRepo = new Map<string, number>();
  picked = [];
  for (const c of pool) {
    const n = perRepo.get(c.repo) ?? 0;
    if (n >= Number(values["per-repo"])) continue;
    perRepo.set(c.repo, n + 1);
    picked.push(c.id);
  }
  picked = picked.slice(0, Number(values.limit));
}

console.log(`matrix=${JSON.stringify(picked)}`);
console.error(`${picked.length} cases`);
