/**
 * A language model on the house's own machine (LOCAL_LLM_URL): llama.cpp's
 * OpenAI-compatible server on the audio VM (ear/tools/llm/install.sh).
 *
 * When it is set, every Assist request (voice and text, not panel threads)
 * runs there, with everything around it: the "was this said to Igor?" check,
 * the order check and the memory extraction. Semantic recall and fast-model
 * routing, which would send the words to the cloud, are off for those
 * requests. If the local model does not answer, Igor says so: the request is
 * never sent to the cloud model instead.
 */

import OpenAI from "openai";

/** What Igor says when the local model does not answer. */
export const LOCAL_UNAVAILABLE = "Le modèle local ne répond pas pour le moment. Réessayez dans un instant.";

/** How long one call may wait: the bench's slowest full turn took under 3 s. */
const LOCAL_TIMEOUT_MS = 60_000;

/** "http://192.168.1.20:8180", with or without "/v1" or a trailing slash → ".../v1". */
export function localBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function createLocalClient(url: string, key: string | undefined): OpenAI {
  return new OpenAI({
    // llama-server without --api-key accepts any value.
    apiKey: key || "none",
    baseURL: localBaseUrl(url),
    timeout: LOCAL_TIMEOUT_MS,
    // A machine that is off does not come back within a retry: say so at once.
    maxRetries: 0,
  });
}
