// Establishes ground truth for one candidate bug:
//   1. the fix PR's tests fail on the commit just before the fix (pre-fix)
//   2. they pass on the fix commit
//   3. walking back along first-parent history, find a commit where they pass (good)
//   4. binary search between good and pre-fix for the first failing commit (culprit)
//
// Usage: node bench/verify/verify.ts owner/repo#issue [--keep-going]
// Writes bench/data/verified/<owner>__<repo>__<issue>.json

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache');
const RECIPES = JSON.parse(readFileSync(join(ROOT, 'verify', 'recipes.json'), 'utf8')) as Record<string, Recipe>;

type Recipe = {
  install?: string; // shell command run at repo root when lockfiles change
  prepare?: string; // shell command run after install (e.g. build workspace deps)
  env?: Record<string, string>;
  timeoutSec?: number;
};

type Candidate = {
  repo: string;
  issue: { number: number; title: string };
  fix: { pr: number; mergeCommit: string; testFiles: string[]; sourceFiles: string[] };
};

type Outcome = 'pass' | 'fail' | 'skip';
type Probe = { sha: string; outcome: Outcome; detail: string; seconds: number };

const log = (...a: unknown[]) => console.log(`[${new Date().toLocaleTimeString('en-GB', { hour12: false })}]`, ...a);

// Runs a shell command in its own process group so a timeout kills everything it started
// (test runners and builds spawn workers that otherwise outlive the shell and hold its pipes).
function sh(cmd: string, cwd: string, opts: { env?: Record<string, string>; timeoutSec?: number } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', cmd], {
      cwd,
      env: { ...process.env, CI: '1', HUSKY: '0', ...opts.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const keep = (b: Buffer) => {
      chunks.push(b);
      size += b.length;
      while (size > 4 * 1024 * 1024 && chunks.length > 1) size -= chunks.shift()!.length; // keep the tail
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const killGroup = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, (opts.timeoutSec ?? 900) * 1000);
    // Some test setups start watchers (e.g. `vite build --watch`) that never exit and keep our
    // pipes open, so reap the group as soon as the command itself exits rather than on 'close'.
    child.on('exit', killGroup);
    child.on('close', (code) => {
      clearTimeout(timer);
      killGroup();
      const out = Buffer.concat(chunks).toString('utf8');
      resolve({ code: timedOut ? -1 : (code ?? -1), out: timedOut ? `${out}\n[timed out after ${opts.timeoutSec ?? 900}s]` : out });
    });
  });
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
}

function loadCandidate(id: string): Candidate {
  const [repo, num] = id.split('#');
  for (const line of readFileSync(join(ROOT, 'data', 'candidates.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const c = JSON.parse(line) as Candidate;
    if (c.repo === repo && c.issue.number === Number(num)) return c;
  }
  throw new Error(`candidate ${id} not found`);
}

function ensureClone(repo: string): string {
  const dir = join(CACHE, 'repos', repo.replace('/', '__'));
  if (!existsSync(dir)) {
    mkdirSync(dirname(dir), { recursive: true });
    log(`cloning ${repo}`);
    execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', `https://github.com/${repo}.git`, dir], { stdio: 'inherit' });
  } else {
    git(dir, 'fetch', '--quiet', 'origin');
  }
  return dir;
}

// Names of tests the fix PR added or changed, so we judge only those and ignore unrelated failures in the same file.
function targetTestNames(repoDir: string, pre: string, fix: string, file: string): string[] {
  const diff = git(repoDir, 'diff', '-U0', pre, fix, '--', file);
  const names = new Set<string>();
  const re = /\b(?:it|test)(?:\.(?:only|concurrent|each\([^)]*\)))?\(\s*(['"`])((?:\\.|(?!\1).)+)\1/g;
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const m of line.matchAll(re)) names.add(m[2]);
  }
  return [...names];
}

function detectRunner(workDir: string, testFile: string): { runner: 'vitest' | 'jest'; pkgDir: string } | null {
  let d = dirname(join(workDir, testFile));
  while (d.startsWith(workDir)) {
    const pj = join(d, 'package.json');
    if (existsSync(pj)) {
      const p = JSON.parse(readFileSync(pj, 'utf8'));
      const deps = { ...p.dependencies, ...p.devDependencies };
      const scripts = JSON.stringify(p.scripts ?? {});
      if (deps.vitest || /vitest/.test(scripts)) return { runner: 'vitest', pkgDir: d };
      if (deps.jest || /\bjest\b/.test(scripts)) return { runner: 'jest', pkgDir: d };
    }
    if (d === workDir) break;
    d = dirname(d);
  }
  return null;
}

function lockKey(workDir: string): string {
  const h = createHash('sha1');
  for (const f of ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb', 'bun.lock']) {
    const p = join(workDir, f);
    if (existsSync(p)) h.update(f).update(readFileSync(p));
  }
  return h.digest('hex');
}

function defaultInstall(workDir: string): string {
  if (existsSync(join(workDir, 'pnpm-lock.yaml'))) return 'corepack pnpm install --frozen-lockfile --ignore-scripts || corepack pnpm install --ignore-scripts';
  if (existsSync(join(workDir, 'yarn.lock'))) {
    return existsSync(join(workDir, '.yarnrc.yml'))
      ? 'YARN_ENABLE_SCRIPTS=0 corepack yarn install --immutable || YARN_ENABLE_SCRIPTS=0 corepack yarn install'
      : 'corepack yarn install --frozen-lockfile --ignore-scripts';
  }
  return 'npm ci --ignore-scripts || npm install --ignore-scripts';
}

type JsonAssertion = { fullName?: string; title?: string; status: string; ancestorTitles?: string[] };
type JsonReport = { testResults?: { name: string; status: string; message?: string; assertionResults?: JsonAssertion[] }[] };

class Harness {
  workDir: string;
  installedKey = '';
  repoDir: string;
  fixSha: string;
  files: string[];
  targets: Map<string, string[]>;
  recipe: Recipe;
  constructor(repo: string, repoDir: string, fixSha: string, files: string[], targets: Map<string, string[]>, recipe: Recipe) {
    this.workDir = join(CACHE, 'work', repo.replace('/', '__'));
    this.repoDir = repoDir;
    this.fixSha = fixSha;
    this.files = files;
    this.targets = targets;
    this.recipe = recipe;
  }

  checkout(sha: string) {
    if (!existsSync(this.workDir)) {
      mkdirSync(dirname(this.workDir), { recursive: true });
      git(this.repoDir, 'worktree', 'prune');
      git(this.repoDir, 'worktree', 'add', '--detach', this.workDir, sha);
    }
    // Drop the copied-in test files from the previous probe, then move.
    git(this.workDir, 'reset', '--hard', '--quiet');
    git(this.workDir, 'clean', '-fdq', '-e', 'node_modules', '-e', '**/node_modules', '-e', '.trace-*');
    git(this.workDir, 'checkout', '--quiet', '--detach', sha);
    // Bring in the fix's version of every test file.
    for (const f of this.files) {
      const content = execFileSync('git', ['show', `${this.fixSha}:${f}`], { cwd: this.repoDir, maxBuffer: 64 * 1024 * 1024 });
      mkdirSync(dirname(join(this.workDir, f)), { recursive: true });
      writeFileSync(join(this.workDir, f), content);
    }
  }

  async install(): Promise<string | null> {
    const key = lockKey(this.workDir);
    if (key === this.installedKey) return null;
    const cmd = this.recipe.install ?? defaultInstall(this.workDir);
    log(`  install (${cmd.split('||')[0].trim()})`);
    const r = await sh(cmd, this.workDir, { env: this.recipe.env, timeoutSec: 1800 });
    if (r.code !== 0) return `install failed: ${r.out.slice(-1500)}`;
    if (this.recipe.prepare) {
      const p = await sh(this.recipe.prepare, this.workDir, { env: this.recipe.env, timeoutSec: 1800 });
      if (p.code !== 0) return `prepare failed: ${p.out.slice(-1500)}`;
    }
    this.installedKey = key;
    return null;
  }

  async probe(sha: string): Promise<Probe> {
    const t0 = Date.now();
    const done = (outcome: Outcome, detail: string): Probe => ({ sha, outcome, detail, seconds: Math.round((Date.now() - t0) / 1000) });
    this.checkout(sha);
    const err = await this.install();
    if (err) return done('skip', err);

    let anyFail = false;
    const details: string[] = [];
    for (const [file, names] of this.targets) {
      const r = detectRunner(this.workDir, file);
      if (!r) return done('skip', `no test runner found for ${file}`);
      const rel = relative(r.pkgDir, join(this.workDir, file));
      const out = join(this.workDir, '.trace-report.json');
      rmSync(out, { force: true });
      const bin = (b: string) => `"$(cd ${JSON.stringify(r.pkgDir)} && (ls node_modules/.bin/${b} 2>/dev/null || ls ${JSON.stringify(this.workDir)}/node_modules/.bin/${b}) | head -1)"`;
      const filter = names.length ? ` -t ${JSON.stringify(names.map(escapeRe).join('|'))}` : '';
      const cmd =
        r.runner === 'vitest'
          ? `${bin('vitest')} run ${JSON.stringify(rel)} --reporter=json --outputFile=${JSON.stringify(out)}${filter}`
          : `${bin('jest')} ${JSON.stringify(rel)} --ci --json --outputFile=${JSON.stringify(out)}${filter}`;
      const res = await sh(cmd, r.pkgDir, { env: this.recipe.env, timeoutSec: this.recipe.timeoutSec ?? 600 });
      if (!existsSync(out)) return done('skip', `no report (exit ${res.code}): ${res.out.slice(-1500)}`);
      const rep = JSON.parse(readFileSync(out, 'utf8')) as JsonReport;
      const fileRes = rep.testResults?.[0];
      const asserts = (fileRes?.assertionResults ?? []).filter((a) => a.status !== 'pending' && a.status !== 'skipped' && a.status !== 'todo' && a.status !== 'disabled');
      const relevant = names.length ? asserts.filter((a) => names.some((n) => (a.title ?? a.fullName ?? '').includes(n) || (a.fullName ?? '').includes(n))) : asserts;
      if (relevant.length === 0) return done('skip', `tests did not load/run in ${file}: ${(fileRes?.message ?? res.out).slice(-1500)}`);
      const failed = relevant.filter((a) => a.status === 'failed');
      if (failed.length) {
        anyFail = true;
        details.push(`${file}: ${failed.length}/${relevant.length} failed (${failed.map((f) => f.title).join('; ').slice(0, 300)})`);
      } else details.push(`${file}: ${relevant.length} passed`);
    }
    return done(anyFail ? 'fail' : 'pass', details.join(' | '));
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%[sdifjoO#]|\$\w+/g, '.*');
}

async function main() {
  const id = process.argv[2];
  const c = loadCandidate(id);
  const recipe = RECIPES[c.repo] ?? {};
  const repoDir = ensureClone(c.repo);
  const fix = c.fix.mergeCommit;
  const pre = git(repoDir, 'rev-parse', `${fix}^1`);
  const record: Record<string, unknown> = { id, repo: c.repo, issue: c.issue.number, fixCommit: fix, preFixCommit: pre, probes: [] as Probe[] };
  const outPath = join(ROOT, 'data', 'verified', `${c.repo.replace('/', '__')}__${c.issue.number}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  const save = (status: string, extra: Record<string, unknown> = {}) => {
    Object.assign(record, { status, ...extra, updatedAt: new Date().toISOString() });
    writeFileSync(outPath, JSON.stringify(record, null, 2));
  };

  // Test files plus support files (fixtures, snapshots) the PR touched next to them.
  const changed = git(repoDir, 'diff', '--name-only', '--diff-filter=AM', pre, fix).split('\n').filter(Boolean);
  const testFiles = changed.filter((f) => c.fix.testFiles.includes(f));
  const support = changed.filter((f) => !testFiles.includes(f) && /(__snapshots__|__fixtures__|fixtures?|__mocks__|test-?utils|testing)\//.test(f));
  if (testFiles.length === 0) return save('rejected', { reason: 'no test files in fix diff' });
  const targets = new Map(testFiles.map((f) => [f, targetTestNames(repoDir, pre, fix, f)]));
  record.testFiles = Object.fromEntries(targets);
  log(`${id}: fix ${fix.slice(0, 9)}, pre ${pre.slice(0, 9)}, tests ${testFiles.join(', ')}`);

  const h = new Harness(c.repo, repoDir, fix, [...testFiles, ...support], targets, recipe);
  const probes = record.probes as Probe[];
  const run = async (sha: string, label: string) => {
    const p = await h.probe(sha);
    probes.push(p);
    log(`  ${label} ${sha.slice(0, 9)} → ${p.outcome} (${p.seconds}s) ${p.outcome === 'skip' ? p.detail.slice(0, 300).replace(/\s+/g, ' ') : p.detail}`);
    save('in-progress');
    return p;
  };

  const atFix = await run(fix, 'fix');
  // Couldn't install at all: that's our environment, not the bug. Keep it for a retry.
  if (atFix.outcome === 'skip' && /^(install|prepare) failed/.test(atFix.detail)) return save('infra-error', { reason: atFix.detail.slice(0, 200) });
  if (atFix.outcome !== 'pass') return save('rejected', { reason: `tests do not pass at fix commit (${atFix.outcome})` });
  const atPre = await run(pre, 'pre-fix');
  if (atPre.outcome !== 'fail') return save('rejected', { reason: `tests do not fail before the fix (${atPre.outcome})` });

  // Walk back along first-parent history to find a passing commit.
  const history = git(repoDir, 'rev-list', '--first-parent', '--max-count=4000', pre).split('\n'); // history[0] = pre
  let goodIdx = -1;
  let badIdx = 0;
  for (const back of [8, 32, 128, 512, 2000, history.length - 1]) {
    const i = Math.min(back, history.length - 1);
    if (i <= badIdx) continue;
    let p = await run(history[i], `back ${i}`);
    // A skip usually means the test can't compile that far back; nudge forward a little before giving up on this distance.
    for (let k = 1; p.outcome === 'skip' && k <= 3 && i - k * 2 > badIdx; k++) p = await run(history[i - k * 2], `back ${i - k * 2}`);
    if (p.outcome === 'pass') { goodIdx = history.indexOf(p.sha); break; }
    if (p.outcome === 'fail') badIdx = history.indexOf(p.sha);
    if (p.outcome === 'skip') break; // tests can't run this far back; stop searching
  }
  if (goodIdx === -1) return save('not-regression', { reason: 'no passing commit found in history', oldestFailing: history[badIdx] });

  // Binary search: history[badIdx] fails, history[goodIdx] passes (badIdx < goodIdx, index grows into the past).
  const skipped = new Set<number>();
  let lo = badIdx, hi = goodIdx;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    // Pick the nearest untried index to mid that isn't known-skippable.
    const order = [mid, ...Array.from({ length: hi - lo - 1 }, (_, k) => [mid + k + 1, mid - k - 1]).flat()].filter((x) => x > lo && x < hi && !skipped.has(x));
    if (order.length === 0) break;
    const p = await run(history[order[0]], `bisect [${lo}..${hi}]`);
    if (p.outcome === 'pass') hi = order[0];
    else if (p.outcome === 'fail') lo = order[0];
    else skipped.add(order[0]);
  }
  const culprit = history[lo];
  const ambiguous = hi - lo > 1;
  const meta = git(repoDir, 'show', '-s', '--format=%H%n%an%n%ae%n%aI%n%s', culprit).split('\n');
  save('verified', {
    culprit: { sha: meta[0], author: meta[1], email: meta[2], date: meta[3], subject: meta[4] },
    lastGood: history[hi],
    ambiguous,
    ambiguousRange: ambiguous ? history.slice(lo, hi).reverse() : undefined,
    distanceFromFix: lo + 1,
  });
  log(`${id}: culprit ${culprit.slice(0, 9)} "${meta[4]}"${ambiguous ? ' (ambiguous range)' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
