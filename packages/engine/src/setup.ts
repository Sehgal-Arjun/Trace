import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nodeEnv } from "./node.ts";
import { git, sh } from "./shell.ts";

/** How to get a checkout ready to run tests. */
export type Setup = {
  /** Replaces the detected package-manager install. */
  install?: string;
  /**
   * Runs after install at every commit, for builds or codegen the tests depend on. "{package}"
   * is replaced with the name of the package containing the test being run, and the step then
   * runs just before that test (e.g. "pnpm exec turbo run build --filter={package}^...").
   */
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
  if (setup.prepare && !setup.prepare.includes("{package}")) return prepare(root, setup.prepare);
  return null;
}

/** Runs a package-specific prepare step for the package containing `testFile`, if the setup has one. */
export async function prepareFor(root: string, setup: Setup | undefined, testFile: string): Promise<string | null> {
  if (!setup?.prepare?.includes("{package}")) return null;
  const name = packageOf(root, testFile);
  if (!name) return `no package.json above ${testFile} to fill {package} in the prepare step`;
  return prepare(root, setup.prepare.replaceAll("{package}", name));
}

// Build output depends on the source, so a step reruns whenever the commit changes. Each distinct
// command is remembered separately, so preparing two packages at one commit doesn't repeat work.
async function prepare(root: string, cmd: string): Promise<string | null> {
  const marker = join(root, "node_modules", `.trace-prepared-${createHash("sha1").update(cmd).digest("hex").slice(0, 12)}`);
  const key = git(root, "rev-parse", "HEAD");
  if (existsSync(marker) && readFileSync(marker, "utf8") === key) return null;
  const r = await sh(cmd, root, { env: { ...nodeEnv(root), YARN_IGNORE_NODE: "1" }, timeoutSec: 1800 });
  if (r.code !== 0) return `prepare failed: ${r.out.slice(-300)}`;
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, key);
  return null;
}

function packageOf(root: string, file: string): string | null {
  let d = dirname(join(root, file));
  while (d.startsWith(root)) {
    const pj = join(d, "package.json");
    if (existsSync(pj)) {
      const name = JSON.parse(readFileSync(pj, "utf8")).name;
      if (name) return name;
    }
    if (d === root) break;
    d = dirname(d);
  }
  return null;
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
