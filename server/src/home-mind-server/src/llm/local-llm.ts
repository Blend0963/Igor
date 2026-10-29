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

/** Said to the online model after the owner's common persona: how a spoken reply sounds. */
export const ONLINE_SPOKEN_STYLE =
  "Ta réponse est lue à voix haute : une à deux phrases courtes, en texte brut, sans liste ni mise en forme, sans introduction ni proposition d'aide.";

/** Most tokens the local model writes in one pass: tool calls, never answers. */
export const LOCAL_OUTPUT_CAP = 512;

/** How long the online model may take to answer after an order; then the plain sentence is said. */
export const DONE_TIMEOUT_MS = 4000;

/** What Igor says when the online model does not answer. */
export const GENERAL_UNAVAILABLE = "Je n'arrive pas à joindre le service en ligne pour cette question. Réessayez dans un instant.";

/**
 * The local model hands the online one the memories a reply depends on (a
 * name, a preference, a habit): only those leave the house, and only if they
 * are memories Igor really holds (shareMemory checks each one).
 */
export const SHARE_MEMORY = "share_memory";

function plainText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * The memories a share_memory call may hand over: the requested texts that
 * are memories Igor holds (the same text, or one containing the other), as
 * stored. Anything else is dropped, so nothing invented or unrelated leaves.
 */
export function shareMemory(requested: unknown, known: string[]): { shared: string[] } {
  const asked = (Array.isArray(requested) ? requested : [requested])
    .filter((r): r is string => typeof r === "string")
    .map(plainText)
    .filter((r) => r.length >= 3);
  const shared = known.filter((fact) => {
    const f = plainText(fact);
    return asked.some((r) => r === f || (r.length >= 12 && f.includes(r)) || (f.length >= 12 && r.includes(f)));
  });
  return { shared };
}

/** Messages of the Assist conversation the local model reads: short, as the prompt must be. */
export const LOCAL_HISTORY = 6;

/**
 * Messages the local model itself reads: the last exchange, enough for "vas-y"
 * or "et la cuisine ?". Every message more is read again by its slow card at
 * each request; the online model, which answers, keeps LOCAL_HISTORY.
 */
export const LOCAL_PROMPT_HISTORY = 2;

/**
 * Near-greedy: the local model writes entity ids, JSON and one tag, where a
 * creative pick is a wrong one. (presence_penalty, which kept it from
 * repeating itself when it still spoke, would push it off an id it must
 * write twice.) llama.cpp reads top_k as an extension.
 */
export const LOCAL_SAMPLING = { temperature: 0.1, top_p: 0.9, top_k: 20 };

/**
 * How often the prompt is read again ahead of time, besides right after each
 * request: once a minute, as the time in it changes by the minute. More often
 * only made the card's fans spin up for nothing.
 */
export const PREWARM_EVERY_MS = 60_000;

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
