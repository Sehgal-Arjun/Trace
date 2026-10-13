import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { TraceHop } from "@trace/core";
import { z } from "zod";
import type { Sandbox } from "./sandbox.ts";
import { describeRun } from "./sandbox.ts";
import { matching, runTestFile, type TestRun } from "./tests.ts";

export const MODEL = "claude-opus-5-5";

export type BugReport = { title: string; body: string };

export type Finding = {
  rootCause: { symbol: string; file: string; line: number; summary: string };
  path: TraceHop[];
  testFile: string;
  /** The tests in testFile that reproduce the bug (they fail at HEAD on an assertion). */
  testNames: string[];
  files: Map<string, string>;
  headRun: TestRun;
};

export type InvestigateResult =
  | { ok: true; finding: Finding; usage: Usage }
  | { ok: false; reason: string; usage: Usage };

type Usage = { inputTokens: number; outputTokens: number; requests: number };

const SYSTEM = `You investigate bug reports for Trace. Someone who isn't an engineer reported a bug in the product built from this repository. Your job is to find where the bug comes from in the code and write a small automated test that reproduces it.

The repository is checked out at the commit where the bug was reported. You can browse the code, search it, read its git history (only commits up to this one), write new test files, and run tests. You can't edit existing source files or run arbitrary commands.

What a good result looks like:
- The root cause is the first place in the code where things go wrong, not where the symptom shows up. Follow the data from what the user did to the point where a value becomes wrong.
- The test exercises that code directly, with the smallest realistic input, in the repository's existing test style and runner. Put it next to the code's existing tests, in a new file.
- The test fails now because the behavior is wrong: an assertion about what the user expected. A test that fails because of an import error, a missing function, or a crash in the test setup doesn't count.
- The test should pass once the bug is fixed, so assert the correct behavior, not the buggy one. Don't depend on the current date, time zone, network, or randomness unless you control them in the test.
- Prefer testing behavior that existed before the bug was introduced, using functions and modules that have been in the codebase for a while. Trace will run your test against older commits to find the change that broke things, so a test that relies on brand-new APIs can't do that.

Recent history is often the fastest lead: if the report says something used to work, look at recent commits touching the relevant code.

When the test fails for the right reason, call submit. Trace will run it itself; if it doesn't hold up you'll get the output back and can keep going.`;

export async function investigate(
  sandbox: Sandbox,
  report: BugReport,
  opts: { client?: Anthropic; maxIterations?: number; onEvent?: (e: string) => void } = {},
): Promise<InvestigateResult> {
  const client = opts.client ?? new Anthropic();
  const log = opts.onEvent ?? (() => {});
  const usage: Usage = { inputTokens: 0, outputTokens: 0, requests: 0 };
  let finding: Finding | null = null;
  let submits = 0;

  // Tool errors go back to the model as text so it can recover.
  const guard =
    <A>(name: string, fn: (a: A) => string | Promise<string>) =>
    async (a: A) => {
      log(`${name} ${summarize(a)}`);
      try {
        return await fn(a);
      } catch (e) {
        return `error: ${(e as Error).message}`;
      }
    };

  const tools = [
    betaZodTool({
      name: "list_files",
      description: "List tracked files under a directory, optionally filtered by a regular expression on the path.",
      inputSchema: z.object({
        dir: z.string().describe("Directory relative to the repository root, e.g. 'packages/app/src'").default("."),
        pattern: z.string().optional().describe("Regular expression the path must match, e.g. 'report.*\\.ts$'"),
      }),
      run: guard("list_files", (a) => sandbox.listFiles(a.dir, a.pattern)),
    }),
    betaZodTool({
      name: "search",
      description: "Search tracked files with an extended regular expression (git grep). Returns file:line:text, at most 20 matches per file.",
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().default(".").describe("Directory or file to search in"),
        ignore_case: z.boolean().default(false),
      }),
      run: guard("search", (a) => sandbox.grep(a.pattern, a.path, { ignoreCase: a.ignore_case })),
    }),
    betaZodTool({
      name: "read_file",
      description: "Read a file with line numbers, up to 400 lines at a time.",
      inputSchema: z.object({
        path: z.string(),
        start_line: z.number().int().min(1).default(1),
        end_line: z.number().int().min(1).optional(),
      }),
      run: guard("read_file", (a) => sandbox.readFile(a.path, a.start_line, a.end_line)),
    }),
    betaZodTool({
      name: "git_log",
      description: "List commits in this checkout's history, newest first. Filter by a path and/or a message search.",
      inputSchema: z.object({
        path: z.string().optional(),
        grep: z.string().optional().describe("Case-insensitive search in commit messages"),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      run: guard("git_log", (a) => sandbox.gitLog({ path: a.path, grep: a.grep, limit: a.limit })),
    }),
    betaZodTool({
      name: "git_show",
      description: "Show a commit's message and diff, optionally limited to one path.",
      inputSchema: z.object({ commit: z.string(), path: z.string().optional() }),
      run: guard("git_show", (a) => sandbox.gitShow(a.commit, a.path)),
    }),
    betaZodTool({
      name: "write_test_file",
      description:
        "Create or overwrite a new test file (*.test.ts, *.spec.ts, or under __tests__/) or fixture file. Existing files in the repository can't be modified.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      run: guard("write_test_file", (a) => sandbox.writeTestFile(a.path, a.content)),
    }),
    betaZodTool({
      name: "run_test",
      description:
        "Run one test file with the repository's test runner. Optionally run only tests whose names contain one of the given strings. Reports each test and whether a failure was an assertion or a crash.",
      inputSchema: z.object({ path: z.string(), test_names: z.array(z.string()).optional() }),
      run: guard("run_test", (a) => sandbox.runTest(a.path, a.test_names)),
    }),
    betaZodTool({
      name: "submit",
      description: "Submit the root cause and the reproducing test once the test fails at this commit on an assertion.",
      inputSchema: z.object({
        root_cause: z.object({
          symbol: z.string().describe("Function or component where things first go wrong, e.g. 'applyDiscount(cart, discount)'"),
          file: z.string(),
          line: z.number().int().min(1),
          summary: z
            .string()
            .describe("One or two plain sentences an engineer can act on. Wrap identifiers in backticks."),
        }),
        path: z
          .array(
            z.object({
              layer: z.enum(["ui", "client", "network", "server", "data"]),
              title: z.string().describe("e.g. 'saveCart(cart)' or 'POST /api/cart/save'"),
              location: z.string().describe("file:line"),
              value: z.string().optional().describe("The value being followed at this step, e.g. 'total 71.40'"),
            }),
          )
          .describe("Steps from what the user did down to the root cause, in order. Don't include the root cause itself."),
        test_file: z.string(),
        test_names: z.array(z.string()).min(1).describe("Names of the tests in test_file that reproduce the bug"),
      }),
      run: guard("submit", async (a) => {
        submits++;
        const testFile = a.test_file;
        if (!sandbox.written.has(testFile)) return `${testFile} isn't a file you wrote with write_test_file.`;
        const run = matching(await runTestFile(sandbox.root, testFile, { timeoutSec: 300 }), a.test_names);
        const reproducing = run.cases.filter((c) => c.status === "failed" && c.assertion);
        if (!run.ran || reproducing.length === 0) {
          const verdict = !run.ran ? "the test file didn't run" : "none of the named tests fail on an assertion";
          return `Not accepted: ${verdict}.\n${describeRun(run)}\nFix the test and submit again.`;
        }
        finding = {
          rootCause: a.root_cause,
          path: a.path,
          testFile,
          testNames: reproducing.map((c) => c.name),
          files: new Map(sandbox.written),
          headRun: run,
        };
        return "Accepted. You're done; reply with a one-line summary.";
      }),
    }),
  ];

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: opts.maxIterations ?? 80,
    system: SYSTEM,
    output_config: { effort: "high" },
    cache_control: { type: "ephemeral" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    tools,
    messages: [
      {
        role: "user",
        content: `Bug report\n\nTitle: ${report.title}\n\n${report.body}`,
      },
    ],
  });

  let last: Anthropic.Beta.BetaMessage | undefined;
  for await (const message of runner) {
    last = message;
    usage.requests++;
    usage.inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += message.usage.output_tokens;
    if (message.stop_reason === "refusal") return { ok: false, reason: "the model declined the request", usage };
    if (finding) break;
  }

  if (finding) return { ok: true, finding, usage };
  const why =
    last?.stop_reason === "max_tokens"
      ? "a response hit the token limit"
      : submits === 0
        ? "it stopped without submitting a test"
        : `none of its ${submits} submitted tests failed on an assertion`;
  return { ok: false, reason: `Couldn't reproduce: ${why}.`, usage };
}

function summarize(a: unknown): string {
  const s = JSON.stringify(a);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}
