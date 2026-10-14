import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import type { TraceHop } from "@trace/core";
import { z } from "zod";
import { describeLeads, findLeads } from "./leads.ts";
import { costOf, SUPPORTS_FALLBACK, type Tier } from "./models.ts";
import type { Sandbox } from "./sandbox.ts";
import { describeRun } from "./sandbox.ts";
import { matching, runTestFile, type TestRun } from "./tests.ts";

export type BugReport = { title: string; body: string };

export type Finding = {
  rootCause: { symbol: string; file: string; line: number; summary: string };
  path: TraceHop[];
  testFile: string;
  /** The tests in testFile that reproduce the bug (they fail at HEAD on an assertion). */
  testNames: string[];
  files: Map<string, string>;
  /** Unified diff of the fix the agent proposed. */
  fixDiff: string;
  /** The test passed with the fix applied. */
  fixVerified: boolean;
  headRun: TestRun;
};

export type InvestigateResult =
  | { ok: true; finding: Finding; usage: Usage }
  | { ok: false; reason: string; usage: Usage };

export type Usage = { model: string; inputTokens: number; outputTokens: number; requests: number; costUsd: number };

const SYSTEM = `You investigate bug reports for Trace. Someone who isn't an engineer reported a bug in the product built from this repository. Your job is to find where the bug comes from in the code and write a small automated test that reproduces it.

The repository is checked out at the commit where the bug was reported. You can browse the code, search it, read its git history (only commits up to this one), write new test files, and run tests. You can't edit existing source files or run arbitrary commands.

What a good result looks like:
- Be economical: read the parts of files you need rather than whole files, and search before you read.
- The root cause is the first place in the code where things go wrong, not where the symptom shows up. Follow the data from what the user did to the point where a value becomes wrong.
- The test exercises that code directly, with the smallest realistic input, in the repository's existing test style and runner. Put it next to the code's existing tests, in a new file.
- The test fails now because the behavior is wrong: an assertion about what the user expected. A test that fails because of an import error, a missing function, or a crash in the test setup doesn't count.
- The test should pass once the bug is fixed, so assert the correct behavior, not the buggy one. Don't depend on the current date, time zone, network, or randomness unless you control them in the test.
- Prefer testing behavior that existed before the bug was introduced, using functions and modules that have been in the codebase for a while. Trace will run your test against older commits to find the change that broke things, so a test that relies on brand-new APIs can't do that.
- Test the root cause you found, at the level where it goes wrong. If the bug is that a function returns the wrong value, call that function; don't test a component further down the line through heavy mocking, because a fix to the root cause may not change what such a test sees.
- Assert only what the report says is wrong. Don't pin down details the report doesn't mention: a reasonable fix might do them differently.

Recent history is often the fastest lead: if the report says something used to work, look at recent commits touching the relevant code.

When the test fails for the right reason, call submit with the smallest fix to the source that would resolve the root cause. Trace applies that fix temporarily and checks that your test fails without it and passes with it; that's how it knows the test and the diagnosis match. The fix is only a check: it's thrown away, and Trace never commits it. If something doesn't hold up you'll get the output back and can keep going.`;

export async function investigate(
  sandbox: Sandbox,
  report: BugReport,
  tier: Tier,
  opts: { client?: Anthropic; maxIterations?: number; context?: string; onEvent?: (e: string) => void } = {},
): Promise<InvestigateResult> {
  const client = opts.client ?? new Anthropic();
  const log = opts.onEvent ?? (() => {});
  const usage: Usage = { model: tier.model, inputTokens: 0, outputTokens: 0, requests: 0, costUsd: 0 };
  let finding: Finding | null = null;
  let submits = 0;
  // Fixing a bug is harder than finding it. After this many fixes that don't make the test pass,
  // a test that reproduces the bug is accepted anyway, marked as unverified.
  const MAX_FIX_REJECTIONS = 2;
  let fixRejections = 0;

  // Tool errors go back to the model as text so it can recover.
  const guard =
    <A>(name: string, fn: (a: A) => string | Promise<string>) =>
    async (a: A) => {
      log(`${name} ${summarize(a)}`);
      let out: string;
      try {
        out = await fn(a);
      } catch (e) {
        out = `error: ${(e as Error).message}`;
      }
      if (name === "run_test" || name === "submit" || out.startsWith("error:")) log(`  → ${out.split("\n").slice(0, 6).join(" | ").slice(0, 400)}`);
      return out;
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
        fix: z
          .array(
            z.object({
              path: z.string().describe("Source file to change"),
              search: z.string().describe("Exact text to replace, copied from the file; must appear exactly once"),
              replace: z.string(),
            }),
          )
          .min(1)
          .describe("The smallest change to the source that resolves the root cause. Used only to check the test; never committed."),
      }),
      run: guard("submit", async (a) => {
        submits++;
        const testFile = a.test_file;
        if (!sandbox.written.has(testFile)) return `${testFile} isn't a file you wrote with write_test_file.`;
        const run = matching(await runTestFile(sandbox.root, testFile, { timeoutSec: 300, setup: sandbox.setup }), a.test_names);
        const reproducing = run.cases.filter((c) => c.status === "failed" && c.assertion);
        if (!run.ran || reproducing.length === 0) {
          const verdict = !run.ran ? "the test file didn't run" : "none of the named tests fail on an assertion";
          return `Not accepted: ${verdict}.\n${describeRun(run)}\nFix the test and submit again.`;
        }
        // The test has to pass once the root cause is fixed, or it isn't testing that root cause.
        const names = reproducing.map((c) => c.name);
        const withFix = await sandbox.withEdits(a.fix, async () =>
          matching(await runTestFile(sandbox.root, testFile, { names, timeoutSec: 300, setup: sandbox.setup }), names),
        );
        if (!withFix.ok) return `Not accepted: your fix couldn't be applied: ${withFix.error}. Fix it and submit again.`;
        const stillFailing = withFix.result.cases.filter((c) => c.status !== "passed");
        const verified = withFix.result.ran && stillFailing.length === 0;
        if (!verified && fixRejections >= MAX_FIX_REJECTIONS) {
          finding = { rootCause: a.root_cause, path: a.path, testFile, testNames: names, files: new Map(sandbox.written), headRun: run, fixDiff: withFix.diff, fixVerified: false };
          log(`  accepted without a working fix after ${fixRejections} tries`);
          return "Accepted (your fix didn't make the test pass, so the diagnosis is marked unverified). You're done; reply with a one-line summary.";
        }
        if (!verified) {
          fixRejections++;
          return [
            `Not accepted: with your fix applied, the test still doesn't pass.`,
            describeRun(withFix.result),
            `Either the test checks something other than the root cause you described (for example a different layer, or details the report doesn't mention), or the fix doesn't resolve it. Rework whichever is wrong and submit again.`,
          ].join("\n");
        }
        finding = {
          rootCause: a.root_cause,
          path: a.path,
          testFile,
          testNames: names,
          files: new Map(sandbox.written),
          headRun: run,
          fixDiff: withFix.diff,
          fixVerified: true,
        };
        log(`  fix checked: test fails without it, passes with it`);
        return "Accepted. You're done; reply with a one-line summary.";
      }),
    }),
  ];

  const leads = describeLeads(findLeads(sandbox.root, `${report.title}\n${report.body}`));
  const fallback = SUPPORTS_FALLBACK[tier.model];
  const params: Omit<BetaToolRunnerParams, "messages" | "stream"> & { stream?: false } = {
    model: tier.model,
    max_tokens: 16000,
    max_iterations: opts.maxIterations ?? 50,
    system: SYSTEM,
    output_config: { effort: tier.effort },
    cache_control: { type: "ephemeral" },
    // Old tool results (file reads, searches) are the bulk of every request; clear them once
    // the conversation gets long, keeping the most recent few.
    context_management: {
      edits: [
        {
          type: "clear_tool_uses_20250919",
          trigger: { type: "input_tokens", value: 40_000 },
          keep: { type: "tool_uses", value: 6 },
          clear_at_least: { type: "input_tokens", value: 10_000 },
          exclude_tools: ["submit"],
        },
      ],
    },
    betas: ["context-management-2025-06-27", ...(fallback ? ["server-side-fallback-2026-07-01"] : [])],
    ...(fallback ? { fallbacks: "default" as const } : {}),
    tools,
  };
  let messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        `Bug report\n\nTitle: ${report.title}\n\n${report.body}`,
        opts.context ? `\n\nAn engineer added: ${opts.context}` : "",
        leads ? `\n\n${leads}` : "",
      ].join(""),
    },
  ];

  // Models sometimes stop without an accepted test, after a rejected submit or when they lose
  // confidence. Before giving up (and paying for a bigger model), ask them to keep going.
  const MAX_NUDGES = 2;
  let last: Anthropic.Beta.BetaMessage | undefined;
  for (let nudge = 0; ; nudge++) {
    const runner = client.beta.messages.toolRunner({ ...params, messages });
    for await (const message of runner) {
      last = message;
      usage.requests++;
      usage.inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
      usage.outputTokens += message.usage.output_tokens;
      usage.costUsd += costOf(tier.model, message.usage);
      if (message.stop_reason === "refusal") return { ok: false, reason: "the model declined the request", usage };
      if (finding) break;
      if (usage.costUsd >= tier.budgetUsd) {
        return { ok: false, reason: `Couldn't reproduce within the $${tier.budgetUsd.toFixed(2)} budget for ${tier.model}.`, usage };
      }
    }
    if (finding || nudge >= MAX_NUDGES || !last || last.stop_reason !== "end_turn") break;
    log(`nudging the model to continue (${nudge + 1}/${MAX_NUDGES})`);
    // The runner's history ends with our tool results; add the model's final reply unchanged,
    // then the nudge.
    messages = [
      ...runner.params.messages,
      { role: "assistant", content: last.content },
      {
        role: "user",
        content:
          submits === 0
            ? "You haven't submitted a test yet. Keep investigating: write a test that fails at this commit because of the bug, run it, and submit it."
            : "Your last submission wasn't accepted. Read the output it returned, fix the test so it fails on an assertion about the correct behavior, and submit again.",
      },
    ];
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
