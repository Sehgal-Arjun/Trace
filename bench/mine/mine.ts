// Mines candidate regression bugs from GitHub: closed issues fixed by a merged PR
// that changed both source code and a unit test. Writes bench/data/candidates.jsonl.
//
// Usage: node bench/mine/mine.ts [--since 2025-04-01] [--max-issues 600] owner/repo ...

import { execFileSync } from 'node:child_process';
import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'candidates.jsonl');
const TOKEN = execFileSync('gh', ['auth', 'token']).toString().trim();

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const SINCE = opt('--since', '2025-04-01');
const MAX_ISSUES = Number(opt('--max-issues', '600'));
const REPOS = args;

// Wording that suggests the behavior used to work.
const REGRESSION_RE =
  /\bregress|used to work|worked (fine |correctly |properly )?(before|previously|in v?\d|on v?\d|until)|was working|no longer|stopped working|(broke|broken|breaks) (in|after|since)|after (the )?(latest |recent )?(updat|upgrad)|since (the )?(latest |last |recent )?(updat|upgrad|v?\d+\.\d+)|in (the )?previous version/i;

const TEST_FILE_RE = /(\.|_)(test|spec)\.[cm]?[jt]sx?$|\/__tests__\//;
const E2E_RE = /(^|\/)(e2e|playwright|cypress|integration-tests?)(\/|$)|\.e2e\./i;
const SOURCE_RE = /\.(c|m)?[jt]sx?$|\.(vue|svelte)$/;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let json: { data?: T; errors?: unknown } = {};
    try {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      json = (await res.json()) as typeof json;
      if (json.data && !json.errors) return json.data;
    } catch (e) {
      json = { errors: String(e) };
    }
    if (attempt >= 5) throw new Error(JSON.stringify(json.errors ?? json).slice(0, 500));
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

type IssueNode = {
  number: number;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  closedAt: string;
  labels: { nodes: { name: string }[] };
  closedByPullRequestsReferences: {
    nodes: { number: number; merged: boolean; mergedAt: string | null; baseRefName: string; repository: { nameWithOwner: string } }[];
  };
};

const ISSUES_Q = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue {
        number title body url createdAt closedAt
        labels(first: 20) { nodes { name } }
        closedByPullRequestsReferences(first: 5, includeClosedPrs: false) {
          nodes { number merged mergedAt baseRefName repository { nameWithOwner } }
        }
      }
    }
  }
}`;

const PR_Q = `
query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $n) {
      number title url body mergedAt baseRefName
      mergeCommit { oid }
      commits(first: 1) { totalCount }
      baseRefOid
      files(first: 100) { totalCount nodes { path additions deletions changeType } }
    }
  }
}`;

type PR = {
  number: number;
  title: string;
  url: string;
  body: string;
  mergedAt: string;
  baseRefName: string;
  baseRefOid: string;
  mergeCommit: { oid: string } | null;
  commits: { totalCount: number };
  files: { totalCount: number; nodes: { path: string; additions: number; deletions: number; changeType: string }[] };
};

function seen(): Set<string> {
  const s = new Set<string>();
  if (!existsSync(OUT)) return s;
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    s.add(`${c.repo}#${c.issue.number}`);
  }
  return s;
}

async function mineRepo(repo: string, already: Set<string>) {
  const [owner, name] = repo.split('/');
  const q = `repo:${repo} is:issue is:closed reason:completed created:>=${SINCE} linked:pr`;
  const issues: IssueNode[] = [];
  let after: string | null = null;
  while (issues.length < MAX_ISSUES) {
    const d: { search: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: IssueNode[] } } =
      await gql(ISSUES_Q, { q, after });
    issues.push(...d.search.nodes.filter((n) => n && n.number));
    if (!d.search.pageInfo.hasNextPage) break;
    after = d.search.pageInfo.endCursor;
  }

  let kept = 0;
  const work = issues.filter((i) => !already.has(`${repo}#${i.number}`));
  const handle = async (issue: IssueNode) => {
    const labels = issue.labels.nodes.map((l) => l.name);
    // Skip feature requests and the like.
    if (labels.some((l) => /enhancement|feature|docs|documentation|question/i.test(l)) &&
        !labels.some((l) => /bug|regression/i.test(l))) return;
    const text = `${issue.title}\n${issue.body ?? ''}`;
    const regressionSignal = labels.some((l) => /regression/i.test(l)) || REGRESSION_RE.test(text);
    const bugLabel = labels.some((l) => /bug|regression|defect/i.test(l));
    if (!regressionSignal && !bugLabel) return;

    const prRef = issue.closedByPullRequestsReferences.nodes.find((p) => p.merged && p.repository.nameWithOwner.toLowerCase() === repo.toLowerCase());
    if (!prRef) return;
    const { repository } = await gql<{ repository: { pullRequest: PR } }>(PR_Q, { owner, name, n: prRef.number });
    const pr = repository.pullRequest;
    if (!pr?.mergeCommit) return;

    const files = pr.files.nodes;
    const tests = files.filter((f) => TEST_FILE_RE.test(f.path) && !E2E_RE.test(f.path) && f.changeType !== 'DELETED');
    const sources = files.filter((f) => SOURCE_RE.test(f.path) && !TEST_FILE_RE.test(f.path) && !E2E_RE.test(f.path));
    if (tests.length === 0 || sources.length === 0) return;
    // Big refactors make poor benchmark cases.
    const srcLines = sources.reduce((a, f) => a + f.additions + f.deletions, 0);
    if (srcLines > 400 || pr.files.totalCount > 40) return;

    const rec = {
      repo,
      regressionSignal,
      bugLabel,
      labels,
      issue: {
        number: issue.number,
        url: issue.url,
        title: issue.title,
        body: issue.body,
        createdAt: issue.createdAt,
        closedAt: issue.closedAt,
        images: [...(issue.body ?? '').matchAll(/https:\/\/(?:github\.com\/user-attachments\/assets|user-images\.githubusercontent\.com|private-user-images\.githubusercontent\.com)\/[^\s)"'>]+/g)].map((m) => m[0]),
      },
      fix: {
        pr: pr.number,
        url: pr.url,
        title: pr.title,
        body: pr.body,
        mergedAt: pr.mergedAt,
        baseRefName: pr.baseRefName,
        mergeCommit: pr.mergeCommit.oid,
        commitCount: pr.commits.totalCount,
        testFiles: tests.map((f) => f.path),
        sourceFiles: sources.map((f) => f.path),
        sourceLinesChanged: srcLines,
      },
    };
    appendFileSync(OUT, JSON.stringify(rec) + '\n');
    kept++;
  };
  const safe = (issue: IssueNode) => handle(issue).catch((e) => console.error(`${repo}#${issue.number}: ${(e as Error).message.slice(0, 200)}`));
  for (let i = 0; i < work.length; i += 6) await Promise.all(work.slice(i, i + 6).map(safe));
  console.log(`${repo}: ${issues.length} closed issues with linked PRs, kept ${kept}`);
}

mkdirSync(dirname(OUT), { recursive: true });
const already = seen();
for (const repo of REPOS) {
  try {
    await mineRepo(repo, already);
  } catch (e) {
    console.error(`${repo}: failed — ${(e as Error).message}`);
  }
}
