/**
 * Mistral's prompt cache, opted into per request.
 *
 * Mistral bills cached input tokens at a tenth of the normal rate, but only
 * caches a prefix when the request carries a stable `prompt_cache_key`. Every
 * MaDo call starts with the same ~10k tokens (persona, instructions, tools,
 * home layout), so without the key that prefix is paid in full on every call
 * of every tool loop.
 *
 * The key names the prefix, not the person: one per conversation style and
 * memory bucket, since those are what decide the prompt's opening.
 *
 * Sent to Mistral only. Mistral rejects fields it does not know, and if a
 * model or a future API version refuses this one, the call is retried once
 * without it and that endpoint/model pair stops getting it, the same way
 * `reasoning_effort` is handled.
 */

export type PromptCacheParam = { prompt_cache_key?: string };

const rejectsPromptCacheKey = new Set<string>();

/** True when an error is the endpoint refusing `prompt_cache_key`. */
export function isPromptCacheKeyUnsupported(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { status?: number; param?: string; message?: string };
  if (err.status !== 400 && err.status !== 422) return false;
  if (err.param === "prompt_cache_key") return true;
  return typeof err.message === "string" && /prompt[_. ]?cache[_. ]?key/i.test(err.message);
}

export async function withPromptCacheKey<T>(
  model: string,
  cacheKey: string | undefined,
  send: (param: PromptCacheParam) => Promise<T>,
  endpoint = ""
): Promise<T> {
  const key = `${endpoint} ${model}`;
  if (!cacheKey || !/api\.mistral\.ai/i.test(endpoint) || rejectsPromptCacheKey.has(key)) {
    return send({});
  }

  try {
    return await send({ prompt_cache_key: cacheKey });
  } catch (error) {
    if (!isPromptCacheKeyUnsupported(error)) throw error;
    rejectsPromptCacheKey.add(key);
    console.info(`[llm] ${model} rejects prompt_cache_key; sending requests without it from now on.`);
    return send({});
  }
}

/** For tests. */
export function resetPromptCacheKeyCache(): void {
  rejectsPromptCacheKey.clear();
}
