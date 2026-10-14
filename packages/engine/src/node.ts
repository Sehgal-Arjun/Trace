import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

// Older commits often want an older Node: their lockfile pins packages whose `engines` refuse a
// newer one, and some native modules only build for the Node they were released against. When
// several Node versions are installed side by side, each install and test command runs on the
// one the commit asks for.

/** Installed Node versions as major → bin directory. */
function installed(): Map<number, string> {
  const found = new Map<number, string>();
  // Explicit list first: TRACE_NODE_BINS="/opt/node18/bin:/opt/node22/bin".
  for (const dir of (process.env.TRACE_NODE_BINS ?? "").split(delimiter).filter(Boolean)) {
    const v = versionOf(dir);
    if (v) found.set(v, dir);
  }
  // GitHub Actions' tool cache, filled by actions/setup-node: <cache>/node/<version>/<arch>/bin.
  const cache = process.env.RUNNER_TOOL_CACHE && join(process.env.RUNNER_TOOL_CACHE, "node");
  if (cache && existsSync(cache)) {
    for (const version of readdirSync(cache)) {
      const major = Number(version.split(".")[0]);
      for (const arch of readdirSync(join(cache, version))) {
        const bin = join(cache, version, arch, "bin");
        if (major && existsSync(join(bin, "node")) && !found.has(major)) found.set(major, bin);
      }
    }
  }
  return found;
}

function versionOf(bin: string): number | null {
  const m = bin.match(/node[-@]?v?(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** The Node major versions a commit says it supports, newest first, or null if it doesn't say. */
export function wantedMajors(root: string): number[] | null {
  for (const f of [".nvmrc", ".node-version"]) {
    const p = join(root, f);
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").trim().match(/^v?(\d+)/);
      if (m) return [Number(m[1])];
    }
  }
  const pj = join(root, "package.json");
  if (!existsSync(pj)) return null;
  const range: string | undefined = JSON.parse(readFileSync(pj, "utf8")).engines?.node;
  if (!range) return null;
  const ok = [...Array(30).keys()].map((i) => i + 10).filter((major) => satisfies(major, range));
  return ok.length ? ok.reverse() : null;
}

/** Whether `major`.x satisfies a semver range, for the range shapes package.json engines use. */
export function satisfies(major: number, range: string): boolean {
  return range.split("||").some((alt) => {
    const parts = alt.trim();
    const hyphen = parts.match(/^v?(\d+)[^\s]*\s+-\s+v?(\d+)/);
    if (hyphen) return major >= Number(hyphen[1]) && major <= Number(hyphen[2]);
    return parts
      .split(/\s+/)
      .filter(Boolean)
      .every((c) => {
        const m = c.match(/^(>=|<=|>|<|\^|~|=)?v?(\d+|x|\*)/);
        if (!m) return true;
        if (m[2] === "x" || m[2] === "*") return true;
        const n = Number(m[2]);
        switch (m[1]) {
          case ">=":
            return major >= n;
          case ">":
            return major > n;
          case "<=":
            return major <= n;
          case "<":
            return major < n;
          default:
            return major === n; // ^n, ~n, =n and bare n all pin the major
        }
      });
  });
}

/**
 * Environment for running a command at this checkout: PATH with the best installed Node first.
 * Empty when the commit doesn't ask for a version or no suitable one is installed.
 */
export function nodeEnv(root: string): Record<string, string> {
  const wanted = wantedMajors(root);
  if (!wanted) return {};
  const have = installed();
  const pick = wanted.find((m) => have.has(m));
  if (pick === undefined) return {};
  return { PATH: `${have.get(pick)}${delimiter}${process.env.PATH ?? ""}` };
}
