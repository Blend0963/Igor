/**
 * LEAN_MODE (add-on option lean_mode, on unless set to false): the request
 * path keeps only what pays for itself. Everything it switches off is still
 * in the code and comes back with lean_mode: false, while it is tried out:
 *
 * - Shodh's "proactive" fact search (≈ 420 ms a request): facts are read by
 *   tag only, which is all of them while they fit the budget;
 * - Assist: no semantic recall nor message embedding (two Mistral calls a
 *   request); the model sees the whole stored conversation (20 messages)
 *   instead. Threads keep recall, and embed in the background;
 * - FAST_MODEL routing, and the model that judged "was this an order?"
 *   (a known order verb is still checked, with no extra call);
 * - the NOT_FOR_ME hold in spoken replies (nothing produces it since 0.11.8);
 * - six tools a spoken answer has no use for (VOICE_LEAN_DROPPED);
 * - the morning briefing's thread history, cut to its last 2 messages.
 */
export function leanMode(): boolean {
  return !["off", "false", "0", "no"].includes((process.env.LEAN_MODE ?? "").trim().toLowerCase());
}

/** Tools left out of a spoken turn in lean mode: still offered in text and threads. */
export const VOICE_LEAN_DROPPED = new Set([
  "get_statistics",
  "list_services",
  "list_automations",
  "update_automation",
  "delete_automation",
  "send_notification",
]);

/** Past messages the morning briefing reads in lean mode. */
export const BRIEFING_HISTORY = 2;

/** The morning briefing's thread (jobs/scheduler.ts BRIEFING_THREAD). */
export const BRIEFING_THREAD_ID = "mado-thread:morning-briefing";

/**
 * Spoken replies: the most whole sentences read out (llm/runaway.ts), a net
 * under the prompt's "two short sentences": the reply always ends on a
 * finished sentence. Not applied when the person asks for detail, or to an
 * SMS read back before it is sent.
 */
export const SPOKEN_MAX_SENTENCES = 3;

const WANTS_DETAIL = /\b(d[ée]taill|en d[ée]tail|explique[sz]?[- ]moi en|les [ée]tapes|toutes les [ée]tapes|liste[sz]?[- ]moi|[ée]num[ée]re|lis[- ]moi|relis|sms|texto|message [àa]|pas [àa] pas)/i;

/** The sentence cap for a spoken reply to this message, or undefined for none. */
export function spokenSentenceCap(message: string): number | undefined {
  return WANTS_DETAIL.test(message) ? undefined : SPOKEN_MAX_SENTENCES;
}

/**
 * Said right before the person's words, where a model heeds it best: the
 * length rule of the persona sits thousands of tokens earlier and was
 * ignored on "why" questions, which came back as numbered lists.
 */
export const SPOKEN_LENGTH_REMINDER =
  "Spoken reply: at most two short sentences, in plain speech, with no list, numbering or headings; give the gist and stop. " +
  "Only an explicit request for detail, or reading an SMS back before sending it, may be longer.";
