import { git, tryGit } from "./shell.ts";

// A cheap first pass over the repository, done without the model: files whose contents match
// words from the report, ranked, plus recent commits that touched them. The agent starts from
// this list instead of spending steps finding its bearings.

const STOPWORDS = new Set(
  `the and for that this with have from they them then than when what were will would there their about after again before being
  could should which while where into only just like also some more most much very even still every other because doesn does didn
  isn wasn aren cant cannot dont used using use make made getting gets got want wanted happen happens happened instead anymore
  shows showing shown show stays stay stuck work works working worked page screen click clicked button app thing things time
  something someone anything nothing always never sometimes today yesterday update updated updates latest version new old`.split(/\s+/),
);

const SOURCE_RE = /\.(c|m)?[jt]sx?$|\.(vue|svelte)$/;
const SKIP_RE = /(^|\/)(\.[^/]+|node_modules|dist|build|coverage|vendor|__generated__|locales?|i18n|translations?)\/|\.min\.[cm]?js$/;
const TEST_RE = /(\.|_)(test|spec)\.|(^|\/)__tests__\//;

export function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  const seen = new Set<string>();
  for (const w of words) {
    const stem = w.replace(/(ing|ed|es|s)$/, "");
    if (STOPWORDS.has(w) || STOPWORDS.has(stem) || stem.length < 4) continue;
    seen.add(stem);
  }
  return [...seen].slice(0, 12);
}

export type Leads = { keywords: string[]; files: { path: string; hits: string[]; score: number; recentCommits: number }[]; commits: string[] };

export function findLeads(root: string, report: string, opts: { files?: number; days?: number } = {}): Leads {
  const words = keywords(report);
  const sources = git(root, "ls-files").split("\n").filter((f) => SOURCE_RE.test(f) && !SKIP_RE.test(f) && !TEST_RE.test(f));
  const isSource = new Set(sources);
  const hits = new Map<string, Set<string>>();
  const weight = new Map<string, number>();
  for (const w of words) {
    const out = tryGit(root, "grep", "-l", "-i", "-I", "-e", w);
    const matches = (out ?? "").split("\n").filter((f) => isSource.has(f));
    // A word that appears in half the codebase says nothing about where the bug is.
    if (matches.length === 0 || matches.length > sources.length / 4) continue;
    // Rarer words count for more (inverse document frequency).
    weight.set(w, Math.log(sources.length / matches.length));
    for (const f of matches) {
      if (!hits.has(f)) hits.set(f, new Set());
      hits.get(f)!.add(w);
    }
  }
  // A word in the path ("reports/", "Spending") is a much stronger signal than one in the body.
  const scoreOf = (path: string, ws: Set<string>) => {
    const p = path.toLowerCase();
    let s = 0;
    for (const w of ws) s += (weight.get(w) ?? 0) * (p.includes(w) ? 3 : 1);
    return s;
  };

  const since = `${opts.days ?? 120} days ago`;
  const ranked = [...hits]
    .map(([path, ws]) => ({ path, hits: [...ws], score: scoreOf(path, ws) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.files ?? 12)
    .map((f) => ({ ...f, recentCommits: Number(tryGit(root, "rev-list", "--count", `--since=${since}`, "HEAD", "--", f.path) ?? 0) }));

  const paths = ranked.map((f) => f.path);
  const commits = paths.length
    ? git(root, "log", "HEAD", `--since=${since}`, "--max-count=15", "--format=%h %ad %s", "--date=short", "--", ...paths)
        .split("\n")
        .filter(Boolean)
    : [];
  return { keywords: words, files: ranked, commits };
}

export function describeLeads(l: Leads): string {
  if (l.files.length === 0) return "";
  const files = l.files.map((f) => `- ${f.path}  (matches: ${f.hits.join(", ")}; ${f.recentCommits} recent commits)`).join("\n");
  const commits = l.commits.length ? `\n\nRecent commits touching those files:\n${l.commits.map((c) => `- ${c}`).join("\n")}` : "";
  return `Leads from a keyword search of the code (words: ${l.keywords.join(", ")}). These are guesses to start from, not conclusions:\n${files}${commits}`;
}
