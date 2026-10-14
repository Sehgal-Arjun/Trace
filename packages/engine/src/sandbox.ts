import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { git, tryGit } from "./shell.ts";
import type { Setup } from "./setup.ts";
import { matching, runTestFile, type TestRun } from "./tests.ts";

const TEST_FILE_RE = /(\.|_)(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\//;
const FIXTURE_RE = /(^|\/)(__fixtures__|fixtures?|__mocks__)\//;
// Small outputs keep every later request cheap: everything returned stays in the conversation.
const MAX_LINES = 200;
const MAX_OUT = 6_000;

/**
 * The agent's whole view of the repository: one checkout at the commit under
 * investigation. Reads are confined to tracked files, history is limited to
 * ancestors of HEAD (so a later fix is never visible), and writes are limited
 * to test and fixture files the agent creates.
 */
export class Sandbox {
  readonly root: string;
  readonly head: string;
  /** Files the agent wrote, so they can be collected and cleaned up. */
  readonly written = new Map<string, string>();
  lastRun?: { file: string; result: TestRun };
  readonly setup?: Setup;

  constructor(root: string, setup?: Setup) {
    this.root = realpathSync(root);
    this.setup = setup;
    this.head = git(this.root, "rev-parse", "HEAD");
  }

  /** Resolves a repo-relative path, rejecting anything outside the checkout or inside .git. */
  private resolvePath(p: string): string {
    const abs = resolve(this.root, p);
    const rel = relative(this.root, abs);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`path is outside the repository: ${p}`);
    if (rel === ".git" || rel.startsWith(`.git${sep}`)) throw new Error("the .git directory is off limits");
    if (existsSync(abs)) {
      const real = realpathSync(abs);
      if (real !== this.root && !real.startsWith(this.root + sep)) throw new Error(`path resolves outside the repository: ${p}`);
    }
    return rel;
  }

  listFiles(dir = ".", pattern?: string): string {
    const rel = this.resolvePath(dir);
    const files = git(this.root, "ls-files", "--", rel || ".").split("\n").filter(Boolean);
    const matched = pattern ? files.filter((f) => new RegExp(pattern).test(f)) : files;
    const shown = matched.slice(0, 150);
    return shown.join("\n") + (matched.length > shown.length ? `\n… ${matched.length - shown.length} more; narrow the directory or pattern` : "");
  }

  grep(pattern: string, path = ".", opts: { ignoreCase?: boolean } = {}): string {
    const rel = this.resolvePath(path);
    const out = tryGit(this.root, "grep", "-n", "-I", "-E", ...(opts.ignoreCase ? ["-i"] : []), "--max-count=8", "-e", pattern, "--", rel || ".");
    if (!out) return "no matches";
    return clip(out);
  }

  readFile(path: string, start = 1, end?: number): string {
    const rel = this.resolvePath(path);
    const abs = join(this.root, rel);
    if (!existsSync(abs)) return `no such file: ${path}`;
    const lines = readFileSync(abs, "utf8").split("\n");
    const from = Math.max(1, start);
    const to = Math.min(lines.length, end ?? from + MAX_LINES - 1, from + MAX_LINES - 1);
    const body = lines
      .slice(from - 1, to)
      .map((l, i) => `${String(from + i).padStart(5)}  ${l}`)
      .join("\n");
    return `${rel} (lines ${from}-${to} of ${lines.length})\n${body}`;
  }

  /** Commits reachable from HEAD, newest first, optionally touching a path or matching a message. */
  gitLog(opts: { path?: string; grep?: string; limit?: number } = {}): string {
    const args = ["log", "HEAD", `--max-count=${Math.min(opts.limit ?? 30, 100)}`, "--format=%h %ad %an  %s", "--date=short"];
    if (opts.grep) args.push(`--grep=${opts.grep}`, "-i");
    if (opts.path) args.push("--", this.resolvePath(opts.path));
    return clip(git(this.root, ...args) || "no commits");
  }

  /** A commit's diff, only if it's an ancestor of HEAD. */
  gitShow(rev: string, path?: string): string {
    const sha = tryGit(this.root, "rev-parse", "--verify", `${rev}^{commit}`);
    if (!sha) return `unknown commit: ${rev}`;
    if (tryGit(this.root, "merge-base", "--is-ancestor", sha, "HEAD") === null) return `${rev} is not in this checkout's history`;
    const args = ["show", "--stat", "--patch", "--format=%H%nAuthor: %an <%ae>%nDate: %ad%n%n%s%n%n%b", sha];
    if (path) args.push("--", this.resolvePath(path));
    return clip(git(this.root, ...args));
  }

  /** Creates or replaces a test or fixture file. Existing source files can't be changed. */
  writeTestFile(path: string, content: string): string {
    const rel = this.resolvePath(path);
    if (!TEST_FILE_RE.test(rel) && !FIXTURE_RE.test(rel)) throw new Error("only test files (*.test.ts, __tests__/) and fixtures can be written");
    const tracked = tryGit(this.root, "ls-files", "--error-unmatch", "--", rel) !== null;
    if (tracked && !this.written.has(rel)) throw new Error(`${rel} already exists in the repository; write a new file next to it instead`);
    const abs = join(this.root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    this.written.set(rel, content);
    return `wrote ${rel} (${content.split("\n").length} lines)`;
  }

  async runTest(path: string, names?: string[]): Promise<string> {
    const rel = this.resolvePath(path);
    if (!existsSync(join(this.root, rel))) return `no such file: ${path}`;
    const result = matching(await runTestFile(this.root, rel, { timeoutSec: 300, setup: this.setup }), names);
    this.lastRun = { file: rel, result };
    return describeRun(result);
  }

  /** Removes everything the agent wrote, restoring the checkout. */
  cleanup(): void {
    for (const rel of this.written.keys()) rmSync(join(this.root, rel), { force: true });
    this.written.clear();
    this.lastRun = undefined;
  }
}

export function describeRun(r: TestRun): string {
  if (!r.ran) return `The test file did not run (${r.seconds}s):\n${clip(r.loadError ?? r.output, 4000)}`;
  const lines = r.cases.map((c) =>
    c.status === "passed"
      ? `PASS  ${c.name}`
      : `FAIL  ${c.name}  [${c.assertion ? "assertion" : "crash, not an assertion"}]\n${indent(clip(c.message ?? "", 1500))}`,
  );
  const failed = r.cases.filter((c) => c.status === "failed").length;
  return `${failed} of ${r.cases.length} failed (${r.seconds}s)\n${lines.join("\n")}`;
}

function clip(s: string, n = MAX_OUT): string {
  return s.length > n ? `${s.slice(0, n)}\n… truncated (${s.length - n} more characters)` : s;
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");
}
