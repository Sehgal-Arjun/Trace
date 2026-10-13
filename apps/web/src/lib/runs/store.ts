import "server-only";

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Run } from "./types";

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
