import { filterTools, type TurnPolicy } from "./tool-policy.js";
import OpenAI from "openai";
import type { Config } from "../config.js";
import type { IMemoryStore } from "../memory/interface.js";
import type { IConversationStore } from "../memory/types.js";
import { HomeAssistantClient } from "../ha/client.js";
import { DeviceScanner } from "../ha/device-scanner.js";
import { TopologyScanner } from "../ha/topology-scanner.js";
import { formatScriptSection } from "../ha/script-catalog.js";
import { buildSystemPromptText, formatDateTimeWithOffset } from "./prompts.js";
import { toolsForMode, toOpenAITools } from "./tool-definitions.js";
import { listFromEnv, mistralKey } from "./mistral-platform.js";
import { isActionCommand, isSimpleRequest, mayBeOrder, selectThreadReasoning } from "./model-router.js";
import { formatLiveState } from "./live-state.js";
import { askIsOrder } from "./order-check.js";
import { BRIEFING_HISTORY, BRIEFING_THREAD_ID, leanMode, SPOKEN_LENGTH_REMINDER, spokenSentenceCap } from "./lean.js";
import { ADDRESSEE_INSTRUCTIONS, addresseeQuestion, checkAddressee, needsAddresseeCheck } from "./addressee-check.js";
import { SpokenGuard } from "./runaway.js";
import { RECENT_FILE_MESSAGES, shortenAttachedFiles } from "../files/extract.js";
import { randomUUID } from "node:crypto";
import { handleToolCall, extractAndStoreFacts, type ToolContext } from "./tool-handler.js";
import { withTokenCap } from "./token-cap.js";
import { withReasoningEffort, type ReasoningEffort } from "./reasoning-effort.js";
import { describeLongBatch } from "./long-task.js";
import { recallSemantically, rememberSemantically } from "./semantic-recall.js";
import { DEFAULT_MESSAGE_CAP, isThreadId, RECALL_LIMIT, resolveMemoryScope } from "../memory/memory-scope.js";
import { withPromptCacheKey } from "./prompt-cache-key.js";
import {
  createLocalClient,
  DONE_TIMEOUT_MS,
  GENERAL_UNAVAILABLE,
  LOCAL_OUTPUT_CAP,
  ONLINE_REPLY_INSTRUCTIONS,
  onlineFacts,
  LOCAL_HISTORY,
  LOCAL_REMINDER,
  LOCAL_SAMPLING,
  LOCAL_TOOLS,
  LOCAL_UNAVAILABLE,
  localPersona,
  ONLINE_SPOKEN_STYLE,
  PREWARM_EVERY_MS,
  SHARE_MEMORY,
  SHARE_MEMORY_TOOL,
  shareMemory,
} from "./local-llm.js";
import { actionSentence, needsLocalFollowUp, type DoneCall } from "./action-sentence.js";
import { OpenAIFactExtractor } from "../memory/openai-extractor.js";
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
/** How many times a thread reply that hit the output cap is continued. */
export const THREAD_CONTINUATIONS = 3;
const CONTINUE_INSTRUCTION =
  "Your previous message was cut off by the length limit. Continue it exactly where it stopped " +
  "(mid-sentence, mid-table or mid-code-block if needed), without repeating anything and without any introduction.";

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
  /** The house's own model (llm/local-llm.ts), for Assist; unset = none. */
  private local?: { client: OpenAI; model: string; extractor: IFactExtractor };
  /** The last spoken Assist request on the local model, replayed by the prewarm. */
  private lastVoice?: Pick<ChatRequest, "userId" | "conversationId" | "customPrompt" | "language">;
  /** Local Assist requests being answered: the prewarm waits for none. */
  private localInFlight = 0;
  private prewarming = false;
  /** Stops a prewarm under way, so that a request never waits behind one. */
  private prewarmAbort?: AbortController;
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
    if (config.localLlmUrl) {
      const client = createLocalClient(config.localLlmUrl, config.localLlmKey);
      this.local = {
        client,
        model: config.localLlmModel,
        extractor: new OpenAIFactExtractor(config.localLlmKey || "none", config.localLlmModel, client.baseURL, "json_object", config.openaiMaxTokens),
      };
      // Until a first spoken request says who speaks, the configured voice
      // persona already gives the long, stable start of the prompt.
      const persona = [config.customPrompt, config.customPromptVoice].map((p) => p?.trim()).filter(Boolean).join("\n\n");
      this.lastVoice = { userId: "default", customPrompt: persona || undefined };
      if (config.localLlmPrewarm) {
        setInterval(() => void this.prewarm(), PREWARM_EVERY_MS).unref();
        setTimeout(() => void this.prewarm(), 5_000).unref();
      }
    }
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
    const local = this.local && !request.prewarm && !isThreadId(request.conversationId) && !request.images?.length;
    if (!local) return this.runChat(request, streamArg);
    this.localInFlight++;
    // The card serves one request at a time: a prewarm under way would make
    // this one wait for it.
    this.prewarmAbort?.abort();
    try {
      return await this.runChat(request, streamArg);
    } finally {
      this.localInFlight--;
      if (request.isVoice && !request.unattended) {
        this.lastVoice = { userId: request.userId, conversationId: request.conversationId, customPrompt: request.customPrompt, language: request.language };
      }
      // The history just changed: read the next prompt now, after the memory
      // extraction this turn queued on the same card.
      void this.prewarm();
    }
  }

  /**
   * Has the local model read the next spoken request's prompt, minus the
   * person's words, so that a request only has those left to read. Skipped
   * while a request is being answered, and never two at once.
   */
  private async prewarm(): Promise<void> {
    if (!this.local || !this.config.localLlmPrewarm || !this.lastVoice || this.prewarming || this.localInFlight > 0) return;
    this.prewarming = true;
    const controller = new AbortController();
    this.prewarmAbort = controller;
    try {
      await this.runChat({ ...this.lastVoice, message: "", isVoice: true, prewarm: true, signal: controller.signal });
    } catch (error) {
      if (this.config.logLevel === "debug") console.debug(`[prewarm] ${error instanceof Error ? error.message : error}`);
    } finally {
      this.prewarming = false;
      if (this.prewarmAbort === controller) this.prewarmAbort = undefined;
    }
  }

  private async runChat(
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
      noLongTermMemory: !scope.facts,
      actions: [],
    };

    // Assist on the house's own model, when there is one (llm/local-llm.ts).
    // Images need a model that sees; none of the local ones does yet.
    const local = this.local && !scope.isThread && !request.images?.length ? this.local : undefined;

    // 0. A spoken sentence that names Igor after its opening may only talk
    // about it ("c'est Igor qui a éteint"): a small call decides, alongside
    // the memory loading below, before the main model is ever called.
    const addressee =
      isVoice && !scope.isThread && !request.unattended && needsAddresseeCheck(message)
        ? checkAddressee((signal) => this.askAddressee(message, signal), request.signal)
        : undefined;

    // 1-3. Everything the prompt needs, read at once: none of these reads
    // depends on another, and run one after the other they cost a second
    // before the model was even called. In lean mode (llm/lean.ts) some are
    // skipped altogether.
    const lean = leanMode();
    const startedAt = Date.now();
    const timing: Record<string, number> = {};
    const timed = <T>(name: string, work: () => Promise<T> | T): Promise<T> =>
      Promise.resolve()
        .then(work)
        .finally(() => {
          timing[name] = Date.now() - startedAt;
        });
    // Lean: Assist reads its whole stored conversation instead of searching
    // it by meaning, and the morning briefing only its last messages.
    const historyWindow = local
      ? LOCAL_HISTORY
      : !lean
      ? scope.historyWindow
      : effectiveConversationId === BRIEFING_THREAD_ID
        ? BRIEFING_HISTORY
        : scope.isThread
          ? scope.historyWindow
          : DEFAULT_MESSAGE_CAP;
    // Recall embeds the message on Mistral: not for a local request.
    const useRecall = (!lean || scope.isThread) && !local;
    const [facts, , scripts, storedHistory, recalled, liveStates] = await Promise.all([
      scope.facts
        ? timed("memory", () =>
            // Lean: by tag only; Shodh's proactive search took ≈ 420 ms.
            this.memory.getFactsWithinTokenLimit(scope.factBucket, this.config.memoryTokenLimit, lean ? undefined : message)
          )
        : [],
      timed("house", () => Promise.all([this.scanner.refreshIfStale(), this.topology.refreshIfStale()])),
      // The scripts it may run, with their fields: not in any entity's state.
      timed("scripts", () => this.ha.listScripts()).catch(() => []),
      timed("history", () => this.conversations.getConversationHistory(effectiveConversationId, historyWindow)),
      useRecall
        ? timed("recall", () =>
            recallSemantically(this.config, this.conversations, userId, message, RECALL_LIMIT + historyWindow, scope.recall)
          )
        : [],
      // What is on or open right now (llm/live-state.ts).
      timed("live", () => this.ha.getEntities()).catch((error) => {
        console.warn(`[live-state] could not read the states: ${error instanceof Error ? error.message : error}`);
        return undefined;
      }),
    ]);
    const factContents = facts.map((f) => f.content);
    if (this.config.logLevel === "debug") {
      const approxTokens = Math.ceil(factContents.join(" ").length / 4);
      console.debug(
        `[recall] bucket=${scope.factBucket} factCount=${factContents.length} tokens=${approxTokens}`
      );
    }

    const scriptSection = formatScriptSection(scripts);
    const deviceCheatSheet = [this.scanner.hasProfiles() ? this.scanner.formatCheatSheet() : undefined, scriptSection]
      .filter(Boolean)
      .join("\n\n") || undefined;
    const homeLayout = this.topology.hasLayout() ? this.topology.formatSection() : undefined;
    // The local model gets a working identity, not the persona: Igor is
    // played by the online model, which words the replies.
    const promptPersona = local ? localPersona(this.config.localLlmPrompt) : customPrompt;
    const systemPrompt = buildSystemPromptText(factContents, scope.isThread ? "thread" : isVoice, promptPersona, deviceCheatSheet, homeLayout, language, this.config.ttsVoiceGender, scope.facts, Boolean(local));

    // Split the system prompt for prefix caching (#66 follow-up).
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
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: stableSystemPrompt },
    ];

    // A thread id is chosen by the caller, so only this user's own turns in
    // it are history; another user's thread under the same id stays theirs.
    const history = storedHistory.filter((msg) => msg.userId === userId);
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

    // Distant history, strictly by semantic similarity, never by keywords or
    // recency; what the history above already holds is not sent twice.
    const inHistory = new Set(history.map((msg) => msg.id));
    const semanticMessages = recalled
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
    // Not for the local model: the list changes all the time, so it had to be
    // read again at every request and every minute (≈ 650 tokens, 8-12 s on
    // its card); it reads a state with get_state when a request needs it.
    const live = liveStates && !local ? formatLiveState(liveStates) : undefined;
    if (live) volatileSystemPrompt = volatileSystemPrompt ? `${volatileSystemPrompt}\n\n${live}` : live;

    // A spoken reply is short: said last, right before the person's words.
    const sentenceCap = isVoice && !scope.isThread ? spokenSentenceCap(message) : undefined;
    if (sentenceCap !== undefined) {
      volatileSystemPrompt = volatileSystemPrompt ? `${volatileSystemPrompt}\n\n${SPOKEN_LENGTH_REMINDER}` : SPOKEN_LENGTH_REMINDER;
    }
    if (local) volatileSystemPrompt = volatileSystemPrompt ? `${volatileSystemPrompt}\n\n${LOCAL_REMINDER}` : LOCAL_REMINDER;

    // The volatile context goes after the history, right before the current
    // user message: everything before it is stable or append-only, so the
    // provider can cache it. Mid-conversation system messages are valid on
    // the OpenAI-compatible API (Mistral, OpenAI, OpenRouter and Ollama all
    // accept them), and models read them as current context.
    if (volatileSystemPrompt) {
      messages.push({ role: "system", content: volatileSystemPrompt });
    }

    const promptMode = scope.isThread ? "thread" : isVoice ? "voice" : "text";
    const allTools = openAIToolsFor(promptMode, { unattended: request.unattended === true, noMemory: !scope.facts });
    // The local model also hands the online one the memories a reply needs.
    const tools = local
      ? [...allTools.filter((t) => t.type === "function" && LOCAL_TOOLS.has(t.function.name)), ...(scope.facts ? [SHARE_MEMORY_TOOL] : [])]
      : allTools;

    if (request.prewarm) {
      // Everything a spoken request sends before the person's words, read
      // now; a placeholder stands for the words, which the template needs.
      if (local) {
        const startedAt = Date.now();
        const response = await local.client.chat.completions.create(
          {
            model: local.model,
            messages: [...messages, { role: "user", content: "…" }],
            tools,
            max_tokens: 1,
          },
          request.signal ? { signal: request.signal } : undefined
        );
        const t = (response as { timings?: { prompt_n?: number; cache_n?: number } }).timings;
        if (t?.prompt_n) console.log(`[prewarm] read ${t.prompt_n} new tokens (${t.cache_n ?? 0} from cache) in ${Date.now() - startedAt}ms`);
      }
      return { response: "", toolsUsed: [], factsLearned: 0 };
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

    if (addressee) {
      const verdict = await addressee;
      if (!verdict.forMe) {
        // Not said to Igor: nothing answered, spoken or kept.
        const usage = new UsageTally();
        usage.add(verdict.usage);
        console.log(`[addressee] not for Igor, main model not called: ${message.slice(0, 80)}`);
        return { response: "", toolsUsed, factsLearned: 0, notForMe: true, usage: { model: this.addresseeModel(), ...usage.totals() } };
      }
    }

    // Persist only the text to conversation history (images are ephemeral to this turn).
    let userMessageId: string | undefined;
    if (effectiveConversationId) {
      const messageId = this.conversations.storeMessage(effectiveConversationId, userId, "user", message);
      userMessageId = messageId;
      // Only recall reads these vectors: none in lean Assist, and a thread
      // needs this one only from its next turn on, so it is not waited for.
      if (!lean && !local) await rememberSemantically(this.config, this.conversations, messageId, message);
      else if (scope.isThread) void rememberSemantically(this.config, this.conversations, messageId, message);
    }

    // 5. Stream and handle tool call loop
    const modelStartedAt = Date.now();
    let firstTextAt = 0;
    events.onTurn?.();
    // One prompt-cache key per conversation style and memory bucket: those
    // decide the opening of the prompt, which is what the cache stores.
    const cacheKey = `igor:${promptMode}:${scope.factBucket}`;
    const turnUsage = new UsageTally();
    // A thread reasons first (Mistral Large 4's hybrid mode, THREAD_REASONING);
    // spoken answers never do: thinking only adds silence and output tokens.
    // A plain command or a quick state question goes to FAST_MODEL when one
    // is set (llm/model-router.ts), without reasoning; everything else stays
    // on the main model.
    // A model or thinking level picked in the panel wins over both.
    const fastModel =
      !local && !lean && !request.model && this.config.fastModel && isSimpleRequest({ message, hasImages: Boolean(request.images?.length) })
        ? this.config.fastModel
        : undefined;
    // The model a failed call falls back to: none for the local one.
    const mainModel = local?.model ?? this.config.llmModel;
    let model = local ? local.model : request.model ?? fastModel ?? this.config.llmModel;
    // An explicit reasoning level chosen in the panel wins. Otherwise,
    // threadReasoning is the ceiling and ordinary chat adapts down to avoid
    // paying for deep reasoning on greetings and straightforward questions.
    const threadEffort = scope.isThread
      ? selectThreadReasoning(message, this.config.threadReasoning)
      : undefined;
    // The local server runs with thinking off (ear/tools/llm/install.sh).
    let effort = local ? undefined : request.reasoning
      ?? (fastModel
        ? "none"
        : scope.isThread
          ? threadEffort
          : this.config.reasoningEffort ?? (isVoice ? "none" : undefined));
    if (fastModel) console.log(`[route] fast model ${fastModel} for: ${message.slice(0, 60)}`);
    if (local) {
      // What the local model has to read, part by part (≈ 3.5 characters a
      // token in French): the parts that make a request slow.
      const tok = (text: string | undefined) => Math.round((text?.length ?? 0) / 3.5);
      const historyText = history.map((m) => m.content).join("\n");
      console.log(
        `[route] local model ${local.model} for: ${message.slice(0, 60)}\n` +
          `[prompt] ≈ tokens: instructions+persona=${tok(stableSystemPrompt) - tok(homeLayout) - tok(deviceCheatSheet)} ` +
          `layout=${tok(homeLayout)} devices+scripts=${tok(deviceCheatSheet)} tools=${tok(JSON.stringify(tools))} ` +
          `history=${tok(historyText)} (${history.length} messages) live=${tok(live)} context=${tok(volatileSystemPrompt) - tok(live)}`
      );
    }
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
      !lean && !knownOrder && !request.images?.length && mayBeOrder(message)
        ? askIsOrder(local?.client ?? this.client, local?.model ?? this.config.fastModel ?? this.config.llmModel, message, lastReply, signal).catch((error) => {
            if (!signal?.aborted) console.warn(`[route] order check failed (${error instanceof Error ? error.message : error})`);
            return { order: false, usage: undefined };
          })
        : undefined;
    // The local model never speaks (the online one answers), so nothing of
    // it is held back or retried.
    let holding = !local && (knownOrder || orderCheck !== undefined);
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
      if (local) return;
      if (!firstTextAt && chunk.trim()) firstTextAt = Date.now();
      if (holding) held += chunk;
      else onChunk?.(chunk);
    };
    // What the online model says for the local one.
    const speak = (chunk: string) => {
      if (!firstTextAt && chunk.trim()) firstTextAt = Date.now();
      onChunk?.(chunk);
    };
    const call = async (forceAnswer: boolean, toolChoice?: "required") => {
      turnText = "";
      const once = () =>
        this.streamCompletion(messages, isVoice, sink, forceAnswer, conversationId || effectiveConversationId, cacheKey, {
          tools,
          effort,
          model,
          client: local?.client,
          signal,
          toolChoice,
          isThread: scope.isThread,
          maxSentences: local ? undefined : sentenceCap,
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
        if (local || model === this.config.llmModel || signal?.aborted) throw error;
        console.warn(`[route] ${model} failed (${error instanceof Error ? error.message : error}); using ${this.config.llmModel}`);
        model = this.config.llmModel;
        effort = scope.isThread ? threadEffort : this.config.reasoningEffort ?? (isVoice ? "none" : undefined);
        turnText = "";
        return once();
      }
    };
    let interrupted = false;
    let localDown = false;
    // What the local model did this turn, and the plain sentence for it when known.
    const localDone: DoneCall[] = [];
    let plainSentence: string | undefined;
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
          console.warn(`[route] ${model} answered a command without acting; asking ${mainModel} with a required tool call`);
          const firstModel = model;
          const first = result;
          model = mainModel;
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
        const done: DoneCall[] = [];
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

          const toolResult = local && tc.function.name === SHARE_MEMORY
            ? shareMemory(args.facts, factContents)
            : await handleToolCall(this.ha, tc.function.name, args, toolCtx);
          done.push({ name: tc.function.name, input: args, result: toolResult });
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

        // A plain order on the local model: Home Assistant said what changed.
        // The online model words it as Igor from that alone ("Lumière salon
        // allumée."), with no second pass on the local one; the plain
        // sentence is said if it does not answer in time.
        if (local) {
          localDone.push(...done);
          // The local model reads results again only when a second action
          // depends on them; otherwise (a web search, a state, a contact, an
          // order) they go straight to the online model, which answers.
          if (done.length === result.toolCalls.length && !needsLocalFollowUp(done)) {
            plainSentence = actionSentence(done);
            result = { text: "", finishReason: "stop", toolCalls: [], usage: undefined };
            break;
          }
        }

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
      // The local model only acts and reads. The online model answers the
      // person, from their words, the last exchanges and what was done or
      // read; never from the home's layout, live state, memory or contacts.
      if (local) {
        const draft = result.text.trim();
        console.log(
          `[route] ${localDone.length ? `${localDone.length} local tool call(s)` : "nothing to do locally"}, ` +
            `answered by ${this.config.llmModel}${plainSentence ? `: ${plainSentence}` : ""}`
        );
        const reply = await this.askOnline({
          instructions: ONLINE_REPLY_INSTRUCTIONS,
          content: [
            ...history.slice(-LOCAL_HISTORY).map((m) => ({ role: m.role, content: m.content }) as OpenAI.ChatCompletionMessageParam),
            { role: "system", content: onlineFacts(localDone, plainSentence) },
            { role: "user", content: message },
          ],
          persona: this.onlinePersona(customPrompt),
          isVoice,
          maxSentences: sentenceCap,
          onChunk: speak,
          signal,
          fallback: plainSentence ?? (draft && draft !== "-" ? draft : GENERAL_UNAVAILABLE),
          timeoutMs: plainSentence ? DONE_TIMEOUT_MS : undefined,
          toolCtx,
        });
        turnUsage.add(reply.usage);
        result = { text: reply.text, finishReason: "stop", toolCalls: [], usage: undefined };
      }
      // A thread reply that reached the output cap goes on by itself, as one
      // message: a long table or text must not stop halfway.
      for (let more = 0; scope.isThread && more < THREAD_CONTINUATIONS; more++) {
        if (result.finishReason !== "length" || result.toolCalls.length || !result.text.trim()) break;
        const sofar = result.text;
        console.log(`[llm] thread reply hit the output cap after ${sofar.length} characters; continuing (${more + 1}/${THREAD_CONTINUATIONS})`);
        messages.push({ role: "assistant", content: sofar }, { role: "user", content: CONTINUE_INSTRUCTION });
        const next = await call(true);
        turnUsage.add(next.usage);
        result = { ...next, text: sofar + next.text };
      }
    } catch (error) {
      if (!signal?.aborted && !local) throw error;
      if (!signal?.aborted) {
        // The local model did not answer. Never the cloud model instead: that
        // is the point of having one.
        console.warn(`[llm] local model ${local!.model} did not answer (${error instanceof Error ? error.message : error})`);
        localDown = true;
        result = { text: LOCAL_UNAVAILABLE, finishReason: "stop", toolCalls: [], usage: undefined };
        onChunk?.(LOCAL_UNAVAILABLE);
      } else {
        // Stopped by the user: keep what this turn had written.
        interrupted = true;
        result = { text: turnText, finishReason: null, toolCalls: [], usage: undefined };
        console.log(`[llm] stopped by the user after ${turnText.length} characters`);
      }
    }

    // The always-on microphone sent a sentence that talked about Igor, not to
    // it, and the model said so (NOT_FOR_ME): no answer at all, and nothing
    // of it kept, so the room's conversation does not become Igor's.
    if (result.silent && result.toolCalls.length === 0 && !interrupted) {
      if (effectiveConversationId && userMessageId) {
        await this.conversations.deleteMessagesFrom?.(effectiveConversationId, userId, userMessageId);
      }
      console.log(`[usage] ${promptMode} ${turnUsage.describe()} not addressed, silent model=${model}`);
      return { response: "", toolsUsed, factsLearned: 0, notForMe: true, usage: { model, ...turnUsage.totals() } };
    }

    // Files the tools produced (charts, images) that the answer does not
    // show yet go after it, streamed like the rest, and stored with it.
    // Only in a thread: a spoken answer would read the link out loud.
    const extraMedia = scope.isThread && !interrupted ? missingAttachments(result.text, toolCtx.attachments) : "";
    if (extraMedia) onChunk?.(extraMedia);
    const responseText = interrupted
      ? `${result.text.trimEnd()}${result.text.trim() ? "\n\n" : ""}*[Réponse interrompue]*`
      : result.text + extraMedia;

    console.log(`[usage] ${promptMode} ${turnUsage.describe()} tools=${toolsUsed.length} model=${local ? `${local.model} (acts) + ${this.config.llmModel} (answers)` : model}`);
    console.log(
      `[timing] ${promptMode} ${Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(" ")} ` +
        `model_start=${modelStartedAt - startedAt}ms first_text=${firstTextAt ? `${firstTextAt - startedAt}ms` : "none"} ` +
        `total=${Date.now() - startedAt}ms${lean ? " lean" : ""}`
    );

    // 6. Store assistant response
    if (effectiveConversationId && responseText) {
      const stored = this.conversations.storeMessage(effectiveConversationId, userId, "assistant", responseText);
      if (toolCtx.actions?.length) void this.conversations.setMessageActions?.(stored, toolCtx.actions);
    }

    // 7. Extract and store facts (fire-and-forget). Memories a forget_memory
    // call touched this turn are filtered out of the extraction so they can't
    // be re-learned from the "forget that X" transcript.
    if (!interrupted && !localDown && scope.facts) {
      extractAndStoreFacts(
        this.memory,
        local?.extractor ?? this.extractor,
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

  /** The small model that tells a sentence said to Igor from one about it. */
  private addresseeModel(): string {
    return this.config.extractionModel ?? this.config.fastModel ?? this.config.llmModel;
  }

  private async askAddressee(
    message: string,
    signal: AbortSignal,
    local?: { client: OpenAI; model: string }
  ): Promise<{ text: string; usage?: TokenUsage }> {
    const response = await (local?.client ?? this.client).chat.completions.create(
      {
        model: local?.model ?? this.addresseeModel(),
        temperature: 0,
        max_tokens: 16,
        // JSON mode (Mistral, llama.cpp): the reply can only be the verdict.
        ...(local || this.isMistral() ? { response_format: { type: "json_object" as const } } : {}),
        messages: [
          { role: "system", content: ADDRESSEE_INSTRUCTIONS },
          { role: "user", content: addresseeQuestion(message) },
        ],
      },
      { signal }
    );
    return { text: response.choices[0]?.message?.content ?? "", usage: readUsage(response.usage) };
  }

  /**
   * The main (online) model's spoken reply for the local model, from Igor's
   * persona and the messages given (the person's words, the last exchanges,
   * what was done or read), never the home's layout, live state, memory or
   * contact list. Streamed as the reply. Never throws but on a stop: past
   * `timeoutMs`, or on a failure before any word, `fallback` is said instead.
   */
  private async askOnline(opts: {
    instructions: string;
    /** One message from the person, or the exchanges ending with it. */
    content: string | OpenAI.ChatCompletionMessageParam[];
    persona: string | undefined;
    isVoice: boolean;
    maxSentences: number | undefined;
    onChunk: StreamCallback | undefined;
    signal: AbortSignal | undefined;
    fallback: string;
    timeoutMs?: number;
    /** For the web search the online model may run. */
    toolCtx?: ToolContext;
  }): Promise<{ text: string; usage?: TokenUsage }> {
    const { isVoice, signal, fallback } = opts;
    const model = this.config.llmModel;
    // Without today's date it took "cette année" for the year it was trained
    // in, and searched the web for the wrong one.
    const now = `Date et heure actuelles : ${formatDateTimeWithOffset().display}.`;
    const system = [opts.persona?.trim(), opts.instructions, now].filter(Boolean).join("\n\n");
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true });
    let timer = opts.timeoutMs ? setTimeout(stop, opts.timeoutMs) : undefined;
    let text = "";
    const say = (chunk: string) => {
      text += chunk;
      opts.onChunk?.(chunk);
    };
    const usage = new UsageTally();
    // It searches the web itself when its own knowledge is not enough (news,
    // anything recent): only the query leaves, as with any web search.
    const webTools = process.env.MISTRAL_API_KEY
      ? openAIToolsFor("voice").filter((t) => t.type === "function" && t.function.name === "web_search")
      : [];
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      ...(typeof opts.content === "string" ? [{ role: "user" as const, content: opts.content }] : opts.content),
    ];
    const ask = (noTools: boolean) =>
      this.streamCompletion(messages, isVoice, say, noTools, undefined, undefined, {
        // Kept on the follow-up call too (the history holds the search call);
        // noTools forbids a second search.
        tools: webTools,
        effort: "none",
        model,
        signal: controller.signal,
        maxSentences: opts.maxSentences,
      });
    try {
      let result = await ask(false);
      usage.add(result.usage);
      if (result.toolCalls.length && !text.trim()) {
        // A search takes its time: the plain sentence no longer replaces it.
        if (timer) clearTimeout(timer);
        timer = undefined;
        messages.push({ role: "assistant", content: result.text || null, tool_calls: result.toolCalls });
        for (const tc of result.toolCalls) {
          const found = tc.function.name === "web_search" && opts.toolCtx
            ? await handleToolCall(this.ha, "web_search", parseArgs(tc), opts.toolCtx)
            : { error: "Only web_search is available here." };
          console.log(`[route] ${model} searched the web: ${String(parseArgs(tc).query ?? "").slice(0, 80)}`);
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(found) });
        }
        result = await ask(true);
        usage.add(result.usage);
      }
      if (text.trim()) return { text, usage: usage.totals() };
      throw new Error("empty reply");
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[route] ${model} did not answer for the local model (${error instanceof Error ? error.message : error})`);
      if (text) return { text };
      opts.onChunk?.(fallback);
      return { text: fallback };
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }

  /**
   * The persona the online model gets for the local model's replies: the
   * owner's common one (custom_prompt) and a line of spoken style, not the
   * voice part, whose rules are for acting, which the local model does.
   */
  private onlinePersona(requestPersona: string | undefined): string | undefined {
    const common = this.config.customPrompt?.trim() || requestPersona?.trim();
    return common ? `${common}\n\n${ONLINE_SPOKEN_STYLE}` : ONLINE_SPOKEN_STYLE;
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
      /** Another endpoint than the configured one (the local model). */
      client?: OpenAI;
      signal?: AbortSignal;
      isThread?: boolean;
      /** Spoken replies: the most whole sentences read out (llm/lean.ts). */
      maxSentences?: number;
      onThinking?: () => void;
      /** "required": the model must call a tool on this call. */
      toolChoice?: "required";
    } = {}
  ): Promise<{
    text: string;
    finishReason: string | null;
    toolCalls: FunctionToolCall[];
    usage?: TokenUsage;
    /** The model answered NOT_FOR_ME: the sentence was not said to it. */
    silent?: boolean;
  }> {
    const effort = "effort" in opts ? opts.effort : this.config.reasoningEffort ?? (isVoice ? "none" : undefined);
    const model = opts.model ?? this.config.llmModel;
    // The local model writes tool calls, not answers: a small cap keeps a
    // model that starts talking from costing seconds.
    const cap = opts.client ? LOCAL_OUTPUT_CAP : this.maxOutputTokens(isVoice, Boolean(opts.isThread));
    const tools = opts.tools ?? openAIToolsFor(isVoice ? "voice" : "text");
    const startedAt = Date.now();
    const client = opts.client ?? this.client;
    const mistral = /api\.mistral\.ai/i.test(client.baseURL);
    const stream = await withTokenCap(model, cap, (capParam) =>
      withReasoningEffort(
        model,
        // Chosen by chat(): high in a thread by default, none for voice, the
        // configured REASONING_EFFORT otherwise. A model that refuses the
        // parameter stops getting it.
        effort,
        (reasoning) =>
          withPromptCacheKey(model, cacheKey, (cache) =>
          client.chat.completions.create({
            model: model,
            ...(opts.client ? LOCAL_SAMPLING : {}),
            ...capParam,
            ...reasoning,
            ...cache,
            messages,
            ...(tools.length ? { tools } : {}),
            // Keep the tool list in the request (history already references it) but
            // stop the model from issuing more calls.
            ...(disableTools ? { tool_choice: "none" as const } : opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
            stream: true,
            // Ask for the token breakdown. Without this a streamed call reports no
            // usage at all, which is why a cap being spent entirely on reasoning
            // looked identical to a prompt being too large.
            ...(!mistral ? { stream_options: { include_usage: true } } : {}),
            // OpenRouter only: a stable session id pins the follow-up turns of one
            // conversation to the provider endpoint that already holds the warm
            // prompt cache, instead of re-balancing every turn. Other endpoints
            // reject unknown fields, so it is not sent to them.
            ...(!opts.client && this.isOpenRouter() && sessionId ? { session_id: sessionId } : {}),
          } as OpenAI.ChatCompletionCreateParamsStreaming, opts.signal ? { signal: opts.signal } : undefined), client.baseURL),
        client.baseURL
      )
    );

    let text = "";
    let finishReason: string | null = null;
    // Guard every reply. Spoken mode additionally strips emoji and separators;
    // written mode preserves both while still stopping repeated sentences.
    const spoken = new SpokenGuard(isVoice, !leanMode(), opts.maxSentences);
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

    try {
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
      const chunkText = spoken.push(raw);
      if (chunkText) {
        text += chunkText;
        if (onChunk) {
          onChunk(chunkText);
        }
      }
      if (spoken.stopped) {
        // Stop consuming the provider stream as soon as repetition is detected.
        if (spoken.silent) console.log(`[llm] ${model}: not said to Igor, no answer`);
        else if (spoken.reason === "length") console.log(`[llm] ${model}: spoken reply ended after ${opts.maxSentences} sentences`);
        else console.warn(`[llm] ${model} response cut after repeated text (mode=${isVoice ? "voice" : "text"}, reason=${spoken.reason})`);
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
    } catch (error) {
      // If the user presses Stop mid-sentence, the guard's buffer has not been
      // emitted yet. Flush that partial text so the existing interrupted-reply
      // path can preserve it; on a normal stream we still wait for sentence ends.
      if (opts.signal?.aborted) {
        const partial = spoken.flush();
        if (partial) {
          text += partial;
          onChunk?.(partial);
        }
      }
      throw error;
    }

    const rest = spoken.flush();
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

    return { text, finishReason, toolCalls, usage, ...(spoken.silent ? { silent: true } : {}) };
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
