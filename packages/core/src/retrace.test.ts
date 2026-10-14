import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, parseCommand, prUpdate } from "./retrace.ts";

const pr = { hasOpenPr: true };
const noPr = { hasOpenPr: false };

describe("parseCommand", () => {
  it("reads a retry", () => {
    assert.deepEqual(parseCommand("@trace retry"), { type: "retry" });
    assert.deepEqual(parseCommand("hey @Trace, try again please"), { type: "retry" });
  });
  it("reads a correction with its context", () => {
    assert.deepEqual(parseCommand("@trace that's not it, it's the mobile layout"), {
      type: "correct",
      context: "that's not it, it's the mobile layout",
    });
  });
  it("ignores comments that don't mention Trace", () => {
    assert.equal(parseCommand("retry this when you can"), null);
    assert.equal(parseCommand("email trace@acme.com"), null);
  });
});

describe("decide", () => {
  it("ignores cosmetic edits in every state", () => {
    for (const s of ["tracing", "pr_opened", "not_reproduced"] as const) {
      assert.deepEqual(decide(s, { kind: "edited", significance: "cosmetic" }, pr), { type: "ignore" });
    }
  });

  it("feeds new detail to a run in progress", () => {
    assert.deepEqual(decide("tracing", { kind: "edited", significance: "new_detail" }, noPr), { type: "feed_detail" });
  });

  it("retries a failed run automatically when the ticket gains information", () => {
    assert.equal(decide("not_reproduced", { kind: "edited", significance: "new_detail" }, noPr).type, "retrace");
    assert.equal(decide("errored", { kind: "edited", significance: "redescribed" }, noPr).type, "retrace");
  });

  it("only suggests a re-trace when a successful run's ticket is redescribed", () => {
    assert.equal(decide("pr_opened", { kind: "edited", significance: "redescribed" }, pr).type, "suggest_retrace");
    assert.equal(decide("pr_opened", { kind: "edited", significance: "new_detail" }, pr).type, "ignore");
  });

  it("restarts a run in progress when the bug is redescribed", () => {
    assert.deepEqual(decide("bisecting", { kind: "edited", significance: "redescribed" }, noPr), { type: "restart" });
  });

  it("follows @trace commands", () => {
    const retry = { kind: "commented" as const, body: "@trace retry", author: "maya" };
    assert.equal(decide("pr_opened", retry, pr).type, "retrace");
    assert.deepEqual(decide("tracing", retry, pr), { type: "restart" });
    const fix = { kind: "commented" as const, body: "@trace it's the date picker, not the API", author: "maya" };
    const action = decide("culprit_found", fix, pr);
    assert.equal(action.type, "retrace");
    assert.equal(action.type === "retrace" && action.context, "it's the date picker, not the API");
  });

  it("keeps a correction when it restarts a run in progress", () => {
    const fix = { kind: "commented" as const, body: "@trace it's the date picker", author: "maya" };
    assert.deepEqual(decide("tracing", fix, pr), { type: "restart", context: "it's the date picker" });
  });

  it("ignores ordinary comments", () => {
    assert.deepEqual(decide("pr_opened", { kind: "commented", body: "+1 seeing this too", author: "sam" }, pr), { type: "ignore" });
  });

  it("closes the PR when the ticket is a duplicate or won't fix, but not when it's fixed", () => {
    assert.equal(decide("pr_opened", { kind: "closed", reason: "duplicate" }, pr).type, "close_pr");
    assert.equal(decide("pr_opened", { kind: "closed", reason: "wont_fix" }, pr).type, "close_pr");
    assert.deepEqual(decide("pr_opened", { kind: "closed", reason: "fixed" }, pr), { type: "ignore" });
    assert.equal(decide("tracing", { kind: "closed", reason: "fixed" }, pr).type, "cancel");
  });
});

describe("prUpdate", () => {
  const bot = "trace-bot[bot]";
  it("replaces the branch when Trace owns it and review hasn't started", () => {
    assert.deepEqual(prUpdate({ state: "open", commitAuthors: [bot], reviewStarted: false }, bot), { type: "force_push" });
  });
  it("adds commits once review has started", () => {
    assert.deepEqual(prUpdate({ state: "open", commitAuthors: [bot], reviewStarted: true }, bot), { type: "push_commit" });
  });
  it("never pushes over someone else's commits", () => {
    const u = prUpdate({ state: "open", commitAuthors: [bot, "maya", "maya"], reviewStarted: false }, bot);
    assert.deepEqual(u, { type: "comment_only", reason: "maya pushed to the branch" });
  });
  it("leaves merged and closed PRs alone", () => {
    assert.deepEqual(prUpdate({ state: "merged", commitAuthors: [bot], reviewStarted: true }, bot), { type: "new_pr" });
  });
});
