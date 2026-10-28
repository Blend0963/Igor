/**
 * LLM Interface
 *
 * Provider-agnostic interfaces for chat and fact extraction.
 * Concrete implementations (Anthropic, OpenAI, etc.) implement these.
 */

import type { ExtractedFact, Fact } from "../memory/types.js";

// Chat types (LLM-agnostic)
export interface ChatRequest {
  message: string;
  userId: string;
  conversationId?: string;
  isVoice?: boolean;
  customPrompt?: string;
  /** Optional images (data URLs or https URLs) for vision-capable models. */
  images?: string[];
  /**
   * The caller's UI language (e.g. "sl", "en-US"). Used only as a tie-breaker
   * in the system prompt when the user's own words don't indicate a language.
   */
  language?: string;
  /** The panel's model picker: overrides the main model and the fast-model routing. */
  model?: string;
  /** The panel's thinking picker: overrides the configured reasoning effort. */
  reasoning?: "none" | "low" | "medium" | "high";
  /** Aborts the reply (the panel's stop button); what was written is kept. */
  signal?: AbortSignal;
  /**
   * Nobody is there to answer: a scheduled task, the morning briefing, an AI
   * Task request. Tools that need a person's confirmation are withheld
   * (llm/tool-policy.ts).
   */
  unattended?: boolean;
  /**
   * Have the local model read this request's prompt ahead of time, without
   * the person's words, and answer nothing (llm/local-llm.ts): nothing is
   * stored, nothing is learned.
   */
  prewarm?: boolean;
}

/** The tokens one request spent, for the cost counter. */
export interface RequestUsage {
  model: string;
  calls: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

/**
 * Structured failure information emitted when chat produces no usable
 * response (no text and no tool call). The HA integration surfaces
 * `hint` to the user instead of the generic "I received your request but
 * got no response." fallback, so failures are diagnosable from HA Assist
 * without needing server logs.
 */
export interface ChatError {
  code:
    | "EMPTY_CONTENT"
    | "MAX_TOKENS_TRUNCATED"
    | "CONTENT_FILTERED";
  hint: string;
}

export interface ChatResponse {
  response: string;
  toolsUsed: string[];
  factsLearned: number;
  error?: ChatError;
  usage?: RequestUsage;
  /** Stopped by the user before the end. */
  interrupted?: boolean;
  /** What the turn really changed in the house (llm/action-chips.ts). */
  actions?: Array<{ kind: string; label: string }>;
  /** A sentence from the always-on microphone that was not said to Igor:
   *  no answer is given, nothing is spoken or shown. */
  notForMe?: boolean;
}

export type StreamCallback = (chunk: string) => void;

/**
 * What a caller can watch while a reply is produced. A bare `onChunk`
 * function is the historical form and is still accepted everywhere a
 * ChatStreamEvents is; `toStreamEvents` normalizes the two.
 */
export interface ChatStreamEvents {
  /** Text of the reply as the model writes it, every turn included. */
  onChunk?: StreamCallback;
  /**
   * A new assistant message begins: one per model turn. The text before a
   * batch of tool calls and the answer after it are different messages, and a
   * caller that renders them needs the seam.
   */
  onTurn?: () => void;
  /**
   * The server's own heads-up, sent before a batch of tools that will take a
   * while when the model wrote nothing of its own first. Not part of the
   * reply and never stored; a caller may show it and move on.
   */
  onStatus?: (text: string) => void;
}

export function toStreamEvents(
  arg: StreamCallback | ChatStreamEvents | undefined
): ChatStreamEvents {
  if (!arg) return {};
  return typeof arg === "function" ? { onChunk: arg } : arg;
}

// Provider interfaces
export interface IChatEngine {
  chat(request: ChatRequest, events?: StreamCallback | ChatStreamEvents): Promise<ChatResponse>;
}

export interface IFactExtractor {
  extract(
    userMessage: string,
    assistantResponse: string,
    existingFacts?: Fact[]
  ): Promise<ExtractedFact[]>;
}
