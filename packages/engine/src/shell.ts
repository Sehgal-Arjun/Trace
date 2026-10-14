import { execFileSync, spawn } from "node:child_process";

export type ShResult = { code: number; out: string; timedOut: boolean };

/**
 * Runs a shell command in its own process group and kills the whole group when
 * the command exits or times out. Test runners and builds start workers (and
 * sometimes watchers that never exit) which would otherwise outlive the shell
 * and hold its pipes open.
 */
export function sh(
  cmd: string,
  cwd: string,
  opts: { env?: Record<string, string>; timeoutSec?: number } = {},
): Promise<ShResult> {
  const timeoutSec = opts.timeoutSec ?? 900;
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      cwd,
      env: { ...process.env, CI: "1", HUSKY: "0", ...opts.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const keep = (b: Buffer) => {
      chunks.push(b);
      size += b.length;
      while (size > 4 * 1024 * 1024 && chunks.length > 1) size -= chunks.shift()!.length; // keep the tail
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let timedOut = false;
    const killGroup = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutSec * 1000);
    child.on("exit", killGroup);
    child.on("close", (code) => {
      clearTimeout(timer);
      killGroup();
      const out = Buffer.concat(chunks).toString("utf8");
      resolve({ code: timedOut ? -1 : (code ?? -1), out: timedOut ? `${out}\n[timed out after ${timeoutSec}s]` : out, timedOut });
    });
  });
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
}

/** Like git() but returns null instead of throwing on a non-zero exit. */
export function tryGit(cwd: string, ...args: string[]): string | null {
  try {
    // Quiet: a failure here is an answer ("not tracked", "not an ancestor"), not an error to print.
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
