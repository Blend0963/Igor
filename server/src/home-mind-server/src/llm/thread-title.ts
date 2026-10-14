/**
 * A short title for a new chat-panel thread, written from its first message
 * the way chat apps do ("Rempotage d'un ficus" rather than "comment je fais
 * pour rempoter mon").
 *
 * One small call on the cheap model (EXTRACTION_MODEL when set), started
 * alongside the reply so it costs no waiting, and a few dozen tokens. Any
 * failure just leaves the thread with its first-message title.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { withReasoningEffort } from "./reasoning-effort.js";

const INSTRUCTION =
  "Write a title for a chat conversation that starts with the message below. " +
  "3 to 6 words, in the language of the message, naming its subject. " +
  "No quotes, no final punctuation, no emoji. Reply with the title only.";

/** The message as the titler reads it: attached files reduced to their names. */
function titleInput(message: string): string {
  return message
    .replace(/<document name="([^"]*)">[\s\S]*?(<\/document>|$)/g, "[file: $1]")
    .slice(0, 1500);
}

/** The first line of the model's reply, cleaned into a title, or undefined. */
export function cleanTitle(raw: string | undefined): string | undefined {
  const line = (raw ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return undefined;
  const title = line
    .replace(/^(title|titre)\s*:\s*/i, "")
    .replace(/^[#*\s"'«“]+|[*\s"'»”.!?:;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return undefined;
  return title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title;
}

export type TitleGenerator = (message: string) => Promise<string | undefined>;

/** A titler for the configured provider, or undefined when none can run. */
export function createTitleGenerator(config: Config): TitleGenerator | undefined {
  const model = config.extractionModel ?? config.llmModel;
  if (config.llmProvider === "anthropic") {
    if (!config.anthropicApiKey) return undefined;
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    return async (message) => {
      try {
        const res = await client.messages.create({
          model,
          max_tokens: 30,
          system: INSTRUCTION,
          messages: [{ role: "user", content: titleInput(message) }],
        });
        return cleanTitle(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
      } catch (error) {
        console.warn("[title] failed:", error instanceof Error ? error.message : error);
        return undefined;
      }
    };
  }
  const apiKey = config.llmProvider === "ollama" ? "ollama" : config.openaiApiKey;
  if (!apiKey) return undefined;
  const baseURL = config.llmProvider === "ollama" ? config.ollamaBaseUrl ?? "http://localhost:11434/v1" : config.openaiBaseUrl;
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: 20000 });
  return async (message) => {
    try {
      const res = await withReasoningEffort(
        model,
        "none",
        (reasoning) =>
          client.chat.completions.create({
            model,
            ...reasoning,
            max_tokens: 30,
            temperature: 0.3,
            messages: [
              { role: "system", content: INSTRUCTION },
              { role: "user", content: titleInput(message) },
            ],
          }),
        client.baseURL
      );
      const content = res.choices[0]?.message?.content as unknown;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join("")
          : "";
      return cleanTitle(text);
    } catch (error) {
      console.warn("[title] failed:", error instanceof Error ? error.message : error);
      return undefined;
    }
  };
}
