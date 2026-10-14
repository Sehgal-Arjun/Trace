import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { nodeEnv } from "./node.ts";
import { sh } from "./shell.ts";

export type Runner = "vitest" | "jest";

export type TestCase = {
  /** "file > full test name", stable across commits. */
  id: string;
  name: string;
  status: "passed" | "failed";
  /** First failure message, trimmed. */
  message?: string;
  /** Whether the failure is an assertion about behavior, as opposed to a crash. */
  assertion?: boolean;
};

export type TestRun = {
  /** The file loaded and at least one targeted test ran. */
  ran: boolean;
  cases: TestCase[];
  /** Why nothing ran: import error, syntax error, timeout. */
  loadError?: string;
  output: string;
  seconds: number;
};

/** Finds the nearest package.json above the test file that uses vitest or jest. */
export function detectRunner(root: string, testFile: string): { runner: Runner; pkgDir: string } | null {
  let d = dirname(join(root, testFile));
  while (d.startsWith(root)) {
    const pj = join(d, "package.json");
    if (existsSync(pj)) {
      const p = JSON.parse(readFileSync(pj, "utf8"));
      const deps = { ...p.dependencies, ...p.devDependencies };
      const scripts = JSON.stringify(p.scripts ?? {});
      // The package's own test script wins: some depend on both runners but test with one.
      const testScript = String(p.scripts?.test ?? "");
      if (/\bvitest\b/.test(testScript)) return { runner: "vitest", pkgDir: d };
      if (/\bjest\b/.test(testScript)) return { runner: "jest", pkgDir: d };
      if (deps.vitest || /vitest/.test(scripts)) return { runner: "vitest", pkgDir: d };
      if (deps.jest || /\bjest\b/.test(scripts)) return { runner: "jest", pkgDir: d };
    }
    if (d === root) break;
    d = dirname(d);
  }
  return null;
}

export function testCommand(root: string, testFile: string): string | null {
  const r = detectRunner(root, testFile);
  if (!r) return null;
  const rel = relative(root, join(root, testFile));
  return r.runner === "vitest" ? `npx vitest run ${rel}` : `npx jest ${rel}`;
}

// Failures that mean the test is broken rather than that the behavior is wrong.
const CRASH_RE =
  /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b|Cannot find module|Failed to resolve import|is not a function|is not defined|is not a constructor|Cannot read propert/;
const ASSERT_RE = /AssertionError|\bexpected\b|toBe|toEqual|toMatch|toHaveBeenCalled|Expected:|Received:/;

export function isAssertionFailure(message: string): boolean {
  const head = message.split("\n").slice(0, 6).join("\n");
  if (CRASH_RE.test(head) && !/AssertionError/.test(head)) return false;
  return ASSERT_RE.test(head);
}

type JsonAssertion = { fullName?: string; title?: string; status: string; failureMessages?: string[] };
type JsonReport = { testResults?: { name: string; status: string; message?: string; assertionResults?: JsonAssertion[] }[] };

/**
 * Runs one test file (optionally only some tests in it) and reports each test.
 * Reads the runner's JSON report rather than parsing console output.
 */
export async function runTestFile(
  root: string,
  testFile: string,
  /** names: full test names (describe blocks + title, space-joined) to report on; all if omitted. */
  opts: { names?: string[]; timeoutSec?: number; env?: Record<string, string> } = {},
): Promise<TestRun> {
  const t0 = Date.now();
  const seconds = () => Math.round((Date.now() - t0) / 100) / 10;
  const r = detectRunner(root, testFile);
  if (!r) return { ran: false, cases: [], loadError: `no vitest or jest found above ${testFile}`, output: "", seconds: 0 };

  const rel = relative(r.pkgDir, join(root, testFile));
  const report = join(root, ".trace-report.json");
  rmSync(report, { force: true });
  const bin = (b: string) =>
    `"$(cd ${JSON.stringify(r.pkgDir)} && (ls node_modules/.bin/${b} 2>/dev/null || ls ${JSON.stringify(root)}/node_modules/.bin/${b}) | head -1)"`;
  // Runs the whole file and picks out the named tests afterwards. Runners disagree on how
  // they join describe blocks into the name a -t filter matches (vitest 5 uses " > ", its
  // JSON report uses spaces), and unit test files are quick enough to run in full.
  const names = opts.names ?? [];
  const cmd =
    r.runner === "vitest"
      ? `${bin("vitest")} run ${JSON.stringify(rel)} --reporter=json --outputFile=${JSON.stringify(report)}`
      : `${bin("jest")} ${JSON.stringify(rel)} --ci --json --outputFile=${JSON.stringify(report)}`;
  const res = await sh(cmd, r.pkgDir, { env: { ...nodeEnv(root), ...opts.env }, timeoutSec: opts.timeoutSec ?? 600 });
  const output = res.out.slice(-20_000);

  if (!existsSync(report)) return { ran: false, cases: [], loadError: tail(res.out), output, seconds: seconds() };
  const json = JSON.parse(readFileSync(report, "utf8")) as JsonReport;
  rmSync(report, { force: true });
  const file = json.testResults?.[0];
  const cases: TestCase[] = (file?.assertionResults ?? [])
    .filter((a) => a.status === "passed" || a.status === "failed")
    .filter((a) => !names.length || names.includes(a.fullName ?? a.title ?? ""))
    .map((a) => {
      const name = a.fullName ?? a.title ?? "";
      const message = a.failureMessages?.[0]?.slice(0, 2000);
      return {
        id: `${testFile} > ${name}`,
        name,
        status: a.status as "passed" | "failed",
        ...(a.status === "failed" ? { message, assertion: isAssertionFailure(message ?? "") } : {}),
      };
    });
  if (cases.length === 0) return { ran: false, cases, loadError: tail(file?.message || res.out), output, seconds: seconds() };
  return { ran: true, cases, output, seconds: seconds() };
}

function tail(s: string, n = 1500): string {
  return s.length > n ? s.slice(-n) : s;
}

/** Keeps the cases whose full name contains any of the given strings (all of them if none given). */
export function matching(run: TestRun, names?: string[]): TestRun {
  if (!names?.length) return run;
  const cases = run.cases.filter((c) => names.some((n) => c.name.includes(n)));
  return cases.length || !run.ran ? { ...run, cases } : { ...run, ran: false, cases, loadError: `no tests matched ${JSON.stringify(names)}` };
}
