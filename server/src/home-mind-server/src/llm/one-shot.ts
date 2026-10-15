/**
 * One short, tool-less call on the cheap model (FAST_MODEL, else
 * EXTRACTION_MODEL, else the main model): a system text, a user text, the
 * reply's text. For background jobs that need a judgement and a few words,
 * not a conversation (the house watch). Any failure returns undefined; the
 * caller decides what to do without the model.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { withReasoningEffort } from "./reasoning-effort.js";

export type OneShot = (system: string, user: string, maxTokens?: number) => Promise<string | undefined>;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join("");
  }
  return "";
}

export function createOneShot(config: Config, label = "one-shot"): OneShot | undefined {
  const model = config.fastModel ?? config.extractionModel ?? config.llmModel;
  if (config.llmProvider === "anthropic") {
    if (!config.anthropicApiKey) return undefined;
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    return async (system, user, maxTokens = 400) => {
      try {
        const res = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
        return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      } catch (error) {
        console.warn(`[${label}] failed:`, error instanceof Error ? error.message : error);
        return undefined;
      }
    };
  }
  const apiKey = config.llmProvider === "ollama" ? "ollama" : config.openaiApiKey;
  if (!apiKey) return undefined;
  const baseURL = config.llmProvider === "ollama" ? config.ollamaBaseUrl ?? "http://localhost:11434/v1" : config.openaiBaseUrl;
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: 30000 });
  return async (system, user, maxTokens = 400) => {
    try {
      const res = await withReasoningEffort(
        model,
        "none",
        (reasoning) =>
          client.chat.completions.create({
            model,
            ...reasoning,
            max_tokens: maxTokens,
            temperature: 0.3,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        client.baseURL
      );
      return textOf(res.choices[0]?.message?.content as unknown).replace(/<think>[\s\S]*?<\/think>/gi, "");
    } catch (error) {
      console.warn(`[${label}] failed:`, error instanceof Error ? error.message : error);
      return undefined;
    }
  };
}
