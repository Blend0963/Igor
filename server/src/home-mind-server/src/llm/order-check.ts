import type OpenAI from "openai";
import { readUsage, type TokenUsage } from "./usage.js";

/**
 * Asks a model whether a message asked to change something in the home,
 * whatever its words. Used when an answer called no tool and the verb list
 * (model-router.ts) did not recognise the message: "plonge la maison dans le
 * noir" is an order no list foresees.
 *
 * A failure or an unclear reply counts as "no": the answer then stands, as
 * it did before this check existed.
 */
const INSTRUCTIONS =
  "You classify one message sent to a smart-home assistant. Reply with exactly one word: yes or no.\n" +
  "yes: the message asks, in any wording or language, to change something in the home now or at a given time " +
  "(lights, switches, plugs, covers, locks, heating, media, scenes, scripts, appliances), including indirect or " +
  "figurative ways (\"plonge la maison dans le noir\", \"il fait trop chaud ici\" said as a request, \"fais-le\" after a proposal) " +
  "and complaints that a previous order was not carried out.\n" +
  "no: questions about state or how things work, chit-chat, requests for information, writing, or anything else.";

export async function askIsOrder(
  client: OpenAI,
  model: string,
  message: string,
  previousReply: string | undefined,
  signal?: AbortSignal
): Promise<{ order: boolean; usage?: TokenUsage }> {
  const context = previousReply ? `Assistant's previous reply: ${previousReply.slice(0, 400)}\n\n` : "";
  const response = await client.chat.completions.create(
    {
      model,
      temperature: 0,
      max_tokens: 3,
      messages: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: `${context}Message: ${message}` },
      ],
    },
    signal ? { signal } : undefined
  );
  const reply = response.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
  return { order: /^(yes|oui)\b/.test(reply), usage: readUsage(response.usage) };
}
