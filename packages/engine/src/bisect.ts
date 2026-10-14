import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nodeEnv } from "./node.ts";
import { git, sh } from "./shell.ts";
import { runTestFile, type TestRun } from "./tests.ts";

export type Outcome = "pass" | "fail" | "skip";

export type SearchProbe = {
  sha: string;
  /** Position in first-parent history: 0 is where the search started, larger is older. */
  index: number;
  outcome: Outcome;
  seconds: number;
  reason?: string;
};

export type SearchResult =
  | { status: "found"; culprit: string; lastGood: string; probes: SearchProbe[]; commitsSearched: number; seconds: number; testNames: string[] }
  | { status: "not-regression"; probes: SearchProbe[]; oldestFailing: string; seconds: number }
  | { status: "inconclusive"; reason: string; probes: SearchProbe[]; seconds: number };

export type SearchOptions = {
  /** Checkout to move between commits. Restored to `start` afterwards. */
  root: string;
  /** Commit where the test fails (normally HEAD at the time of the report). */
  start: string;
  /** The test and any fixtures, copied into the checkout at every commit. */
  files: Map<string, string>;
  testFile: string;
  /** Tests that fail at `start`; the search judges commits only on these. */
  testNames: string[];
  setup?: Setup;
  maxHistory?: number;
  log?: (line: string) => void;
};

/**
 * Finds the first commit on first-parent history where the reproducing tests fail.
 *
 * 1. Walk back in growing jumps until the tests pass somewhere.
 * 2. If the tests stop loading before that (renamed modules, missing APIs), binary-search the
 *    gap between the last failure and that point for a commit where they run and pass.
 * 3. Binary-search between the newest known pass and the oldest known failure.
 *
 * A probe is judged only on the tests being tracked. When an older commit passes some of them
 * but not others, the search narrows to the ones that pass: the rest test behavior that never
 * existed, so they can't say when it broke.
 */
export async function findCulprit(o: SearchOptions): Promise<SearchResult> {
  const t0 = Date.now();
  const log = o.log ?? (() => {});
  const probes: SearchProbe[] = [];
  const history = git(o.root, "rev-list", "--first-parent", `--max-count=${o.maxHistory ?? 4000}`, o.start).split("\n");
  let focus = new Set(o.testNames);
  const elapsed = () => Math.round((Date.now() - t0) / 1000);

  const probe = async (index: number, label: string): Promise<Outcome> => {
    const sha = history[index];
    const p0 = Date.now();
    const done = (outcome: Outcome, reason?: string) => {
      const p: SearchProbe = { sha, index, outcome, seconds: Math.round((Date.now() - p0) / 100) / 10, ...(reason ? { reason } : {}) };
      probes.push(p);
      log(`${label.padEnd(18)} ${sha.slice(0, 9)} → ${outcome}${reason ? ` (${reason.replace(/\s+/g, " ").trim().slice(-160)})` : ""}`);
      return outcome;
    };

    checkout(o.root, sha, o.files);
    const err = await ensureInstalled(o.root, o.setup);
    if (err) return done("skip", err);
    const run = await runTestFile(o.root, o.testFile, { names: [...focus], timeoutSec: 600 });
    return judge(run, done);
  };

  const judge = (run: TestRun, done: (o: Outcome, r?: string) => Outcome): Outcome => {
    if (!run.ran) return done("skip", run.loadError ?? "tests didn't run");
    const tracked = run.cases.filter((c) => focus.has(c.name));
    if (tracked.length === 0) return done("skip", "none of the tracked tests ran");
    // A crash isn't evidence either way: the test can't exercise the code here.
    if (tracked.some((c) => c.status === "failed" && !c.assertion)) return done("skip", "test crashed instead of asserting");
    const failing = tracked.filter((c) => c.status === "failed");
    const passing = tracked.filter((c) => c.status === "passed");
    if (failing.length === 0) return done("pass");
    if (passing.length === 0) return done("fail");
    focus = new Set(passing.map((c) => c.name));
    return done("pass", `narrowed to ${passing.length} test(s); ${failing.length} never passed`);
  };

  try {
    // 1. Walk back.
    let bad = 0;
    let good = -1;
    for (const jump of [8, 32, 128, 512, 2000, history.length - 1]) {
      const i = Math.min(jump, history.length - 1);
      if (i <= bad) continue;
      let at = i;
      let outcome = await probe(at, `back ${at}`);
      for (let k = 1; outcome === "skip" && k <= 3 && i - k * 2 > bad; k++) outcome = await probe((at = i - k * 2), `back ${at}`);
      if (outcome === "pass") {
        good = at;
        break;
      }
      if (outcome === "fail") {
        bad = at;
        continue;
      }
      // 2. The tests stop running here; look for a pass in the gap.
      let lo = bad;
      let hi = at;
      while (good === -1 && hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const out = await probe(mid, `runnable [${lo}..${hi}]`);
        if (out === "pass") good = mid;
        else if (out === "fail") lo = bad = mid;
        else hi = mid;
      }
      break;
    }
    if (good === -1) {
      if (!probes.some((p) => p.outcome === "fail")) {
        return { status: "inconclusive", reason: "the test didn't run at any older commit", probes, seconds: elapsed() };
      }
      return { status: "not-regression", probes, oldestFailing: history[bad], seconds: elapsed() };
    }

    // 3. Bisect.
    const skipped = new Set<number>();
    let lo = bad;
    let hi = good;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const order = [mid, ...Array.from({ length: hi - lo - 1 }, (_, k) => [mid + k + 1, mid - k - 1]).flat()].filter(
        (x) => x > lo && x < hi && !skipped.has(x),
      );
      if (order.length === 0) break;
      const out = await probe(order[0], `bisect [${lo}..${hi}]`);
      if (out === "pass") hi = order[0];
      else if (out === "fail") lo = order[0];
      else skipped.add(order[0]);
    }
    if (hi - lo > 1) {
      return { status: "inconclusive", reason: `couldn't run the test on commits between ${history[hi].slice(0, 9)} and ${history[lo].slice(0, 9)}`, probes, seconds: elapsed() };
    }
    return { status: "found", culprit: history[lo], lastGood: history[hi], probes, commitsSearched: good, seconds: elapsed(), testNames: [...focus] };
  } finally {
    checkout(o.root, o.start, o.files);
    await ensureInstalled(o.root, o.setup);
  }
}

/** How to get a checkout ready to run tests. */
export type Setup = {
  /** Replaces the detected package-manager install. */
  install?: string;
  /** Runs after install at every commit, for builds or codegen the tests depend on. */
  prepare?: string;
  /** Let packages run their install scripts (native modules, postinstall builds). Off by default. */
  scripts?: boolean;
};

/**
 * Makes the checkout ready to run tests: installs dependencies if the lockfile differs from the
 * one last installed here, then runs the prepare step if this commit hasn't been prepared. Both
 * keys are kept in node_modules, so this holds across processes and catches a checkout whose
 * dependencies or build output belong to some other commit.
 */
export async function ensureInstalled(root: string, setup: Setup = {}): Promise<string | null> {
  // Yarn 2+ refuses to install when Node doesn't exactly match a pinned version; close is fine.
  const env = { ...nodeEnv(root), YARN_IGNORE_NODE: "1" };
  const installMarker = join(root, "node_modules", ".trace-lockfile");
  const installKey = lockKey(root);
  if (!(existsSync(installMarker) && readFileSync(installMarker, "utf8") === installKey)) {
    const r = await sh(setup.install ?? defaultInstall(root, setup.scripts ?? false), root, { env, timeoutSec: 1800 });
    if (r.code !== 0) return `install failed: ${r.out.slice(-300)}`;
    mkdirSync(dirname(installMarker), { recursive: true });
    writeFileSync(installMarker, installKey);
  }
  if (setup.prepare) {
    // Build output depends on the source, so prepare again whenever the commit changes.
    const prepMarker = join(root, "node_modules", ".trace-prepared");
    const prepKey = `${git(root, "rev-parse", "HEAD")} ${setup.prepare}`;
    if (!(existsSync(prepMarker) && readFileSync(prepMarker, "utf8") === prepKey)) {
      const r = await sh(setup.prepare, root, { env, timeoutSec: 1800 });
      if (r.code !== 0) return `prepare failed: ${r.out.slice(-300)}`;
      writeFileSync(prepMarker, prepKey);
    }
  }
  return null;
}

function checkout(root: string, sha: string, files: Map<string, string>) {
  git(root, "reset", "--hard", "--quiet");
  git(root, "clean", "-fdq", "-e", "node_modules", "-e", "**/node_modules");
  git(root, "checkout", "--quiet", "--detach", sha);
  for (const [path, content] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function lockKey(root: string): string {
  const h = createHash("sha1");
  for (const f of ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lock", "bun.lockb"]) {
    const p = join(root, f);
    if (existsSync(p)) h.update(f).update(readFileSync(p));
  }
  return h.digest("hex");
}

export function defaultInstall(root: string, scripts = false): string {
  // Engine checks are relaxed: old commits often declare a narrower Node range than they need.
  const noScripts = scripts ? "" : " --ignore-scripts";
  if (existsSync(join(root, "pnpm-lock.yaml"))) {
    return `corepack pnpm install --frozen-lockfile${noScripts} --config.engine-strict=false || corepack pnpm install${noScripts} --config.engine-strict=false`;
  }
  if (existsSync(join(root, "yarn.lock"))) {
    const berryEnv = scripts ? "" : "YARN_ENABLE_SCRIPTS=0 ";
    return existsSync(join(root, ".yarnrc.yml"))
      ? `${berryEnv}corepack yarn install --immutable || ${berryEnv}corepack yarn install`
      : `corepack yarn install --frozen-lockfile${noScripts} --ignore-engines`;
  }
  return `npm ci${noScripts} || npm install${noScripts}`;
}
