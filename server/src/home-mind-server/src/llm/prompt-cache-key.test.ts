import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetPromptCacheKeyCache, withPromptCacheKey } from "./prompt-cache-key.js";

const MISTRAL = "https://api.mistral.ai/v1";

describe("withPromptCacheKey", () => {
  beforeEach(() => resetPromptCacheKeyCache());

  it("sends the key to Mistral", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    await withPromptCacheKey("mistral-large-latest", "mado:voice:default", send, MISTRAL);
    expect(send).toHaveBeenCalledWith({ prompt_cache_key: "mado:voice:default" });
  });

  it("never sends it anywhere else, or without a key", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    await withPromptCacheKey("gpt-5-mini", "k", send, "https://api.openai.com/v1");
    await withPromptCacheKey("mistral-large-latest", undefined, send, MISTRAL);
    expect(send).toHaveBeenNthCalledWith(1, {});
    expect(send).toHaveBeenNthCalledWith(2, {});
  });

  it("retries once without it when Mistral refuses it, and remembers that", async () => {
    const refusal = Object.assign(new Error("422 extra_forbidden: prompt_cache_key"), { status: 422 });
    const send = vi.fn().mockRejectedValueOnce(refusal).mockResolvedValue("ok");
    expect(await withPromptCacheKey("m", "k", send, MISTRAL)).toBe("ok");
    expect(send).toHaveBeenNthCalledWith(2, {});
    await withPromptCacheKey("m", "k", send, MISTRAL);
    expect(send).toHaveBeenLastCalledWith({});
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("lets every other error through", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("429 rate limited"), { status: 429 }));
    await expect(withPromptCacheKey("m", "k", send, MISTRAL)).rejects.toThrow("429");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
