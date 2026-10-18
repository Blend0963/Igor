/**
 * Which model answers a request.
 *
 * "Allume la lumière du salon" needs a tool call and one sentence; sending
 * it to Mistral Large with reasoning pays for a model that thinks about
 * philosophy to flip a switch. When FAST_MODEL is set, short plain commands
 * and quick state questions go to it instead, and everything else (anything
 * with a file or an image, anything that asks to explain, write, compare,
 * plan or analyse) stays on the main model.
 *
 * The rule is deliberately conservative: a wrong "simple" costs a worse
 * answer, a wrong "complex" only costs what every request cost before.
 */

/** Longest message still considered a plain command, in characters. */
export const FAST_MAX_CHARS = 140;

const COMMAND_START =
  /^(?:(?:igor|hey igor|ok igor)[,\s]+)?(?:(?:peux[- ]tu|pourrais[- ]tu|tu peux|est[- ]ce que tu peux|merci de|stp|s'il te pla[iî]t|please|can you|could you)\s+)?(?:allume|allumer|[ée]teins|[ée]teindre|coupe|couper|ouvre|ouvrir|ferme|fermer|monte|monter|baisse|baisser|mets|mettre|r[èe]gle|r[ée]gler|lance|lancer|arr[êe]te|arr[êe]ter|active|activer|d[ée]sactive|d[ée]sactiver|d[ée]marre|d[ée]marrer|stoppe|pause|reprends|augmente|diminue|passe|tamise|verrouille|d[ée]verrouille|turn on|turn off|switch on|switch off|open|close|set|start|stop|lock|unlock|dim|raise|lower)\b/i;

// An order verb anywhere in the sentence, for orders that do not open with
// it ("non, je te demandais d'éteindre les lumières", "les volets, ferme-les").
// Letters, not \b, bound it: \b does not see "é" as part of a word.
const ACTION_VERB =
  /(?<!\p{L})(?:allume|allumes|allumer|[ée]teins|[ée]teindre|coupe|couper|ouvre|ouvrir|ferme|fermer|monte|monter|baisse|baisser|tamise|tamiser|verrouille|verrouiller|d[ée]verrouille|d[ée]verrouiller|active|activer|d[ée]sactive|d[ée]sactiver|d[ée]marre|d[ée]marrer|lance|lancer|arr[êe]te|arr[êe]ter|turn on|turn off|switch on|switch off)(?!\p{L})/iu;

const STATE_QUESTION =
  /\b(?:temp[ée]rature|humidit[ée]|allum[ée]e?s?|[ée]teinte?s?|ouverte?s?|ferm[ée]e?s?|verrouill[ée]e?s?|[ée]tat|batterie|niveau|il fait combien|quelle heure|is .* (?:on|off|open|closed)|temperature|humidity)\b/i;

const COMPLEX =
  /\b(?:pourquoi|explique|expliquer|comment (?:faire|je|on|fonctionne)|compare|comparer|analyse|analyser|graph|graphique|courbe|historique|statistique|consommation|automatisation|automation|sc[ée]nario|script|cr[ée]e|cr[ée]er|[ée]cris|r[ée]dige|r[ée]sume|r[ée]sumer|document|fichier|tableau|code|plan|conseil|recette|traduis|rappel|rappelle|rappeler|pr[ée]viens|pr[ée]venir|minuteur|notifie|remind|reminder|timer|notify|why|explain|compare|analy[sz]e|history|write|create|summari[sz]e|plan)\b/i;

export interface RouteInput {
  message: string;
  hasImages?: boolean;
  hasDocuments?: boolean;
}

/** True when the request is a plain command or a quick state question. */
export function isSimpleRequest({ message, hasImages, hasDocuments }: RouteInput): boolean {
  if (hasImages || hasDocuments) return false;
  const text = message.trim();
  if (!text || text.length > FAST_MAX_CHARS || text.includes("\n") || text.includes("<document")) return false;
  if (COMPLEX.test(text)) return false;
  if (COMMAND_START.test(text)) return true;
  return text.length <= 90 && STATE_QUESTION.test(text);
}

/**
 * An order to do something in the house ("éteins toutes les lumières"). A
 * reply to one of these that calls no tool did nothing, whatever it says: the
 * engine then asks again, on the main model, with a tool call required.
 */
export function isActionCommand(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > FAST_MAX_CHARS * 2) return false;
  if (COMMAND_START.test(text)) return true;
  // Further in, the verb may be part of a question or a request to build
  // something ("comment créer une automatisation qui allume…"): leave those.
  return !COMPLEX.test(text) && ACTION_VERB.test(text);
}

/**
 * A message that may be an order in words the verb list does not know
 * ("plonge la maison dans le noir"). Short, plain and not a question about
 * how or why: when its first answer calls no tool, a model is asked whether
 * it was an order (llm/order-check.ts).
 */
export function mayBeOrder(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > FAST_MAX_CHARS * 2 || text.includes("<document")) return false;
  return !COMPLEX.test(text);
}


/** Reasoning level chosen for a thread, bounded by the user's configured ceiling. */
export type ThreadReasoningLevel = "none" | "low" | "medium" | "high";

const DEEP_REASONING =
  /\b(?:why|pourquoi|explain|explique|analyse|analyze|compare|debug|diagnos|prove|prouve|derive|d[ée]duis|architecture|implement|impl[ée]mente|review|audit|research|recherche|investigate|investigue|step[- ]by[- ]step|in depth|en d[ée]tail|pros and cons|avantages et inconv[ée]nients|refactor|optimis[ez]|optimize|optimise|design|code|write|r[ée]dige|[ée]cris|cr[ée]e|planifie|plan)/i;

const CASUAL_EXCHANGE =
  /^(?:bonjour|salut|coucou|hello|hi|hey|merci|thanks|thank you|ok|okay|d'accord|parfait|super|bonne nuit|à bientôt)[.!?\s]*$/i;

/**
 * Ordinary thread chat uses low/no reasoning; explicit analysis stays at the
 * configured level. An explicit per-request level from the UI takes precedence
 * in openai-client.ts.
 */
export function selectThreadReasoning(
  message: string,
  ceiling: ThreadReasoningLevel
): ThreadReasoningLevel {
  if (ceiling === "none") return "none";
  const text = message.trim();
  if (!text || CASUAL_EXCHANGE.test(text) || isSimpleRequest({ message: text })) return "none";
  if (DEEP_REASONING.test(text) || text.length >= 700) return ceiling;
  return ceiling === "high" || ceiling === "medium" ? "low" : ceiling;
}
