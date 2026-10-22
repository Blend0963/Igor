import type { TokenUsage } from "./usage.js";

/**
 * Was a spoken sentence said TO Igor, or only ABOUT it? The always-on
 * microphone (ear/) sends every sentence it heard the name in, and people
 * also talk about Igor ("c'est Igor qui a éteint", "demande à Igor"). Asking
 * the main model to stay silent did not hold: it would rather say, often in
 * English, that the sentence was not for it. So a separate, small call
 * decides first, and the main model is never called for a sentence that was
 * not said to Igor.
 *
 * Only sentences where the name comes after their opening are checked:
 * "Igor, allume le salon" goes straight through, with no added wait.
 * A failure or an unclear verdict counts as "for Igor": a reply too many is
 * better than a real request ignored.
 */

// The names Igor answers to, as speech-to-text spells them (ear/igor_ear/addressing.py SPELLINGS).
const NAME = /\b(?:h?[iy] ?gor+e?s?|m[ae] ?d(?:o+|ot|eau)s?)\b/;

// What may come before the name when it opens the sentence: "hey Igor", "dis Igor".
const OPENING = /^(?:(?:hey|he|ok|okay|dis|euh|oh|bon|alors|allez|bonjour|salut|coucou)\s+)*$/;

/** Accents and case off, punctuation as spaces: the shape NAME and OPENING expect. */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the sentence names Igor somewhere other than at its opening. */
export function needsAddresseeCheck(message: string): boolean {
  const text = plain(message);
  const found = NAME.exec(text);
  if (!found) return false;
  const before = text.slice(0, found.index);
  return !OPENING.test(before ? `${before.trim()} ` : "");
}

export const ADDRESSEE_INSTRUCTIONS = `Un micro entend tout ce qui se dit dans une maison. Igor, aussi appelé Mado, est l'assistant vocal de la maison. On te donne une phrase transcrite où son nom apparaît, parfois mal orthographié.

Ta tâche : dire si la phrase est adressée À Igor, ou si on parle DE lui ou entre soi.

Adressée à Igor (true) : une demande, une question, un ordre, un remerciement qui lui est fait, même avec le nom au milieu ou à la fin.
- « Éteins la lumière du salon, Igor. »
- « Tu peux, Igor, mettre de la musique ? »
- « Quelle heure il est Igor ? »
- « Merci Igor. »

Pas adressée à Igor (false) : on parle de lui à quelqu'un d'autre, on le cite, on raconte ce qu'il a fait.
- « C'est Igor qui a éteint la lumière. »
- « Demande à Igor. »
- « Igor a encore mal compris. »
- « Tu as vu ce qu'Igor a fait ? »
- « Avec Igor, c'est toujours pareil. »

Si tu hésites, réponds true.
Réponds uniquement en JSON : {"pour_igor": true} ou {"pour_igor": false}.`;

/** The user turn of the check: the sentence, and Igor's last reply when there is one. */
export function addresseeQuestion(message: string, previousReply?: string): string {
  const before = previousReply ? `Dernière réponse d'Igor : « ${previousReply.slice(0, 300)} »\n\n` : "";
  return `${before}Phrase : « ${message} »`;
}

/** true or false from the model's reply; undefined when it says neither. */
export function readAddresseeVerdict(reply: string): boolean | undefined {
  const field = /"?pour_igor"?\s*:\s*(true|false)/i.exec(reply);
  if (field) return field[1].toLowerCase() === "true";
  const bare = reply.trim().toLowerCase();
  if (/^(true|oui|yes)\b/.test(bare)) return true;
  if (/^(false|non|no)\b/.test(bare)) return false;
  return undefined;
}

/** How long the check may take before the sentence is treated as for Igor. */
export const ADDRESSEE_TIMEOUT_MS = 4000;

/**
 * Runs `ask` (one short model call that returns the raw reply) with a time
 * limit, and reads its verdict. Never throws: on any failure the verdict is
 * "for Igor".
 */
export async function checkAddressee(
  ask: (signal: AbortSignal) => Promise<{ text: string; usage?: TokenUsage }>,
  signal?: AbortSignal
): Promise<{ forMe: boolean; usage?: TokenUsage }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADDRESSEE_TIMEOUT_MS);
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const { text, usage } = await ask(controller.signal);
    const verdict = readAddresseeVerdict(text);
    if (verdict === undefined) console.warn(`[addressee] unclear verdict ${JSON.stringify(text.slice(0, 80))}: answering`);
    return { forMe: verdict ?? true, usage };
  } catch (error) {
    if (!signal?.aborted) {
      console.warn(`[addressee] check failed (${error instanceof Error ? error.message : error}): answering`);
    }
    return { forMe: true };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
