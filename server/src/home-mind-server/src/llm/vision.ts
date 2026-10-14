/**
 * What a camera sees, in words: one call to the chat model with the image.
 *
 * Tool results are text, and not every provider takes an image inside the
 * tool loop (Mistral refuses a user message right after a tool message), so
 * look_at_camera asks this separate, single question and hands the answer
 * back as the tool's result.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { withReasoningEffort } from "./reasoning-effort.js";

export type VisionDescriber = (imageDataUrl: string, question: string) => Promise<string>;

const INSTRUCTION =
  "You are looking at a still image from a home security camera, for the owner of the house. " +
  "Describe what is relevant to their question precisely and factually: people (how many, what they do, " +
  "not who they are), vehicles, parcels, animals, doors and lights. Say plainly when the image is dark, " +
  "blurred or shows nothing of interest. Never guess a person's identity. Answer in the language of the question.";

let describer: VisionDescriber | undefined;

export function configureVision(fn: VisionDescriber | undefined): void {
  describer = fn;
}

export function getVision(): VisionDescriber | undefined {
  return describer;
}

export function createVisionDescriber(config: Config): VisionDescriber | undefined {
  if (config.llmProvider === "anthropic") {
    if (!config.anthropicApiKey) return undefined;
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    return async (image, question) => {
      const m = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(image);
      if (!m) throw new Error("not an image");
      const res = await client.messages.create({
        model: config.llmModel,
        max_tokens: 600,
        system: INSTRUCTION,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } },
              { type: "text", text: question },
            ],
          },
        ],
      });
      return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    };
  }
  const apiKey = config.llmProvider === "ollama" ? "ollama" : config.openaiApiKey;
  if (!apiKey) return undefined;
  const baseURL = config.llmProvider === "ollama" ? config.ollamaBaseUrl ?? "http://localhost:11434/v1" : config.openaiBaseUrl;
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: 60000 });
  const mistral = /api\.mistral\.ai/i.test(baseURL ?? "");
  return async (image, question) => {
    const imagePart = mistral
      ? ({ type: "image_url", image_url: image } as unknown as OpenAI.ChatCompletionContentPartImage)
      : ({ type: "image_url", image_url: { url: image, detail: "high" } } as OpenAI.ChatCompletionContentPartImage);
    const res = await withReasoningEffort(
      config.llmModel,
      "none",
      (reasoning) =>
        client.chat.completions.create({
          model: config.llmModel,
          ...reasoning,
          max_tokens: 600,
          messages: [
            { role: "system", content: INSTRUCTION },
            { role: "user", content: [{ type: "text", text: question }, imagePart] },
          ],
        }),
      client.baseURL
    );
    const content = res.choices[0]?.message?.content as unknown;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join("").trim();
    }
    return "";
  };
}
