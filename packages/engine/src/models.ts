import type Anthropic from "@anthropic-ai/sdk";

export type ModelId = "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5";
export type Effort = "low" | "medium" | "high";

type Pricing = {
  /** $ per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Prompts above this many tokens are billed at `above` instead. */
  tier?: { threshold: number; above: Omit<Pricing, "tier"> };
};

// Claude API list prices. Cache writes are the 5-minute TTL rate (1.25× input).
const PRICES: Record<ModelId, Pricing> = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    tier: { threshold: 100_000, above: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/** Server-side refusal fallback isn't offered for Haiku 5.5. */
export const SUPPORTS_FALLBACK: Record<ModelId, boolean> = {
  "claude-haiku-5-5": false,
  "claude-sonnet-5-5": true,
  "claude-opus-5-5": true,
};

/** Dollar cost of one response. */
export function costOf(model: ModelId, usage: Anthropic.Beta.BetaUsage): number {
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const prompt = usage.input_tokens + read + write;
  const base = PRICES[model];
  const p = base.tier && prompt > base.tier.threshold ? base.tier.above : base;
  return (usage.input_tokens * p.input + read * p.cacheRead + write * p.cacheWrite + usage.output_tokens * p.output) / 1_000_000;
}

/** One rung of the ladder: try this model, give up past the budget. */
export type Tier = { model: ModelId; effort: Effort; budgetUsd: number };

/** Cheap first; the stronger model only runs when the cheap one couldn't reproduce the bug. */
export const DEFAULT_LADDER: Tier[] = [
  { model: "claude-haiku-5-5", effort: "medium", budgetUsd: 0.1 },
  { model: "claude-sonnet-5-5", effort: "medium", budgetUsd: 0.5 },
];
