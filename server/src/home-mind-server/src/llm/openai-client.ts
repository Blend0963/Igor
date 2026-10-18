import { filterTools, type TurnPolicy } from "./tool-policy.js";
import OpenAI from "openai";
import type { Config } from "../config.js";
import type { IMemoryStore } from "../memory/interface.js";
import type { IConversationStore } from "../memory/types.js";
import { HomeAssistantClient } from "../ha/client.js";
import { DeviceScanner } from "../ha/device-scanner.js";
import { TopologyScanner } from "../ha/topology-scanner.js";
import { buildSystemPromptText } from "./prompts.js";
import { toolsForMode, toOpenAITools } from "./tool-definitions.js";
import { listFromEnv, mistralKey } from "./mistral-platform.js";
import { isActionCommand, isSimpleRequest, mayBeOrder } from "./model-router.js";
import { formatLiveState } from "./live-state.js";
import { askIsOrder } from "./order-check.js";
import { SpokenGuard } from "./runaway.js";
import { RECENT_FILE_MESSAGES, shortenAttachedFiles } from "../files/extract.js";
import { randomUUID } from "node:crypto";
import { handleToolCall, extractAndStoreFacts, type ToolContext } from "./tool-handler.js";
import { withTokenCap } from "./token-cap.js";
import { withReasoningEffort, type ReasoningEffort } from "./reasoning-effort.js";
import { describeLongBatch } from "./long-task.js";
import { recallSemantically, rememberSemantically } from "./semantic-recall.js";
import { RECALL_LIMIT, resolveMemoryScope } from "../memory/memory-scope.js";
import { withPromptCacheKey } from "./prompt-cache-key.js";
import {
  readUsage,
  describeUsage,
  spentBudgetOnReasoning,
  WRITTEN_OUTPUT_CAP,
  VOICE_OUTPUT_CAP,
  TRUNCATION_NOTICE,
  VOICE_TRUNCATION_NOTICE,
  type TokenUsage,
  UsageTally,
} from "./usage.js";
import { toStreamEvents } from "./interface.js";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamEvents,
  ChatError,
  StreamCallback,
  IChatEngine,
  IFactExtractor,
} from "./interface.js";

type FunctionToolCall = OpenAI.ChatCompletionMessageFunctionToolCall;

/** The tools of one conversation style, read once per request (env can change in tests). */
function openAIToolsFor(mode: "voice" | "text" | "thread", turn: TurnPolicy = {}): OpenAI.ChatCompletionTool[] {
  return toOpenAITools(
    filterTools(
      toolsForMode(mode, {
        enabled: Boolean(mistralKey()),
        libraryIds: listFromEnv(process.env.MISTRAL_LIBRARY_IDS),
        connectors: listFromEnv(process.env.MISTRAL_CONNECTORS),
      }),
      turn
    )
  );
}

/** Output ceiling of a thread turn that reasons first: the thinking is billed from it too. */
export const THREAD_REASONING_OUTPUT_CAP = 16384;

/** True when a content part is a reasoning block (Mistral's "thinking" chunks). */
function isThinkingPart(content: unknown): boolean {
  return Array.isArray(content) && content.some(
    (part) => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "thinking"
  );
}

/** Links of `attachments` the answer does not already contain, as a block to append. */
export function missingAttachments(text: string, attachments: string[] | undefined): string {
  const missing = [...new Set(attachments ?? [])].filter((md) => {
    const link = md.slice(md.lastIndexOf("(") + 1, -1);
    return !text.includes(link);
  });
  return missing.length ? `\n\n${missing.join("\n\n")}` : "";
}

/**
 * Hard cap on tool round-trips per user message. A model that loops (repeatedly
 * re-searching entities, retrying a tool it misreads as failing) otherwise burns
 * the user's OpenRouter allowance until HA's 120s client timeout cuts it off,
 * with nothing to show for it. On the last iteration we re-ask with tool calling
 * disabled so the user still gets a written answer instead of silence.
 */
const MAX_TOOL_ITERATIONS = 8;

/**
 * A provider-specific field some OpenAI-compatible endpoints attach to a tool
 * call and require back, unchanged, on the next turn. It is not in the OpenAI
 * schema, so the SDK types do not know it.
 */
function extraContentOf(tc: object): unknown {
  return (tc as { extra_content?: unknown }).extra_content;
}

/** Convert provider text blocks to plain text without stringifying objects. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: unknown) => {
    if (typeof part === "string") return part;
    if (typeof part === "object" && part !== null && "text" in part &&
        typeof part.text === "string") {
      return part.text;
    }
    return "";
  }).join("");
}

function historyTimestamp(createdAt: Date | string | undefined): string {
  if (!createdAt) return "";
  const date = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return sameDay ? hhmm : `${date.getDate()} ${date.toLocaleString("en-US", { month: "short" })}, ${hhmm}`;
}

export class OpenAIChatEngine implements IChatEngine {
  private client: OpenAI;
  private memory: IMemoryStore;
  private conversations: IConversationStore;
  private extractor: IFactExtractor;
  private ha: HomeAssistantClient;
  private scanner: DeviceScanner;
  private topology: TopologyScanner;
  private config: Config;

  constructor(
    config: Config,
    memory: IMemoryStore,
    conversations: IConversationStore,
    extractor: IFactExtractor,
    ha: HomeAssistantClient,
    scanner: DeviceScanner,
    topology: TopologyScanner
  ) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/Blend0963/MaDo",
        "X-OpenRouter-Title": "Igor",
        "X-OpenRouter-Categories": "personal-agent",
      },
    });
    this.memory = memory;
    this.conversations = conversations;
    this.extractor = extractor;
    this.ha = ha;
    this.scanner = scanner;
    this.topology = topology;
  }

  async chat(
    request: ChatRequest,
    streamArg?: StreamCallback | ChatStreamEvents
  ): Promise<ChatResponse> {
    const events = toStreamEvents(streamArg);
    const onChunk = events.onChunk;
    const { message, userId, conversationId, isVoice = false, customPrompt, language } = request;
    // Assist (every device) shares one conversation and one fact bucket per
    // user; a panel thread ("mado-thread:") is sealed off with its own
    // history, facts and recall. See memory/memory-scope.ts.
    const scope = resolveMemoryScope(userId, conversationId, this.config.threadMemory);
    const effectiveConversationId = scope.conversationId;
    const toolsUsed: string[] = [];
    let announced = false;
    const turnId = randomUUID(); // nonce for this turn — powers the automation confirmation gate
    // ONE shared context for the whole turn — forget_memory writes
    // suppressExtraction back onto it, so per-call literals would drop the flag.
    const toolCtx: ToolContext = {
      conversationId: effectiveConversationId,
      turnId,
      userId: scope.factBucket,
      memory: this.memory,
      ownerId: userId,
      isThread: scope.isThread,
      unattended: request.unattended === true,
      actions: [],
    };

    // 1. Load user's memory
    const facts = await this.memory.getFactsWithinTokenLimit(
      scope.factBucket,
      this.config.memoryTokenLimit,
      message
    );
    const factContents = facts.map((f) => f.content);
    if (this.config.logLevel === "debug") {
      const approxTokens = Math.ceil(factContents.join(" ").length / 4);
      console.debug(
        `[recall] bucket=${scope.factBucket} factCount=${factContents.length} tokens=${approxTokens}`
      );
    }

    // 2. Refresh device profiles and home layout if stale, then build system prompt
    await Promise.all([this.scanner.refreshIfStale(), this.topology.refreshIfStale()]);
    const deviceCheatSheet = this.scanner.hasProfiles()
      ? this.scanner.formatCheatSheet()
      : undefined;
    const homeLayout = this.topology.hasLayout() ? this.topology.formatSection() : undefined;
    const systemPrompt = buildSystemPromptText(factContents, scope.isThread ? "thread" : isVoice, customPrompt, deviceCheatSheet, homeLayout, language, this.config.ttsVoiceGender);

    // 2b. Split the system prompt for prefix caching (#66 follow-up).
    //
    // Providers with automatic prompt caching (Mistral, OpenAI, OpenRouter)
    // reuse the longest UNCHANGED request prefix. buildSystemPromptText is
    // already ordered volatile-last, but that only helped inside the single
    // system message: it sat first in the payload, and its volatile tail
    // (timestamps) changed every turn — so the remembered facts, the semantic
    // recall and the whole conversation history after it never hit the
    // cache.
    //
    // Splitting at the "## Current Context:" marker fixes both ends:
    //   - messages[0] holds only the stable part — identity, instructions,
    //     home layout, device cheat sheet — which does not change between
    //     turns;
    //   - the volatile remainder (timestamps, remembered facts, semantic
    //     recall) becomes a second system message placed AFTER the history
    //     and immediately BEFORE the current user message, so it reads as
    //     "what is true right now" while the stable prefix AND the
    //     append-only history stay inside the cached region.
    // If the marker is ever missing (prompt format change), everything
    // falls back to the single-message shape, unchanged.
    const CACHE_MARKER = "\n\n## Current Context:";
    const markerIndex = systemPrompt.indexOf(CACHE_MARKER);
    const stableSystemPrompt = markerIndex === -1 ? systemPrompt : systemPrompt.slice(0, markerIndex);
    let volatileSystemPrompt = markerIndex === -1 ? "" : systemPrompt.slice(markerIndex + 2);
    // 3. Load conversation history, then recall what lies beyond it. The
    // history comes first so that recall can skip what the model is about to
    // read anyway: the same message twice is paid twice.
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: stableSystemPrompt },
    ];

    // A thread id is chosen by the caller, so only this user's own turns in
    // it are history; another user's thread under the same id stays theirs.
    const history = (
      await this.conversations.getConversationHistory(effectiveConversationId, scope.historyWindow)
    ).filter((msg) => msg.userId === userId);
    history.forEach((msg, index) => {
      // Files attached long ago keep only an excerpt (see files/extract.ts).
      const old = index < history.length - RECENT_FILE_MESSAGES;
      // Only the user's turns carry the time marker. Stamping the
      // assistant's own past replies taught the model to open its answers
      // with a recited "[09:12]" — it imitates its own history entries —
      // and an unstamped reply right after a stamped user turn is dated
      // already.
      const stamp = msg.role === "user" ? historyTimestamp(msg.createdAt) : "";
      const prefix = stamp ? `[${stamp}] ` : "";
      const content = old ? shortenAttachedFiles(msg.content) : msg.content;
      messages.push({ role: msg.role, content: `${prefix}${content}` });
    });

    // Retrieve distant history strictly by semantic similarity, never by keywords or recency.
    const inHistory = new Set(history.map((msg) => msg.id));
    const semanticMessages = (
      await recallSemantically(this.config, this.conversations, userId, message, RECALL_LIMIT + inHistory.size, scope.recall)
    )
      .filter((msg) => !inHistory.has(msg.id))
      .slice(0, RECALL_LIMIT);
    if (semanticMessages.length > 0) {
      const semanticContext = "## Semantically relevant past conversations\n" +
        "These are retrieved by meaning similarity. They are past memories, NOT the present state of the home.\n" +
        "Never assume a device is still in a remembered state: always verify the current state via get_state or search_entities before acting.\n" +
        "The [time] markers on each entry say WHEN it was said; they are metadata, never part of the message itself — never copy them or start a reply with a timestamp.\n" +
        semanticMessages.map((msg) => {
          const t = historyTimestamp(msg.createdAt);
          return (t ? `[${t}] ` : "") + `[${msg.role}] ${msg.content.slice(0, 700)}`;
        }).join("\n");
      // Appended to the VOLATILE message, so the stable prefix above stays
      // cacheable.
      volatileSystemPrompt = volatileSystemPrompt
        ? `${volatileSystemPrompt}\n\n${semanticContext}`
        : semanticContext;
    }

    // What is on or open right now, read from Home Assistant (llm/live-state.ts).
    // Volatile, so it joins the message after the history.
    try {
      const live = formatLiveState(await this.ha.getEntities());
      if (live) volatileSystemPrompt = volatileSystemPrompt ? `${volatileSystemPrompt}\n\n${live}` : live;
    } catch (error) {
      console.warn(`[live-state] could not read the states: ${error instanceof Error ? error.message : error}`);
    }

    // The volatile context goes after the history, right before the current
    // user message: everything before it is stable or append-only, so the
    // provider can cache it. Mid-conversation system messages are valid on
    // the OpenAI-compatible API (Mistral, OpenAI, OpenRouter and Ollama all
    // accept them), and models read them as current context.
    if (volatileSystemPrompt) {
      messages.push({ role: "system", content: volatileSystemPrompt });
    }

    // 4. Add current user message (multimodal when images are present)
    if (request.images && request.images.length > 0) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: message },
          ...request.images.map((url) => this.imagePart(url)),
        ],
      });
    } else {
      messages.push({ role: "user", content: message });
    }

    // Persist only the text to conversation history (images are ephemeral to this turn).
    if (effectiveConversationId) {
      const messageId = this.conversations.storeMessage(effectiveConversationId, userId, "user", message);
      await rememberSemantically(this.config, this.conversations, messageId, message);
    }

    // 5. Stream and handle tool call loop
    events.onTurn?.();
    // One prompt-cache key per conversation style and memory bucket: those
    // decide the opening of the prompt, which is what the cache stores.
    const promptMode = scope.isThread ? "thread" : isVoice ? "voice" : "text";
    const cacheKey = `igor:${promptMode}:${scope.factBucket}`;
    const turnUsage = new UsageTally();
    const tools = openAIToolsFor(promptMode, { unattended: request.unattended === true });
    // A thread reasons first (Mistral Large 4's hybrid mode, THREAD_REASONING);
    // spoken answers never do: thinking only adds silence and output tokens.
    // A plain command or a quick state question goes to FAST_MODEL when one
    // is set (llm/model-router.ts), without reasoning; everything else stays
    // on the main model.
    // A model or thinking level picked in the panel wins over both.
    const fastModel =
      !request.model && this.config.fastModel && isSimpleRequest({ message, hasImages: Boolean(request.images?.length) })
        ? this.config.fastModel
        : undefined;
    let model = request.model ?? fastModel ?? this.config.llmModel;
    let effort = request.reasoning
      ?? (fastModel
        ? "none"
        : scope.isThread
          ? this.config.threadReasoning
          : this.config.reasoningEffort ?? (isVoice ? "none" : undefined));
    if (fastModel) console.log(`[route] fast model ${fastModel} for: ${message.slice(0, 60)}`);
    let thinkingShown = false;
    // The text of the model turn being streamed, kept for the stop button:
    // what was already written stays in the thread.
    let turnText = "";
    const signal = request.signal;
    // An order's first answer is held back until it is known to have acted:
    // one that claims "c'est éteint" without calling a tool is thrown away
    // and asked again (below), and must not have been spoken already.
    // An order in words the verb list does not know is recognised by a model,
    // asked in parallel with the first answer so that it adds no wait when
    // the answer called a tool anyway (llm/order-check.ts).
    const knownOrder = isActionCommand(message);
    const lastReply = [...history].reverse().find((msg) => msg.role === "assistant")?.content;
    const orderCheck =
      !knownOrder && !request.images?.length && mayBeOrder(message)
        ? askIsOrder(this.client, this.config.fastModel ?? this.config.llmModel, message, lastReply, signal).catch((error) => {
            if (!signal?.aborted) console.warn(`[route] order check failed (${error instanceof Error ? error.message : error})`);
            return { order: false, usage: undefined };
          })
        : undefined;
    let holding = knownOrder || orderCheck !== undefined;
    let held = "";
    // A "no" that comes in while the answer is still streaming lets it through
    // at once: only orders are held back.
    void orderCheck?.then((verdict) => {
      turnUsage.add(verdict.usage);
      if (!verdict.order && holding && !knownOrder) {
        holding = false;
        if (held) onChunk?.(held);
        held = "";
      }
    });
    const sink = (chunk: string) => {
      turnText += chunk;
      if (holding) held += chunk;
      else onChunk?.(chunk);
    };
    const call = async (forceAnswer: boolean, toolChoice?: "required") => {
      turnText = "";
      const once = () =>
        this.streamCompletion(messages, isVoice, sink, forceAnswer, conversationId || effectiveConversationId, cacheKey, {
          tools,
          effort,
          model,
          signal,
          toolChoice,
          isThread: scope.isThread,
          onThinking: () => {
            if (thinkingShown) return;
            thinkingShown = true;
            events.onStatus?.("Réflexion…");
          },
        });
      try {
        return await once();
      } catch (error) {
        // A fast model that is misspelled or unavailable must not cost the
        // user an answer: fall back to the main model for the rest of the turn.
        if (model === this.config.llmModel || signal?.aborted) throw error;
        console.warn(`[route] ${model} failed (${error instanceof Error ? error.message : error}); using ${this.config.llmModel}`);
        model = this.config.llmModel;
        effort = scope.isThread ? this.config.threadReasoning : this.config.reasoningEffort ?? (isVoice ? "none" : undefined);
        turnText = "";
        return once();
      }
    };
    let interrupted = false;
    let result: Awaited<ReturnType<typeof call>>;
    try {
      result = await call(false);
      turnUsage.add(result.usage);
      if (holding) {
        holding = false;
        let order = knownOrder;
        if (result.toolCalls.length === 0 && !order && orderCheck) {
          order = (await orderCheck).order;
        }
        if (result.toolCalls.length === 0 && order) {
          // "C'est fait" without doing it: small models do this on plain
          // commands. Ask again on the main model, which must call a tool.
          console.warn(`[route] ${model} answered a command without acting; asking ${this.config.llmModel} with a required tool call`);
          const firstModel = model;
          const first = result;
          model = this.config.llmModel;
          try {
            result = await call(false, "required");
            turnUsage.add(result.usage);
          } catch (error) {
            if (signal?.aborted) throw error;
            // An endpoint that refuses tool_choice "required": keep the first answer.
            console.warn(`[route] retry failed (${error instanceof Error ? error.message : error}); keeping the first answer`);
            model = firstModel;
            result = first;
            if (held) onChunk?.(held);
          }
        } else if (held) {
          onChunk?.(held);
        }
        held = "";
      }

      let iterations = 0;
      // Run whatever tool calls arrived, whatever the finish_reason says: some
      // OpenAI-compatible endpoints report "stop" on a turn that calls tools.
      while (result.toolCalls.length > 0) {
        if (signal?.aborted) throw new Error("aborted");
        iterations++;

        // Add assistant message with tool calls
        messages.push({
          role: "assistant",
          content: result.text || null,
          tool_calls: result.toolCalls,
        });

        // The batch is known and nothing has run yet: this is the one moment to
        // warn the person waiting that it will take a while. If the model wrote
        // a sentence of its own before the calls, that sentence has already been
        // streamed and is the warning; otherwise the server's own goes out.
        if (!announced) {
          const heads = describeLongBatch(
            result.toolCalls.map((tc) => ({ name: tc.function.name, args: parseArgs(tc) }))
          );
          if (heads) {
            announced = true;
            if (result.text.trim() === "") events.onStatus?.(heads);
          }
        }

        // Execute all tool calls in parallel
        const toolPromises = result.toolCalls.map(async (tc: FunctionToolCall) => {
          toolsUsed.push(tc.function.name);

          // Cheap models sometimes emit truncated or non-JSON arguments. Hand that
          // back as a tool error the model can recover from — throwing here would
          // reject the whole Promise.all and fail the user's request outright.
          let args: Record<string, unknown>;
          try {
            args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            console.warn(
              `[tool] ${tc.function.name} got unparseable arguments: ${tc.function.arguments}`
            );
            return {
              role: "tool" as const,
              tool_call_id: tc.id,
              content: JSON.stringify({
                error:
                  `Arguments for ${tc.function.name} were not valid JSON and could not be read. ` +
                  `Call the tool again with valid JSON arguments.`,
              }),
            };
          }

          const toolResult = await handleToolCall(this.ha, tc.function.name, args, toolCtx);
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            // Compact: indentation is whitespace the model reads and is billed
            // for, on every later call of the loop.
            content: JSON.stringify(toolResult),
          };
        });

        const toolResults = await Promise.all(toolPromises);
        messages.push(...toolResults);

        // Continue streaming. On the final allowed iteration, disable tool calling
        // so the model has to answer in words rather than loop again.
        const forceAnswer = iterations >= MAX_TOOL_ITERATIONS;
        if (forceAnswer) {
          console.warn(
            `[llm] tool loop hit ${MAX_TOOL_ITERATIONS} iterations — forcing a final answer`
          );
        }
        events.onTurn?.();
        result = await call(forceAnswer);
        turnUsage.add(result.usage);
        if (forceAnswer) break;
      }
    } catch (error) {
      if (!signal?.aborted) throw error;
      // Stopped by the user: keep what this turn had written.
      interrupted = true;
      result = { text: turnText, finishReason: null, toolCalls: [], usage: undefined };
      console.log(`[llm] stopped by the user after ${turnText.length} characters`);
    }

    // Files the tools produced (charts, images) that the answer does not
    // show yet go after it, streamed like the rest, and stored with it.
    // Only in a thread: a spoken answer would read the link out loud.
    const extraMedia = scope.isThread && !interrupted ? missingAttachments(result.text, toolCtx.attachments) : "";
    if (extraMedia) onChunk?.(extraMedia);
    const responseText = interrupted
      ? `${result.text.trimEnd()}${result.text.trim() ? "\n\n" : ""}*[Réponse interrompue]*`
      : result.text + extraMedia;

    console.log(`[usage] ${promptMode} ${turnUsage.describe()} tools=${toolsUsed.length} model=${model}`);

    // 6. Store assistant response
    if (effectiveConversationId && responseText) {
      const stored = this.conversations.storeMessage(effectiveConversationId, userId, "assistant", responseText);
      if (toolCtx.actions?.length) void this.conversations.setMessageActions?.(stored, toolCtx.actions);
    }

    // 7. Extract and store facts (fire-and-forget). Memories a forget_memory
    // call touched this turn are filtered out of the extraction so they can't
    // be re-learned from the "forget that X" transcript.
    if (!interrupted) {
      extractAndStoreFacts(
        this.memory,
        this.extractor,
        scope.factBucket,
        message,
        responseText,
        toolCtx.forgetTargets
      ).catch((err) => console.error("Fact extraction failed:", err));
    }

    // 8. If the model produced no usable response, attach a structured error
    // so the HA integration can surface a useful hint instead of the generic
    // "I received your request but got no response." fallback. The `finish_reason`
    // from the final stream tells us which diagnostic applies.
    const error = responseText === "" && result.toolCalls.length === 0
      ? this.classifyEmptyResponse(result.finishReason, result.usage)
      : undefined;

    // A reply that ran out of room but did write something is the *common* case,
    // and it used to be delivered silently: the integration returns the text
    // whenever there is any, so `error` never reached the reader and a sentence
    // stopping in the middle looked like the assistant's own choice. Say so in
    // the reply itself, which is the only channel every caller shares.
    const truncated = result.finishReason === "length" && responseText !== "";
    const response = truncated
      ? responseText + (isVoice ? VOICE_TRUNCATION_NOTICE : TRUNCATION_NOTICE)
      : responseText;

    return {
      response,
      toolsUsed,
      ...(toolCtx.actions?.length ? { actions: toolCtx.actions } : {}),
      factsLearned: 0,
      ...(error && !interrupted ? { error } : {}),
      usage: { model, ...turnUsage.totals() },
      ...(interrupted ? { interrupted: true } : {}),
    };
  }

  private classifyEmptyResponse(
    finishReason: string | null,
    usage?: TokenUsage
  ): ChatError {
    if (finishReason === "length") {
      // The output cap covers hidden reasoning as well as the visible answer, so
      // a reasoning-heavy turn can exhaust it without writing a single word.
      // That needs different advice from a prompt being too large, and the two
      // are only distinguishable from the reported token counts. This used to be
      // decided by which spelling of the cap parameter the model accepted, which
      // told us nothing on providers that accept both.
      const hint = spentBudgetOnReasoning(usage)
        ? "Igor ran out of room before it could write the answer. The model " +
          "spent this turn's budget working the problem out and had none left " +
          "for the reply. A shorter time range, or fewer sensors in one " +
          "question, will usually get it through."
        : "Igor ran out of room before it could finish the answer. A shorter " +
          "time range, or fewer sensors in one question, will usually get it " +
          "through.";
      return { code: "MAX_TOKENS_TRUNCATED", hint };
    }
    if (finishReason === "content_filter") {
      return {
        code: "CONTENT_FILTERED",
        hint:
          "The provider blocked the response (content filter). " +
          "If this happens on benign smart-home commands, try a different model.",
      };
    }
    return {
      code: "EMPTY_CONTENT",
      hint:
        "The model returned no text and no tool calls. " +
        "If you're routing through an OpenAI-compatible shim/proxy, verify it streams " +
        "OpenAI-format SSE chunks. For local models, ensure the model emits a final " +
        "answer rather than just thinking. For the fact extractor specifically, set " +
        "OPENAI_RESPONSE_FORMAT=json_object on picky providers (e.g. some Ollama models).",
    };
  }


  /** Ceiling on one reply; see WRITTEN_OUTPUT_CAP for why it is what it is. */
  private maxOutputTokens(isVoice: boolean, reasoningThread = false): number {
    if (this.config.maxOutputTokens) return this.config.maxOutputTokens;
    if (isVoice) return VOICE_OUTPUT_CAP;
    return reasoningThread ? THREAD_REASONING_OUTPUT_CAP : WRITTEN_OUTPUT_CAP;
  }

  /** True when the endpoint is OpenRouter, where its own request fields apply. */
  private isOpenRouter(): boolean {
    return /openrouter\.ai/i.test(this.config.openaiBaseUrl ?? "");
  }

  /**
   * One image of a user message. OpenAI's shape is an object with a `detail`
   * hint ("low" keeps routine camera snapshots cheap). Mistral documents
   * `image_url` as a plain string and rejects fields it does not know, so it
   * gets the URL (or data URL) alone.
   */
  private imagePart(url: string): OpenAI.ChatCompletionContentPartImage {
    if (this.isMistral()) {
      return { type: "image_url", image_url: url } as unknown as OpenAI.ChatCompletionContentPartImage;
    }
    return { type: "image_url", image_url: { url, detail: "low" } };
  }

  /** Mistral rejects stream_options on its OpenAI-compatible chat endpoint. */
  private isMistral(): boolean {
    return /api\.mistral\.ai/i.test(this.config.openaiBaseUrl ?? "");
  }

  private async streamCompletion(
    messages: OpenAI.ChatCompletionMessageParam[],
    isVoice: boolean,
    onChunk?: StreamCallback,
    disableTools = false,
    sessionId?: string,
    cacheKey?: string,
    opts: {
      tools?: OpenAI.ChatCompletionTool[];
      effort?: ReasoningEffort;
      model?: string;
      signal?: AbortSignal;
      isThread?: boolean;
      onThinking?: () => void;
      /** "required": the model must call a tool on this call. */
      toolChoice?: "required";
    } = {}
  ): Promise<{
    text: string;
    finishReason: string | null;
    toolCalls: FunctionToolCall[];
    usage?: TokenUsage;
  }> {
    const effort = "effort" in opts ? opts.effort : this.config.reasoningEffort ?? (isVoice ? "none" : undefined);
    const model = opts.model ?? this.config.llmModel;
    const cap = this.maxOutputTokens(isVoice, Boolean(opts.isThread && effort && effort !== "none"));
    const tools = opts.tools ?? openAIToolsFor(isVoice ? "voice" : "text");
    const startedAt = Date.now();
    const stream = await withTokenCap(model, cap, (capParam) =>
      withReasoningEffort(
        model,
        // Chosen by chat(): high in a thread by default, none for voice, the
        // configured REASONING_EFFORT otherwise. A model that refuses the
        // parameter stops getting it.
        effort,
        (reasoning) =>
          withPromptCacheKey(model, cacheKey, (cache) =>
          this.client.chat.completions.create({
            model: model,
            ...capParam,
            ...reasoning,
            ...cache,
            messages,
            tools,
            // Keep the tool list in the request (history already references it) but
            // stop the model from issuing more calls.
            ...(disableTools ? { tool_choice: "none" as const } : opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
            stream: true,
            // Ask for the token breakdown. Without this a streamed call reports no
            // usage at all, which is why a cap being spent entirely on reasoning
            // looked identical to a prompt being too large.
            ...(!this.isMistral() ? { stream_options: { include_usage: true } } : {}),
            // OpenRouter only: a stable session id pins the follow-up turns of one
            // conversation to the provider endpoint that already holds the warm
            // prompt cache, instead of re-balancing every turn. Other endpoints
            // reject unknown fields, so it is not sent to them.
            ...(this.isOpenRouter() && sessionId ? { session_id: sessionId } : {}),
          } as OpenAI.ChatCompletionCreateParamsStreaming, opts.signal ? { signal: opts.signal } : undefined), this.client.baseURL),
        this.client.baseURL
      )
    );

    let text = "";
    let finishReason: string | null = null;
    // A spoken reply is passed on sentence by sentence and cut if it loops.
    const spoken = isVoice ? new SpokenGuard() : undefined;
    let usage: TokenUsage | undefined;
    // OpenRouter names the provider that served the request on every chunk.
    // Which one it was is the difference between a 1 s and a 3 s first token.
    let provider: string | undefined;

    // Tool calls in arrival order. OpenAI streams one call over several deltas
    // that share an `index`; other OpenAI-compatible endpoints send each call
    // whole, with its own `id` and no `index`. A delta continues the call its
    // index points at (or, without an index, the latest one) unless it carries
    // a different id, which always opens a new call.
    const calls: { id: string; name: string; arguments: string; extraContent?: unknown }[] = [];
    const callAtIndex = new Map<number, number>();

    for await (const chunk of stream) {
      // The usage chunk arrives last and carries no choices, so read it before
      // the guard below skips it.
      if (chunk.usage) usage = readUsage(chunk.usage);
      const served = (chunk as { provider?: unknown }).provider;
      if (typeof served === "string" && served) provider = served;

      const choice = chunk.choices[0];
      if (!choice) continue;

      // Provider APIs may return text as content blocks rather than a string.
      // Normalize each delta before storing or forwarding it to Home Assistant/TTS.
      if (opts.onThinking && isThinkingPart(choice.delta?.content)) opts.onThinking();
      const raw = contentToText(choice.delta?.content);
      const chunkText = spoken ? spoken.push(raw) : raw;
      if (chunkText) {
        text += chunkText;
        if (onChunk) {
          onChunk(chunkText);
        }
      }
      if (spoken?.stopped) {
        // A looping reply: the rest of the stream is not read (leaving the
        // loop closes the request), and the turn ends on what was said.
        console.warn(`[llm] ${model} started repeating itself (${spoken.reason}); spoken reply cut there`);
        finishReason = "stop";
        break;
      }

      // Accumulate tool call deltas
      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const at = tc.index === undefined ? calls.length - 1 : callAtIndex.get(tc.index);
          const existing = at === undefined ? undefined : calls[at];
          const isOtherCall = Boolean(existing && tc.id && existing.id && tc.id !== existing.id);
          if (existing && !isOtherCall) {
            // Append to existing tool call's arguments
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
            }
            existing.extraContent ??= extraContentOf(tc);
          } else {
            calls.push({
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              arguments: tc.function?.arguments ?? "",
              extraContent: extraContentOf(tc),
            });
            if (tc.index !== undefined) callAtIndex.set(tc.index, calls.length - 1);
          }
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }

    const rest = spoken?.flush();
    if (rest) {
      text += rest;
      onChunk?.(rest);
    }

    // Convert accumulated tool calls to the expected format
    const toolCalls: FunctionToolCall[] = [];
    for (const tc of calls) {
      toolCalls.push({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
        // Handed back untouched in the assistant message; absent when not sent.
        ...(tc.extraContent !== undefined ? { extra_content: tc.extraContent } : {}),
      });
    }

    // A cap that runs out is worth a line in the log whatever it interrupted.
    // It cuts tool-call arguments mid-JSON as readily as it cuts an answer, and
    // that case leaves no trace at all in the reply the user sees.
    if (finishReason === "length") {
      console.warn(
        `[llm] output cap reached: cap=${cap} ${describeUsage(usage)} ` +
          `visible_chars=${text.length} tool_calls=${toolCalls.length} ` +
          `model=${model}${provider ? ` provider=${provider}` : ""}`
      );
    } else if (this.config.logLevel === "debug") {
      // Knowing what a *successful* turn cost is what tells you how close the
      // ceiling is. Reading usage only from failures shows the cases that
      // already went wrong and nothing about the margin on the rest.
      console.log(
        `[llm] turn ok: cap=${cap} ${describeUsage(usage)} ` +
          `finish=${finishReason ?? "none"} tool_calls=${toolCalls.length} ` +
          `ms=${Date.now() - startedAt}${provider ? ` provider=${provider}` : ""}`
      );
    }

    return { text, finishReason, toolCalls, usage };
  }
}

/** Tool-call arguments as an object; `{}` when they are not valid JSON. */
function parseArgs(tc: FunctionToolCall): Record<string, unknown> {
  try {
    const parsed = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
