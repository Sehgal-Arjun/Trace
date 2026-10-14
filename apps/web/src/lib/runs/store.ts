import "server-only";

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Report, Repo, Run } from "./types";

// Runs live as JSON files until there's a database. One file per run.
const RUNS_DIR = join(process.cwd(), "data", "runs");

export async function listRuns(): Promise<Run[]> {
  let files: string[];
  try {
    files = (await readdir(RUNS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const runs = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(RUNS_DIR, f), "utf8")) as Run));
  return runs.sort((a, b) => b.report.createdAt.localeCompare(a.report.createdAt));
}

export async function getRun(id: string): Promise<Run | undefined> {
  const runs = await listRuns();
  return runs.find((r) => r.id === id);
}

/** Saves a new run in the queue and returns it. Ids count up from the highest existing BUG-n. */
export async function createRun(input: { repo: Repo; report: Omit<Report, "createdAt"> }): Promise<Run> {
  await mkdir(RUNS_DIR, { recursive: true });
  const runs = await listRuns();
  const next = 1 + Math.max(0, ...runs.map((r) => Number(r.id.match(/^BUG-(\d+)$/)?.[1] ?? 0)));
  const run: Run = {
    id: `BUG-${next}`,
    repo: input.repo,
    status: "queued",
    report: { ...input.report, createdAt: new Date().toISOString() },
  };
  // "wx" fails instead of overwriting if two reports race for the same id.
  await writeFile(join(RUNS_DIR, `${run.id.toLowerCase()}.json`), JSON.stringify(run, null, 2), { flag: "wx" });
  return run;
}
