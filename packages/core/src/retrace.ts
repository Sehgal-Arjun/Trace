import type { RunStatus } from "./runs.ts";

// What Trace does when the ticket behind a run changes, and when it may touch its own PR.
//
// The rule: Trace updates what it owns and asks before touching anything a person has worked on.
// Automatic re-traces happen only when a run failed and the ticket gained information; otherwise
// Trace comments and a person decides.

/** How much a ticket edit changes the bug, as judged by comparing the old and new text. */
export type ChangeSignificance =
  | "cosmetic" // priority, assignee, labels, typos: the bug is the same
  | "new_detail" // more steps, a screenshot or recording, an error message: same bug, more evidence
  | "redescribed"; // the bug itself is different ("actually it only happens on mobile")

export type TicketEvent =
  | { kind: "edited"; significance: ChangeSignificance }
  | { kind: "commented"; body: string; author: string }
  | { kind: "closed"; reason: "duplicate" | "wont_fix" | "fixed" | "other" };

export type RetraceAction =
  | { type: "ignore" }
  /** The run is still working: hand the new detail to the agent. */
  | { type: "feed_detail" }
  /** The run is still working but on the wrong bug: start over, with a person's direction if given. */
  | { type: "restart"; context?: string }
  /** Start a new attempt. `context` is extra direction from a person, passed to the agent. */
  | { type: "retrace"; reason: string; context?: string }
  /** Tell people the ticket changed and offer a re-trace, without doing it. */
  | { type: "suggest_retrace"; reason: string }
  | { type: "cancel"; reason: string }
  | { type: "close_pr"; note: string };

export type Command = { type: "retry" } | { type: "correct"; context: string };

const MENTION = /(^|\s)@trace\b/i;

/** Reads an `@trace …` command from a comment, if there is one. */
export function parseCommand(body: string): Command | null {
  if (!MENTION.test(body)) return null;
  const rest = body.replace(/^[\s\S]*?@trace\b[\s,:]*/i, "").trim();
  if (/^(retry|re-?trace|try again|run again)\b/i.test(rest)) return { type: "retry" };
  if (rest) return { type: "correct", context: rest };
  return null;
}

const IN_PROGRESS: RunStatus[] = ["queued", "tracing", "testing", "bisecting"];
const FAILED: RunStatus[] = ["not_reproduced", "errored"];

export function decide(status: RunStatus, event: TicketEvent, opts: { hasOpenPr: boolean }): RetraceAction {
  const inProgress = IN_PROGRESS.includes(status);
  const failed = FAILED.includes(status);

  if (event.kind === "commented") {
    const cmd = parseCommand(event.body);
    if (cmd?.type === "retry") return inProgress ? { type: "restart" } : { type: "retrace", reason: `${event.author} asked for a retry` };
    if (cmd?.type === "correct") {
      return inProgress
        ? { type: "restart", context: cmd.context }
        : { type: "retrace", reason: `${event.author} corrected Trace`, context: cmd.context };
    }
    // An ordinary comment can carry new evidence, but whether it does is a judgment call the
    // caller makes by classifying it like an edit; on its own it changes nothing.
    return { type: "ignore" };
  }

  if (event.kind === "closed") {
    if (inProgress) return { type: "cancel", reason: `the ticket was closed (${event.reason.replace("_", " ")})` };
    if (opts.hasOpenPr && (event.reason === "duplicate" || event.reason === "wont_fix")) {
      return { type: "close_pr", note: event.reason === "duplicate" ? "The ticket was closed as a duplicate." : "The ticket was closed as won't fix." };
    }
    // Closed as fixed: the fix can land alongside the test, so leave the PR alone.
    return { type: "ignore" };
  }

  switch (event.significance) {
    case "cosmetic":
      return { type: "ignore" };
    case "new_detail":
      if (inProgress) return { type: "feed_detail" };
      if (failed) return { type: "retrace", reason: "the ticket has new information" };
      return { type: "ignore" };
    case "redescribed":
      if (inProgress) return { type: "restart" };
      if (failed) return { type: "retrace", reason: "the ticket's description of the bug changed" };
      return { type: "suggest_retrace", reason: "the ticket's description of the bug changed since Trace traced it" };
  }
}

/** What's on Trace's PR right now, from GitHub. */
export type PrState = {
  state: "open" | "merged" | "closed";
  /** Login of the author of each commit on the PR's branch. */
  commitAuthors: string[];
  /** Any approval or review comment. */
  reviewStarted: boolean;
};

export type PrUpdate =
  /** Replace the branch: Trace owns everything on it and nobody has reviewed yet. */
  | { type: "force_push" }
  /** Add commits on top so reviewers can see what changed. */
  | { type: "push_commit" }
  /** Don't touch the branch; explain in a comment. */
  | { type: "comment_only"; reason: string }
  /** The PR is done; a new one is needed if anything. */
  | { type: "new_pr" };

export function prUpdate(pr: PrState, botLogin: string): PrUpdate {
  if (pr.state !== "open") return { type: "new_pr" };
  const others = [...new Set(pr.commitAuthors.filter((a) => a !== botLogin))];
  if (others.length) return { type: "comment_only", reason: `${others.join(", ")} pushed to the branch` };
  if (pr.reviewStarted) return { type: "push_commit" };
  return { type: "force_push" };
}
