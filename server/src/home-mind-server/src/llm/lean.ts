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
