/**
 * Post-turn extraction gate.
 *
 * Every chat turn fires a second LLM call — the fact extractor — that rereads
 * the exchange and stores anything worth remembering. Most turns in a smart
 * home teach nothing: device commands ("turn off the kitchen light"), sensor
 * questions ("what's the temperature?"), acknowledgements ("yes", "merci",
 * "da", "hvala"). The gate skips the extraction call for exactly those turns,
 * which is a meaningful share of a voice assistant's traffic.
 *
 * The design is INCLUSION, not exclusion. A turn is skipped only on positive
 * proof that it carries nothing learnable:
 *   1. Memorization markers ("remember...", "retiens...", "I prefer...",
 *      "my name is...", "moje ime je...") force extraction NO MATTER what the
 *      rest of the message looks like — a fact-bearing message can never be
 *      misfiled as a command or a question.
 *   2. Pure acknowledgements, pure questions and pure commands — checked only
 *      after the markers — provably teach nothing.
 *   3. Anything the classifier does not positively recognise is EXTRACTED.
 *
 * The cost of a wrong skip (a silently lost memory) is far higher than the
 * cost of a wrong extract (one wasted API call), so every tie goes to
 * extraction.
 *
 * Turns where a forget_memory call ran bypass the gate entirely (in
 * extractAndStoreFacts), because the same message can carry the replacement
 * fact ("forget my name is X — my name is now Y").
 *
 * Controlled by the EXTRACTION_GATE environment variable: "off", "false",
 * "0" or "no" restores the always-extract behaviour; anything else (including
 * unset) leaves the gate on. Read directly from the environment for the same
 * reason web_search reads MISTRAL_API_KEY directly: extractAndStoreFacts has
 * no config object in scope, and options-to-env.sh exports this alongside
 * every other option.
 */

const GATE_OFF_VALUES = new Set(["off", "false", "0", "no"]);

/** Is the gate active? Unset (or any other value) means on. */
export function extractionGateEnabled(): boolean {
  const flag = (process.env.EXTRACTION_GATE ?? "").trim().toLowerCase();
  return !GATE_OFF_VALUES.has(flag);
}

/**
 * Fold a message into a stable comparison form: lowercase, curly apostrophes
 * normalized (French mobile keyboards type "j’aime" with U+2019), accents
 * stripped (déteste -> deteste, prižgi -> prizgi, alergičen -> alergicen — STT
 * output often drops diacritics anyway), punctuation and hyphens to spaces,
 * whitespace collapsed. Straight apostrophes are kept so contractions stay
 * recognizable ("j'aime", "d'accord", "n'oublie").
 */
function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?.,;:"()\[\]{}…]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Anything here forces extraction, whatever else the message looks like.
 * Being over-inclusive only wastes one extractor call; being under-inclusive
 * can silently lose a memory, so the list errs generous — in English, French
 * and Slovenian, the languages this fork's users actually write.
 */
const MEMORIZATION_MARKERS: RegExp[] = [
  // Explicit "store this" requests.
  /\bremember\b/,
  /\bremind me\b/,
  /\brappell/, // rappelle-toi / tu te rappelles / me rappeler
  /\bretiens?\b/,
  /\b(memoris|memoriz)/, // memorise / memorize / memorize-le
  /\bsave (this|that|it|those)\b/,
  /\bnote (que|that|this|it)\b/,
  /\bnoter\b/,
  /\bn'?oublie (pas|jamais)\b/,
  /\bdon'?t forget\b/,
  /\bdo not forget\b/,
  /\bne pozabi\b/,
  /\bzapomni\b/,
  /\bshrani\b/,
  // First-person preferences, identity and context.
  /\bi (like|love|hate|prefer|usually|always|never|have|am|work|live|wake|go)\b/,
  /\bwe (usually|always|never|watch|wake|go|live)\b/,
  /\bmy (name|nickname|surname|birthday|dog|cat|daughter|son|wife|husband|partner|phone|car|job|kids?|children)\b/,
  /\bcall me\b/,
  /\bj'?ai (un|une|deux|trois|quatre|des)\b/,
  /\bje suis\b/,
  /\bj'?aime\b/,
  /\bj'?ador/,
  /\b(deteste|prefere|hais|travaille|habite)\b/,
  /\bm'?appelle\b/,
  /\bs'?appelle\b/,
  /\bmon (nom|surnom|chien|chat|fils|garcon|anniversaire|boulot|travail|telephone)\b/,
  /\bma (fille|femme|voiture)\b/,
  /\ballerg/, // allergic / allergie / alergičen — any language
  /\bd'?habitude\b/,
  /\bhabituellement\b/,
  /\busually\b/,
  /\bevery (morning|evening|day|night|week|weekend)\b/,
  /\bchaque (matin|soir|jour|nuit|semaine)\b/,
  /\bvsak (dan|jutro|vecer|teden)\b/,
  /\b(da sem|jaz sem)\b/, // Slovenian self-statements
  /\bmoj(a|e|i|ega|ih)? (pes|macka|hcer|sin|zena|moz|ime)\b/,
  /\bnormal (pour|for)\b/, // "100ppm NOx is normal for my home"
  /\bc'?est (normal|habituel)\b/,
];

/**
 * Bare acknowledgements, thanks, greetings and fillers. EVERY token of the
 * message must be in this set for the message to count as an ack — a single
 * unknown word keeps it out and the turn is extracted.
 */
const ACK_TOKENS = new Set([
  // English
  "yes","yep","yeah","yup","ya","sure","ok","okay","okey","k","fine","good",
  "great","nice","perfect","awesome","excellent","wonderful","amazing","cool",
  "no","nope","nah","nay","nevermind","mind","never",
  "thanks","thank","thankyou","you","ty","thx","much","a","lot","very","so",
  "done","did","do","go","ahead","will","got","gotit","it","roger","alright",
  "confirmed","confirm","again","now","then","please","pls","plz",
  "hello","hi","hey","yo","howdy","greetings","morning","evening","night",
  "bye","goodbye","seeya","see","later","care","take",
  // French
  "oui","non","merci","beaucoup","super","parfait","cool","genial","top",
  "bravo","excellent","formidable","magnifique","nickel","impeccable","bien",
  "bon","d'accord","entendu","compris","exactement","exact","voila","c'est",
  "fait","fais","le","la","les","vas","y","confirme","okay","stp","svp",
  "salut","bonjour","bonsoir","coucou","au","revoir",
  // Slovenian
  "da","ne","hvala","prosim","dobro","redu","super","odlicno","zivjo","zdravo",
  "dober","dan","jutro","vecer","nasvidenje","okej","seveda","aja","ja",
]);

/** Leading politeness wrappers, stripped (repeatedly) before classification. */
const POLITENESS_PREFIXES: RegExp[] = [
  /^(peux|peut|pourrais|pourriez|pourrait|voudrais|veux|vas) ?tu\b/,
  /^(peux|pouvez|pourrais|pourriez|voudrais|allez|allons) ?vous\b/,
  /^(tu|vous) (peux|peut|pouvez|pourrais|pourriez|sais|savez|veux|voulez|vas|allez)\b/,
  /^est ce que\b/,
  /^(can|could|would|will) (you|u|ya)\b/,
  /^(please|pls|plz|kindly)\b/,
  /^s'?il (te|vous) plait\b/,
  /^(stp|svp|prosim|naj)\b/,
  /^(vas|fais|allez|allons|alle) ?y\b/,
];

/** Openers that make the message a pure question (after marker and ack checks). */
const QUESTION_STARTERS: RegExp[] = [
  // French
  /^(qui|que|quoi|quel|quelle|quels|quelles|quand|ou|comment|combien|pourquoi|est ce|c'est quoi|c'est combien)\b/,
  // English
  /^(what|whats|which|who|whos|whose|when|where|wheres|why|how|hows|is|are|was|were|do|does|did|can|could|would|will|should|has|have)\b/,
  // Slovenian
  /^(kaj|kdaj|kako|kje|koliko|zakaj|ali|kateri|katera|katero|kdo)\b/,
];

/** Openers that make the message a pure command to the home. */
const COMMAND_STARTERS: RegExp[] = [
  // English
  /^(turn|switch|set|dim|open|close|shut|lock|unlock|start|stop|pause|resume|play|show|display|list|find|search|check|read|run|create|delete|remove|add|enable|disable|activate|deactivate|toggle|heat|cool|increase|decrease|raise|lower|boost|mute|unmute|cancel|reset|restart|reboot|reload|refresh|analyse|analyze|warm|brighten)\b/,
  // French
  /^(allume|allumer|eteins|eteindre|eteint|mets|mettre|met|ouvre|ouvrir|ferme|fermer|arrete|arreter|demarre|demarrer|coupe|couper|monte|monter|baisse|descends|descendre|lance|lancer|affiche|afficher|liste|lister|cherche|chercher|verifie|verifier|cree|creer|supprime|supprimer|active|activer|desactive|desactiver|remets|remet|pousse|annule|annuler|redemarre|redemarrer|montre)\b/,
  // Slovenian
  /^(prizgi|prizgem|prizgimo|ugasni|ugasnim|ugasnimo|odpri|odprimo|zapri|zaprimo|vklopi|vklopim|izklopi|izklopim|nastavi|nastavim|ustavi|ustavim|prikazi|prikazem|izpisi|izpisem|preveri|preverim|izbrisi|izbrisem|ustvari|ustvarim|zamenjaj|zamenjam|poslji|posljem|naredi|naredim|prinesi|prinesem|povecaj|zmanjsaj)\b/,
];

/** On/off forms that carry no verb — still pure commands. */
const BARE_COMMANDS: RegExp[] = [
  /^(on|off|stop|pause|play|go|go on|go ahead)$/,
  /^(it|that|this|them|tv|televizija|television|lights?|luci|svetila|gretje|heating|thermostat|termostat|climate|klima|radiators?) (on|off|up|down)$/,
];

function isPureAck(normalized: string): boolean {
  const tokens = normalized.split(/[^a-z0-9']+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => ACK_TOKENS.has(t));
}

function stripPoliteness(normalized: string): string {
  let text = normalized;
  for (let i = 0; i < 3; i++) {
    let stripped = text;
    for (const re of POLITENESS_PREFIXES) {
      stripped = stripped.replace(re, "").trim();
    }
    if (stripped === text) break;
    text = stripped;
  }
  return text;
}

function isQuestion(raw: string, normalized: string): boolean {
  if (/\?/.test(raw)) return true;
  return QUESTION_STARTERS.some((re) => re.test(normalized));
}

function isPureCommand(normalized: string): boolean {
  return COMMAND_STARTERS.some((re) => re.test(normalized)) ||
    BARE_COMMANDS.some((re) => re.test(normalized));
}

/**
 * Should the post-turn extraction call be SKIPPED for this user message?
 * - null: extract (the message might carry something learnable).
 * - string: skip, and this is the human-readable reason.
 *
 * Never throws, never depends on more than the message itself: a gate error
 * must fail open (extraction runs).
 */
export function extractionGateReason(userMessage: string): string | null {
  if (!extractionGateEnabled()) return null;

  const raw = userMessage.trim();
  if (raw.length === 0) return "empty message";
  if (raw.length < 3) return "too short to carry a fact";

  const normalized = normalize(raw);

  // Markers first: a message that might teach something is always extracted,
  // whatever else it looks like.
  if (MEMORIZATION_MARKERS.some((re) => re.test(normalized))) return null;

  // Pure acknowledgements, thanks, greetings, farewells.
  if (isPureAck(normalized)) return "pure acknowledgement";

  // Strip politeness ("peux tu…", "can you…", "please", "naj …") and look again.
  const stripped = stripPoliteness(normalized);
  if (stripped.length === 0) return "politeness only";
  if (isPureAck(stripped)) return "pure acknowledgement";
  if (isQuestion(raw, stripped)) return "pure question";
  if (isPureCommand(stripped)) return "pure command";

  // Not positively recognizable as nothing-to-learn -> extract.
  return null;
}


/**
 * MEMORY_LEARNING: "explicit" (default) stores a memory only when the person
 * asks for it in words ("retiens que…", "remember that…"); "auto" lets the
 * memory pass learn from every turn the gate above lets through. Automatic
 * learning filled the memory with whatever was discussed in chat threads,
 * which then came back in unrelated spoken answers.
 */
export function memoryLearningExplicit(): boolean {
  return (process.env.MEMORY_LEARNING ?? "").trim().toLowerCase() !== "auto";
}

// Asking, in words, for something to be kept. "Rappelle-moi de…" is a
// reminder, not a memory, and is deliberately absent.
const EXPLICIT_MEMORY_REQUESTS: RegExp[] = [
  /\bretien[st]?\b/, /\bretenir\b/,
  /\bsouviens? (toi|vous)\b/, /\bsouvenez vous\b/, /\bte souvenir\b/,
  /\bmemoris/, /\bmemoriz/,
  /\bn'?oublie(z)? (pas|jamais)\b/,
  /\bgarde(z)? (le |ca |cela |bien )?(en memoire|en tete)\b/,
  /\b(note|notez|enregistre|enregistrez) (que|ca|cela|bien|le|la|dans ta memoire|dans votre memoire)\b/,
  /\b(apprends|sache|sachez) que\b/,
  /\bremember\b/, /\bkeep in mind\b/, /\bdon'?t forget\b/, /\bdo not forget\b/,
  /\bnote (that|this|it)\b/, /\bsave (this|that|it)\b/, /\bmemorize\b/,
];

/** Does the message ask, in words, for something to be remembered? */
export function asksToRemember(userMessage: string): boolean {
  const normalized = normalize(userMessage);
  return EXPLICIT_MEMORY_REQUESTS.some((re) => re.test(normalized));
}
