import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { costOf } from "./models.ts";

const usage = (input: number, output: number, read = 0, write = 0) =>
  ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write }) as never;

describe("costOf", () => {
  it("prices Haiku 5.5 at its base rate under 100K prompt tokens", () => {
    // 50K uncached in at $0.10/M + 1K out at $0.50/M
    assert.equal(costOf("claude-haiku-5-5", usage(50_000, 1_000)).toFixed(6), "0.005500");
  });
  it("switches Haiku 5.5 to the higher tier for long prompts", () => {
    // 120K in at $0.50/M + 1K out at $2.50/M
    assert.equal(costOf("claude-haiku-5-5", usage(120_000, 1_000)).toFixed(6), "0.062500");
  });
  it("counts cached reads and writes at their own rates", () => {
    // Sonnet 5.5: 1K in $2/M, 40K cache read $0.20/M, 5K cache write $2.50/M, 2K out $10/M
    assert.equal(costOf("claude-sonnet-5-5", usage(1_000, 2_000, 40_000, 5_000)).toFixed(6), "0.042500");
  });
});
