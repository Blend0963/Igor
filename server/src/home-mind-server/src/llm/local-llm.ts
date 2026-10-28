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
 * the chat-panel threads.
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
  "web_search",
]);

/**
 * The local model hands conversation and general knowledge to the main
 * (online) model with this tool: only the question it writes leaves the
 * house, never the home, the memory, the contacts or the conversation.
 */
export const ANSWER_GENERAL = "answer_general";

export const ANSWER_GENERAL_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: ANSWER_GENERAL,
    description:
      "Answer a general question or chat: knowledge, explanations, advice, cooking, health, language, jokes, opinions, " +
      "anything NOT about this home, its devices, the phone, contacts, reminders or what you remember. " +
      "Write the person's question so it stands alone, in their language, WITHOUT any name, phone number, address, " +
      "device or detail of this home. The answer is spoken to the person as it is: say nothing yourself.",
    parameters: {
      type: "object",
      properties: { question: { type: "string", description: "The question, standing alone, with no personal detail." } },
      required: ["question"],
    },
  },
};

/** The online model's instructions for a question handed over by the local one. */
export const GENERAL_INSTRUCTIONS =
  "Tu réponds à une question posée à voix haute. Tu ne sais rien de la maison ni de la personne : ne fais aucune supposition sur elles, " +
  "ne propose aucune action et ne pose pas de question sur la maison. Réponds directement, à l'oral, en texte brut.";

/** What Igor says when the online model does not answer a handed-over question. */
export const GENERAL_UNAVAILABLE = "Je n'arrive pas à joindre le service en ligne pour cette question. Réessayez dans un instant.";

/** Messages of the Assist conversation the local model reads: short, as the prompt must be. */
export const LOCAL_HISTORY = 6;

/**
 * Said last, right before the person's words, where a small model heeds it
 * best: an 8B model mirrored a "tu" into tutoiement and repeated one of its
 * earlier answers word for word to three different questions.
 */
export const LOCAL_REMINDER =
  "Rappel : vouvoie toujours la personne, même si elle te tutoie. Ne reprends jamais mot pour mot une de tes réponses précédentes : réponds à la phrase qui vient. Si elle n'a pas de sens (reconnaissance vocale ratée), demande en quelques mots de répéter.";

/**
 * Qwen3's recommended sampling without thinking: presence_penalty keeps a
 * small model from repeating itself. llama.cpp reads top_k as an extension.
 */
export const LOCAL_SAMPLING = { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 };

/**
 * How often the prompt is read again ahead of time: nothing new costs the
 * card a few tokens; a new minute or a changed device, the end of it.
 */
export const PREWARM_EVERY_MS = 15_000;

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
