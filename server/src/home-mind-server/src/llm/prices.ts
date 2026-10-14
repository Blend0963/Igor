/**
 * Estimated price of a request, for the panel's cost counter.
 *
 * List prices in USD per million tokens, matched by model-name prefix
 * (longest first). They are indicative: providers change them, and a model
 * missing here is shown as "not priced" rather than as free. MODEL_PRICES
 * (JSON, e.g. {"mistral-large": [0.5, 1.5]}) overrides or adds entries.
 * Cached prompt tokens are counted at 10% of the input price (Mistral's
 * prompt-cache rate).
 */

import type { RequestUsage } from "./interface.js";

const DEFAULT_PRICES: Record<string, [number, number]> = {
  "mistral-large": [0.5, 1.5],
  "mistral-medium": [0.4, 2],
  "mistral-small": [0.1, 0.3],
  "magistral-medium": [2, 5],
  "magistral-small": [0.5, 1.5],
  "ministral-14b": [0.2, 0.2],
  "ministral-8b": [0.15, 0.15],
  "ministral-3b": [0.04, 0.04],
  "devstral": [0.4, 2],
  "codestral": [0.3, 0.9],
  "pixtral-large": [2, 6],
  "open-mistral-nemo": [0.15, 0.15],
  "claude-haiku": [1, 5],
  "claude-sonnet": [3, 15],
  "claude-opus": [5, 25],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
};

export const CACHED_INPUT_RATE = 0.1;

function table(): Record<string, [number, number]> {
  const out = { ...DEFAULT_PRICES };
  try {
    const custom = JSON.parse(process.env.MODEL_PRICES || "{}") as Record<string, unknown>;
    for (const [k, v] of Object.entries(custom)) {
      if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && n >= 0)) out[k.toLowerCase()] = [v[0], v[1]];
    }
  } catch {
    // An unreadable MODEL_PRICES keeps the defaults.
  }
  return out;
}

/** [input, output] USD per million tokens, or undefined when unknown. */
export function priceOf(model: string): [number, number] | undefined {
  const name = model.toLowerCase().replace(/^.*\//, "");
  const prices = table();
  const key = Object.keys(prices)
    .sort((a, b) => b.length - a.length)
    .find((k) => name.startsWith(k));
  return key ? prices[key] : undefined;
}

export function estimateCost(usage: RequestUsage): number | undefined {
  const price = priceOf(usage.model);
  if (!price) return undefined;
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  const fresh = usage.promptTokens - cached;
  return (fresh * price[0] + cached * price[0] * CACHED_INPUT_RATE + usage.completionTokens * price[1]) / 1e6;
}
