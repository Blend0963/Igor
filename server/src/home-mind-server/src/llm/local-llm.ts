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

/**
 * The tools Assist gets on the local model: every tool description is read
 * on each request, and these are the ones a spoken or typed Assist answer
 * uses. The rest (automations, history, cameras, forgetting a memory) stay in
 * the chat-panel threads; the web search is the online model's.
 */
export const LOCAL_TOOLS = new Set([
  "get_state",
  "search_entities",
  "call_service",
  "find_contact",
  "schedule_task",
  "notify_when",
  "list_scheduled_tasks",
  "cancel_scheduled_task",
]);

/**
 * Who the local model is: a working part, not a character. It acts and
 * reads; the online model plays Igor and answers. The add-on option local_llm_prompt (LOCAL_LLM_PROMPT)
 * adds the owner's working rules (scripts, contacts, calls) after it.
 */
export const LOCAL_IDENTITY =
  "Tu es le module domotique d'un assistant vocal intégré à Home Assistant. Tu n'as pas de personnalité à jouer " +
  "et tu ne réponds jamais à la personne : tu comprends la demande et tu appelles les bons outils ; un autre modèle " +
  "lui répond ensuite d'après ce que tu as fait ou lu.";

/** The local model's whole persona: its identity, then the owner's working rules if any. */
export function localPersona(rules: string | undefined): string {
  return rules?.trim() ? `${LOCAL_IDENTITY}\n\n${rules.trim()}` : LOCAL_IDENTITY;
}

/** Said to the online model after the owner's common persona: how a spoken reply sounds. */
export const ONLINE_SPOKEN_STYLE =
  "Ta réponse est lue à voix haute : une à deux phrases courtes, en texte brut, sans liste ni mise en forme, sans introduction ni proposition d'aide.";

/** The online model's instructions when it answers for the local model. */
export const ONLINE_REPLY_INSTRUCTIONS =
  "Tu réponds à la personne. Un module domotique local, chez elle, a déjà fait les actions et lectures nécessaires " +
  "dans la maison, sur le téléphone et dans les contacts ; ce qu'il a fait ou lu t'est donné juste avant sa phrase. " +
  "Tu ne peux rien faire toi-même dans la maison. Pour tout ce qui concerne la maison, le téléphone ou les contacts, " +
  "tu te fondes uniquement sur ces résultats et tu n'inventes aucune action ni valeur. S'il s'agissait d'un ordre et " +
  "que rien n'a été fait, dis-le simplement et demande la précision qui manque. Pour tout le reste (culture générale, " +
  "discussion, conseils), réponds avec toutes tes connaissances ; pour l'actualité ou une information récente " +
  "que tu ne connais pas avec certitude, cherche avec web_search avant de répondre, et ne dis jamais que tu ne sais pas sans avoir cherché.";

/** Most characters of one tool result handed to the online model. */
const FACT_MAX = 1500;

/** What the local model did and read this turn, as the online model reads it. */
export function onlineFacts(done: { name: string; input: Record<string, unknown>; result: unknown }[], plain?: string): string {
  if (done.length === 0) return "Le module domotique n'a rien fait ni lu pour cette demande.";
  const lines = done.map((d) => {
    // Memories: only the ones shareMemory checked, never what the local model asked for.
    if (d.name === SHARE_MEMORY) {
      const shared = (d.result as { shared?: string[] } | undefined)?.shared ?? [];
      return `- souvenirs utiles : ${shared.length ? shared.join(" ; ") : "aucun"}`;
    }
    const result = JSON.stringify(d.result) ?? "";
    return `- ${d.name} ${JSON.stringify(d.input)} → ${result.length > FACT_MAX ? `${result.slice(0, FACT_MAX)}…` : result}`;
  });
  return `Ce que le module domotique vient de faire ou de lire pour cette demande${plain ? ` (en bref : ${plain})` : ""} :\n${lines.join("\n")}`;
}

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

export const SHARE_MEMORY_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: SHARE_MEMORY,
    description:
      "Give the model that answers the person the memories its answer depends on (their name, a preference, a habit, " +
      "someone they mentioned), copied word for word from \"What You Remember About This User\". Only these leave the " +
      "house. Call it only when the request needs them.",
    parameters: {
      type: "object",
      properties: {
        facts: { type: "array", items: { type: "string" }, description: "The memories, each copied exactly." },
      },
      required: ["facts"],
    },
  },
};

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
 * Said last, right before the person's words, where a small model heeds it
 * best: it acts and reads, and another model answers the person.
 */
export const LOCAL_REMINDER =
  "Rappel : tu n'écris jamais de réponse, un autre modèle répond à la personne. Appelle les outils nécessaires " +
  "(y compris pour une suite comme « vas-y » ou « oui », d'après les échanges précédents) ; si rien ne concerne " +
  "la maison, le téléphone, les contacts ou un rappel, écris seulement « - ».";

/**
 * Qwen3's recommended sampling without thinking: presence_penalty keeps a
 * small model from repeating itself. llama.cpp reads top_k as an extension.
 */
export const LOCAL_SAMPLING = { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 };

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
