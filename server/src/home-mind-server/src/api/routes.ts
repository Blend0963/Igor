import { Router, Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import type { IChatEngine } from "../llm/interface.js";
import type { IMemoryStore } from "../memory/interface.js";
import type { IConversationStore } from "../memory/types.js";
import type { ISttService } from "../stt/stt-service.js";
import type { ITtsService } from "../tts/tts-service.js";
import { createEmptyBucketCheck, mergeMemoryInto } from "../memory/shared-memory.js";
import {
  DEFAULT_MESSAGE_CAP,
  isThreadId,
  THREAD_MESSAGE_CAP,
  threadFactBucket,
} from "../memory/memory-scope.js";
import { mistralKey, ocrPricePer1000Pages, withDocuments } from "../llm/mistral-platform.js";
import { getMediaStore } from "../llm/media-store.js";
import type { TitleGenerator } from "../llm/thread-title.js";
import { RunningTurns, type RunningTurnHandle } from "./running-turns.js";
import type { WorkspaceStore } from "../memory/workspace-store.js";
import { PROJECT_LIMITS } from "../memory/workspace-store.js";
import type { Scheduler } from "../jobs/scheduler.js";
import { describeSchedule } from "../jobs/scheduler.js";
import type { RequestUsage } from "../llm/interface.js";
import { createFile } from "../files/create.js";
import type { DiagnosticResult } from "./diagnostics.js";
import type { ModelChoices } from "../llm/model-list.js";

/**
 * Limits for the one multipart endpoint this server has (`POST /api/stt`).
 *
 * `fieldArrayIndexLimit` is the fix for GHSA-535w-7cp7-47q4, and it is not
 * optional: multer defaults it to Infinity and only enforces it when the key is
 * actually present, so being on 2.3.0 without it changes nothing. This server
 * was already on 2.3.0 and therefore raised no Dependabot alert at all, while
 * being exactly as exposed as one still on 2.2.0.
 *
 * A field name like `items[4294967294]` otherwise makes append-field allocate a
 * maximum-length sparse array, and a second field on the same base then walks
 * its whole length — one request, and the process stops answering anything.
 *
 * Zero, because this endpoint takes `audio` and `language` and nothing else.
 * No field name we send contains a bracket, so any index at all is an attack
 * rather than a caller we would break.
 */
export const UPLOAD_LIMITS = {
  fileSize: 25 * 1024 * 1024,
  fieldArrayIndexLimit: 0,
} as const;

const upload = multer({ storage: multer.memoryStorage(), limits: { ...UPLOAD_LIMITS } });

// Request validation schemas
/**
 * Ceilings on what one chat request may carry. Generous for any real caller
 * (Assist, the panel, the AI Task entity), but they stop a single request from
 * filling the conversation database or the provider bill: everything here is
 * stored, embedded or sent to the model.
 */
export const CHAT_LIMITS = {
  message: 100_000,
  id: 200,
  customPrompt: 20_000,
  images: 10,
  documents: 5,
  /** Characters of one base64 file (~10 MB of file). */
  documentChars: 14_000_000,
} as const;

/** Any file as a base64 data URL (browsers send an empty type for unknown ones). */
const FILE_PATTERN = /^data:[^,;]*(;[^,;]*)*;base64,[A-Za-z0-9+/=]+$/;

/**
 * What an image may be: a base64 data URL in one of the formats every
 * vision provider takes (Anthropic only knows these four media types), or an
 * https link the provider fetches itself.
 */
const IMAGE_PATTERN = /^(data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+|https:\/\/\S+)$/;

export const ChatRequestSchema = z.object({
  message: z.string().min(1, "Message is required").max(CHAT_LIMITS.message),
  // JSON callers send an explicit null for "no value" at least as often as
  // they omit the key — HA's conversation.process without a conversation_id
  // arrives as `"conversationId": null` (#63). `.optional()`/`.default()`
  // only cover ABSENT, so both fields accept null and normalize it here.
  userId: z
    .string()
    .max(CHAT_LIMITS.id)
    .nullish()
    .transform((v) => v ?? "default"),
  conversationId: z
    .string()
    .max(CHAT_LIMITS.id)
    .nullish()
    .transform((v) => v ?? undefined),
  isVoice: z.boolean().default(false),
  customPrompt: z.string().max(CHAT_LIMITS.customPrompt).optional(),
  // The caller's UI language (e.g. "sl", "en-US") — in the add-on this is the
  // Assist pipeline's language. A tie-breaker hint only: the language of the
  // user's actual words always wins.
  language: z.string().max(35).optional(),
  // Optional images for vision-capable models. Each is a data URL
  // ("data:image/jpeg;base64,…") or a plain https URL. Forwarded to the model
  // as image content; ignored by text-only models.
  images: z.array(z.string().regex(IMAGE_PATTERN, "Expected a JPEG/PNG/WebP/GIF data URL or an https URL")).max(CHAT_LIMITS.images).optional(),
  // Files (data URLs): Word, Excel, PowerPoint, text, ZIP… read on the add-on,
  // PDFs through Mistral OCR; their text is added to the message.
  documents: z
    .array(
      z.object({
        name: z.string().max(200).default("document"),
        data: z.string().max(CHAT_LIMITS.documentChars).regex(FILE_PATTERN, "Expected a base64 data URL"),
      })
    )
    .max(CHAT_LIMITS.documents)
    .optional(),
  // A scanned PDF needs Mistral OCR, billed per page: "ask" (default) stops
  // and returns the price for the user to accept; "yes" / "no" is the answer.
  ocr: z.enum(["ask", "yes", "no"]).default("ask"),
  // The panel's pickers (threads only): a model id and a thinking level.
  model: z.string().max(100).regex(/^[A-Za-z0-9._:/@-]+$/, "Invalid model id").optional(),
  reasoning: z.enum(["none", "low", "medium", "high"]).optional(),
});

type ParsedChatRequest = z.infer<typeof ChatRequestSchema>;

/** What the user is asked before scanned PDFs go to OCR. */
export interface OcrConfirmation {
  files: { name: string; pages: number; cost: number }[];
  pages: number;
  /** Estimated total, in USD, at `pricePer1000Pages`. */
  cost: number;
  pricePer1000Pages: number;
}

/**
 * The request as the engine takes it: attached files read and appended to
 * the message. When a scanned PDF needs OCR and the user has not answered
 * yet (`ocr: "ask"`), nothing is sent to the model: `confirm` carries the
 * pages and the estimated price to put to them.
 */
export async function withAttachedDocuments(
  data: ParsedChatRequest
): Promise<{ request: Omit<ParsedChatRequest, "documents" | "ocr">; confirm?: OcrConfirmation }> {
  const { documents, ocr, ...rest } = data;
  // The pickers belong to the panel's threads; Assist keeps the add-on settings.
  if (!isThreadId(rest.conversationId)) {
    delete rest.model;
    delete rest.reasoning;
  }
  if (!documents?.length) return { request: rest };
  const read = await withDocuments(rest.message, documents, mistralKey(), ocr);
  if (read.ocrRequests.length) {
    const price = ocrPricePer1000Pages();
    // An unreadable PDF reports 0 pages; count it as one for the estimate.
    const files = read.ocrRequests.map((f) => ({ ...f, cost: (Math.max(1, f.pages) * price) / 1000 }));
    const pages = files.reduce((n, f) => n + Math.max(1, f.pages), 0);
    return { request: rest, confirm: { files, pages, cost: (pages * price) / 1000, pricePer1000Pages: price } };
  }
  return { request: { ...rest, message: read.message } };
}

/** PATCH a conversation: rename it, mark it as a favourite, or both. */
export const RenameSchema = z
  .object({
    title: z
      .string()
      .transform((t) => t.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1, "Title is required").max(120))
      .optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.pinned !== undefined, "Nothing to change: send a title or pinned");

const AddFactSchema = z.object({
  content: z.string().min(1, "Fact content is required"),
  category: z.enum([
    "baseline",
    "preference",
    "identity",
    "device",
    "pattern",
    "correction",
  ]),
});

/**
 * Remembers the last persona we announced, so a per-request log line doesn't
 * repeat on every message — it appears once, and again whenever it changes.
 */
let lastPersonaSignature = "";

/**
 * Say out loud which persona a request will actually run with, and where it
 * came from.
 *
 * A `customPrompt` sent with the request overrides the add-on's own Custom
 * Prompt option (CUSTOM_PROMPT). Since 2.4.23 the integration's conversation
 * agent no longer sends one — its duplicate persona field was removed after
 * two fields with one invisible winner cost a reporter and me several days
 * on nives#54 — so for ordinary chat the add-on option is simply the one in
 * effect. Per-request prompts still arrive from the AI Task entity (its
 * fixed task-mode prompt) and from API clients, which is why this logging
 * stays: the override path exists, it just has no user-facing duplicate.
 *
 * Exported for testing.
 */
export function describePersonaSource(
  requestPrompt?: string,
  serverDefault?: string
): string {
  const fromRequest = Boolean(requestPrompt?.trim());
  const fromServer = Boolean(serverDefault?.trim());
  const text = (fromRequest ? requestPrompt : fromServer ? serverDefault : "") ?? "";
  const flat = text.replace(/\s+/g, " ").trim();
  const preview = flat ? `: "${flat.slice(0, 60)}${flat.length > 60 ? "…" : ""}"` : "";

  if (fromRequest && fromServer) {
    return `custom prompt sent with the request${preview} — NOTE: the add-on's Custom Prompt option is also set and is overridden for this request`;
  }
  if (fromRequest) return `custom prompt sent with the request${preview}`;
  if (fromServer) return `custom prompt from the add-on configuration${preview}`;
  return "built-in default identity (no custom prompt set anywhere)";
}

/** What the add-on configures about personas and Assist's style. */
export interface PersonaOptions {
  voice?: string;
  thread?: string;
  assistMode?: "auto" | "voice" | "text";
}

/** The common persona, then the one for this kind of conversation. */
export function composePersona(common?: string, specific?: string): string | undefined {
  const parts = [common, specific].map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return parts.length ? parts.join("\n\n") : undefined;
}

/**
 * The style a chat request runs with, and the persona for it. A chat-panel
 * thread is always "thread"; an Assist request is spoken or typed per
 * `assistMode`, where "auto" keeps what the integration said. A prompt sent
 * with the request (AI Task, API clients) still replaces the configured ones.
 */
export function resolveChatStyle(
  request: { isVoice: boolean; conversationId?: string; customPrompt?: string },
  commonPrompt?: string,
  personas: PersonaOptions = {}
): { isVoice: boolean; mode: "voice" | "text" | "thread"; customPrompt?: string } {
  const isThread = isThreadId(request.conversationId);
  const assistMode = personas.assistMode ?? "auto";
  const isVoice = isThread
    ? false
    : assistMode === "auto"
      ? request.isVoice
      : assistMode === "voice";
  const mode = isThread ? "thread" : isVoice ? "voice" : "text";
  const specific = mode === "voice" ? personas.voice : mode === "thread" ? personas.thread : undefined;
  return {
    isVoice,
    mode,
    customPrompt: request.customPrompt ?? composePersona(commonPrompt, specific),
  };
}

function logPersonaSource(mode: string, requestPrompt?: string, serverDefault?: string): void {
  const signature = `(${mode}) ${describePersonaSource(requestPrompt, serverDefault)}`;
  if (signature === lastPersonaSignature) return;
  lastPersonaSignature = signature;
  console.log(`[persona] ${signature}`);
}

/**
 * The capabilities half of /api/health.
 *
 * The HA integration reads these to decide whether to register speech-to-text
 * and text-to-speech entities at all — an entity that would answer every
 * request with a 501 is worse than no entity, because it still appears as a
 * choice in the Assist pipeline.
 *
 * A voice speaks one language. Naming it lets the integration advertise
 * exactly that language, instead of offering itself for pipelines whose words
 * the configured voice would read with the wrong phonetics. The language is
 * reported only alongside a voice that can speak it: a language with no voice
 * behind it would have the integration advertise a capability that answers 501.
 */
export function healthCapabilities(
  stt?: unknown,
  tts?: unknown,
  ttsLanguage?: string
): { stt: boolean; tts: boolean; ttsLanguage: string | null; documents: boolean; ocr: boolean } {
  const canSpeak = Boolean(tts);
  return {
    // Files can be attached (read on the add-on); scanned PDFs need Mistral OCR.
    documents: true,
    ocr: Boolean(mistralKey()),
    stt: Boolean(stt),
    tts: canSpeak,
    ttsLanguage: canSpeak ? ttsLanguage?.trim() || null : null,
  };
}

export function createRouter(
  llm: IChatEngine,
  memory: IMemoryStore,
  memoryBackend: "sqlite" | "shodh" = "sqlite",
  version: string = "0.0.0",
  defaultCustomPrompt?: string,
  conversations?: IConversationStore,
  stt?: ISttService,
  tts?: ITtsService,
  ttsLanguage?: string,
  mergeMarkerPath?: string,
  personas: PersonaOptions = {},
  extras: {
    generateTitle?: TitleGenerator;
    running?: RunningTurns;
    workspace?: WorkspaceStore;
    scheduler?: Scheduler;
    diagnostics?: (paid: boolean) => Promise<DiagnosticResult[]>;
    models?: () => Promise<ModelChoices>;
  } = {}
): Router {
  const router = Router();
  const running = extras.running ?? new RunningTurns();
  const workspace = extras.workspace;

  /**
   * The persona of a request, with the instructions of the thread's project
   * (when it is in one) after it.
   */
  function withProject(customPrompt: string | undefined, userId: string, conversationId?: string): string | undefined {
    if (!workspace || !isThreadId(conversationId)) return customPrompt;
    const project = workspace.projectOf(userId, conversationId);
    if (!project?.instructions.trim()) return customPrompt;
    return composePersona(customPrompt, `## Project "${project.name}"\n${project.instructions.trim()}`);
  }

  /** The cost counter: one row per request that reached a model. */
  function recordUsage(userId: string, conversationId: string | undefined, usage: RequestUsage | undefined): void {
    if (!workspace || !usage) return;
    try {
      workspace.recordUsage(userId, isThreadId(conversationId) ? conversationId : "assist", usage);
    } catch (error) {
      console.warn("[usage] not recorded:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * The title of a thread's first exchange, written by a small model call
   * that runs alongside the reply. Only for a thread with no message yet:
   * a later message, or one the person renamed, keeps its title.
   */
  async function titleForNewThread(
    request: { conversationId?: string; userId: string; message: string }
  ): Promise<(() => Promise<string | undefined>) | undefined> {
    if (!extras.generateTitle || !conversations?.setConversationTitle || !isThreadId(request.conversationId)) return undefined;
    const history = await conversations.getConversationHistory(request.conversationId, 1);
    if (history.length) return undefined;
    const conversationId = request.conversationId;
    const pending = extras.generateTitle(request.message);
    return async () => {
      const title = await pending;
      if (!title) return undefined;
      await conversations.setConversationTitle!(conversationId, request.userId, title);
      return title;
    };
  }

  /** Follows a thread's reply for a panel that comes back mid-answer. */
  function track(request: { conversationId?: string; userId: string }): RunningTurnHandle | undefined {
    return isThreadId(request.conversationId) ? running.start(request.userId, request.conversationId) : undefined;
  }
  const checkEmptyBucket = conversations
    ? createEmptyBucketCheck(memory, conversations)
    : undefined;

  /**
   * POST /api/chat
   * Main chat endpoint - send a message, get an AI response.
   * Uses streaming internally for faster processing, returns complete response.
   */
  router.post("/chat", async (req: Request, res: Response) => {
    try {
      const parsed = ChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parsed.error.issues,
        });
      }

      const style = resolveChatStyle(parsed.data, defaultCustomPrompt, personas);
      logPersonaSource(
        style.mode,
        parsed.data.customPrompt,
        parsed.data.customPrompt ? defaultCustomPrompt : style.customPrompt
      );
      // A thread starts with an empty memory on purpose.
      if (!isThreadId(parsed.data.conversationId)) void checkEmptyBucket?.(parsed.data.userId);

      const { request, confirm } = await withAttachedDocuments(parsed.data);
      if (confirm) {
        // Nothing is read or stored until the caller resends with ocr: yes/no.
        return res.status(409).json({ error: "ocr_confirmation_required", ocr: confirm });
      }
      const saveTitle = await titleForNewThread(request);
      const live = track(request);
      try {
        // Use streaming internally (no callback = just faster processing)
        const response = await llm.chat(
          {
            ...request,
            isVoice: style.isVoice,
            customPrompt: withProject(style.customPrompt, request.userId, request.conversationId),
            ...(live ? { signal: live.signal } : {}),
          },
          live ? { onChunk: live.chunk, onTurn: live.newTurn, onStatus: live.status } : undefined
        );
        recordUsage(request.userId, request.conversationId, response.usage);
        const title = await saveTitle?.().catch(() => undefined);
        res.json(title ? { ...response, title } : response);
      } finally {
        live?.finish();
      }
    } catch (error) {
      console.error("Chat error:", error);
      if ((error as any)?.status === 402) {
        return res.status(402).json({ error: "usage_limit_reached" });
      }
      if ((error as any)?.status === 400) {
        return res.status(400).json({ error: (error as Error).message });
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/chat/stream
   * Streaming chat endpoint using Server-Sent Events (SSE).
   * Sends text chunks as they arrive, then final response.
   */
  router.post("/chat/stream", async (req: Request, res: Response) => {
    try {
      const parsed = ChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parsed.error.issues,
        });
      }

      const style = resolveChatStyle(parsed.data, defaultCustomPrompt, personas);
      logPersonaSource(
        style.mode,
        parsed.data.customPrompt,
        parsed.data.customPrompt ? defaultCustomPrompt : style.customPrompt
      );
      // A thread starts with an empty memory on purpose.
      if (!isThreadId(parsed.data.conversationId)) void checkEmptyBucket?.(parsed.data.userId);

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      // Stream to the client as the reply is produced. Three event kinds:
      //   turn   — a new assistant message begins (one per model turn)
      //   chunk  — text of the current message
      //   status — the server's heads-up before a long batch of tool calls;
      //            shown to the person waiting, never part of the reply
      //   ocr_confirm — a scanned PDF needs paid OCR: the price to accept,
      //            sent instead of a reply (the request is resent with ocr)
      // followed by `done` with the complete response as /api/chat returns it.
      const send = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (parsed.data.documents?.length) send("status", { text: "Lecture des fichiers…" });
      const { request, confirm } = await withAttachedDocuments(parsed.data);
      if (confirm) {
        // The panel asks the user and resends with ocr: "yes" or "no";
        // nothing was sent to the model or stored.
        send("ocr_confirm", confirm);
        res.end();
        return;
      }
      // The title is written while the reply streams, and sent as soon as
      // it exists; a panel that left early finds it in the thread list.
      const saveTitle = await titleForNewThread(request);
      const titled = saveTitle?.()
        .then((title) => { if (title) send("title", { title }); })
        .catch((err) => console.warn("[title] not saved:", err instanceof Error ? err.message : err));
      const live = track(request);
      let response;
      try {
        response = await llm.chat(
          {
            ...request,
            isVoice: style.isVoice,
            customPrompt: withProject(style.customPrompt, request.userId, request.conversationId),
            ...(live ? { signal: live.signal } : {}),
          },
          {
            onTurn: () => { live?.newTurn(); send("turn", {}); },
            onChunk: (chunk: string) => { live?.chunk(chunk); send("chunk", { text: chunk }); },
            onStatus: (text: string) => { live?.status(text); send("status", { text }); },
          }
        );
      } finally {
        live?.finish();
      }
      recordUsage(request.userId, request.conversationId, response.usage);
      await titled;

      // Send final complete response
      res.write(`event: done\ndata: ${JSON.stringify(response)}\n\n`);
      res.end();
    } catch (error) {
      console.error("Chat stream error:", error);
      if ((error as any)?.status === 402) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: "usage_limit_reached" })}\n\n`);
        res.end();
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  });

  /**
   * GET /api/memory/:userId
   * Get all facts stored for a user
   */
  router.get("/memory/:userId", async (req: Request, res: Response) => {
    try {
      const userId = req.params.userId as string;
      const facts = await memory.getFacts(userId);
      res.json({
        userId,
        factCount: facts.length,
        facts,
      });
    } catch (error) {
      console.error("Memory fetch error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/memory/:userId/facts
   * Manually add a fact for a user
   */
  router.post("/memory/:userId/facts", async (req: Request, res: Response) => {
    try {
      const userId = req.params.userId as string;
      const parsed = AddFactSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parsed.error.issues,
        });
      }

      const { content, category } = parsed.data;
      const id = await memory.addFactIfNew(userId, content, category);

      if (id) {
        res.status(201).json({ id, message: "Fact added" });
      } else {
        res.status(200).json({ message: "Fact already exists" });
      }
    } catch (error) {
      console.error("Add fact error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/memory/:userId/merge
   * One-time copy of every other known user's facts into this user's memory,
   * skipping duplicates and leaving the sources untouched (nives#65). The
   * integration calls it on setup when shared memory is on.
   */
  router.post("/memory/:userId/merge", async (req: Request, res: Response) => {
    if (!conversations) {
      return res.status(501).json({ error: "Conversation store not available" });
    }

    try {
      const userId = req.params.userId as string;
      res.json(await mergeMemoryInto(userId, memory, conversations, mergeMarkerPath));
    } catch (error) {
      console.error("Memory merge error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * DELETE /api/memory/:userId
   * Clear all facts for a user
   */
  router.delete("/memory/:userId", async (req: Request, res: Response) => {
    try {
      const userId = req.params.userId as string;
      const deleted = await memory.clearUserFacts(userId);
      res.json({
        message: `Cleared ${deleted} facts for user ${userId}`,
        deleted,
      });
    } catch (error) {
      console.error("Clear memory error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * DELETE /api/memory/:userId/facts/:factId
   * Delete a specific fact
   */
  router.delete(
    "/memory/:userId/facts/:factId",
    async (req: Request, res: Response) => {
      try {
        const userId = req.params.userId as string;
        const factId = req.params.factId as string;
        const deleted = await memory.deleteFact(userId, factId);

        if (deleted) {
          res.json({ message: "Fact deleted" });
        } else {
          res.status(404).json({ error: "Fact not found" });
        }
      } catch (error) {
        console.error("Delete fact error:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        res.status(500).json({ error: message });
      }
    }
  );

  /**
   * GET /api/admin/conversations
   * Admin endpoint: lists all known users and their conversation summaries.
   */
  router.get("/admin/conversations", async (_req: Request, res: Response) => {
    if (!conversations) {
      return res.status(501).json({ error: "Conversation store not available" });
    }

    try {
      const users = conversations.getKnownUsers();
      const result = await Promise.all(
        users.map(async (userId) => ({
          userId,
          conversations: await conversations!.listConversations(userId),
        }))
      );
      res.json(result);
    } catch (error) {
      console.error("Admin conversations error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/conversations/:userId
   * List all conversations for a user
   */
  router.get("/conversations/:userId", async (req: Request, res: Response) => {
    if (!conversations) {
      return res.status(501).json({ error: "Conversation store not available" });
    }

    try {
      const userId = req.params.userId as string;
      const list = await conversations.listConversations(userId);
      const projects = workspace?.conversationProjects(userId);
      res.json(projects ? list.map((c) => ({ ...c, projectId: projects.get(c.conversationId) ?? null })) : list);
    } catch (error) {
      console.error("List conversations error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/conversations/:userId/:conversationId
   * Get full conversation history
   */
  router.get("/conversations/:userId/:conversationId", async (req: Request, res: Response) => {
    if (!conversations) {
      return res.status(501).json({ error: "Conversation store not available" });
    }

    try {
      const userId = req.params.userId as string;
      const conversationId = req.params.conversationId as string;
      // The path names the user; a conversation id alone must not open
      // somebody else's thread.
      const limit = isThreadId(conversationId) ? THREAD_MESSAGE_CAP : DEFAULT_MESSAGE_CAP;
      const messages = (await conversations.getConversationHistory(conversationId, limit)).filter(
        (m) => m.userId === userId
      );
      res.json({ conversationId, messages });
    } catch (error) {
      console.error("Get conversation error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * PATCH /api/conversations/:userId/:conversationId
   * Rename a conversation (the panel's thread names). Body: { title }.
   * Only a conversation this user has messages in can be named.
   */
  router.patch("/conversations/:userId/:conversationId", async (req: Request, res: Response) => {
    if (!conversations?.setConversationTitle || !conversations.setConversationPinned) {
      return res.status(501).json({ error: "Conversation store not available" });
    }
    const parsed = RenameSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }

    try {
      const userId = req.params.userId as string;
      const conversationId = req.params.conversationId as string;
      const owned = (await conversations.getConversationHistory(conversationId, 1)).some(
        (m) => m.userId === userId
      );
      if (!owned) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const { title, pinned } = parsed.data;
      if (title !== undefined) await conversations.setConversationTitle(conversationId, userId, title);
      if (pinned !== undefined) await conversations.setConversationPinned(conversationId, userId, pinned);
      res.json({ conversationId, ...(title !== undefined ? { title } : {}), ...(pinned !== undefined ? { pinned } : {}) });
    } catch (error) {
      console.error("Rename conversation error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * DELETE /api/conversations/:userId/:conversationId
   * Delete a conversation
   */
  router.delete("/conversations/:userId/:conversationId", async (req: Request, res: Response) => {
    if (!conversations) {
      return res.status(501).json({ error: "Conversation store not available" });
    }

    try {
      const userId = req.params.userId as string;
      const conversationId = req.params.conversationId as string;
      const deleted = await conversations.deleteConversation(conversationId, userId);
      workspace?.forgetConversation(userId, conversationId);
      // A thread's long-term memory lives and dies with the thread.
      const forgotten = isThreadId(conversationId)
        ? await memory.clearUserFacts(threadFactBucket(userId, conversationId))
        : 0;

      if (deleted > 0 || forgotten > 0) {
        res.json({ message: `Deleted ${deleted} messages`, deleted });
      } else {
        res.status(404).json({ error: "Conversation not found" });
      }
    } catch (error) {
      console.error("Delete conversation error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/stt
   * Transcribe audio to text using Whisper (HomeMind App only).
   * Accepts multipart/form-data with an "audio" field.
   * Returns 501 when STT_PROVIDER is not configured.
   */
  router.post("/stt", upload.single("audio"), async (req: Request, res: Response) => {
    if (!stt) {
      return res.status(501).json({ error: "STT is not enabled on this server" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided (field name: audio)" });
    }

    try {
      const { buffer, mimetype, originalname } = req.file;
      const language = typeof req.body.language === "string" && req.body.language ? req.body.language : undefined;
      const text = await stt.transcribe(buffer, mimetype, originalname || "audio.webm", language);
      res.json({ text });
    } catch (error) {
      // The service has already logged the attempts and the provider's answer;
      // dumping the error object here only repeated it with every header.
      const message = error instanceof Error ? error.message : "Transcription failed";
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/tts
   * Synthesize text to speech (HomeMind App only).
   * Accepts JSON { text, language? } and returns audio/mpeg.
   * Returns 501 when TTS_PROVIDER is not configured.
   */
  router.post("/tts", async (req: Request, res: Response) => {
    if (!tts) {
      return res.status(501).json({ error: "TTS is not enabled on this server" });
    }

    const { text, language } = req.body;
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    try {
      const audio = await tts.synthesize(text, language);
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(audio);
    } catch (error) {
      console.error("TTS error:", error);
      const message = error instanceof Error ? error.message : "Synthesis failed";
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/running/:userId
   * This user's threads with a reply still being written.
   */
  router.get("/running/:userId", (req: Request, res: Response) => {
    res.json(running.list(String(req.params.userId)).map(({ conversationId, startedAt, status }) => ({ conversationId, startedAt, status })));
  });

  /**
   * GET /api/running/:userId/:conversationId
   * One thread's reply so far, or { running: false } once it is stored.
   */
  router.get("/running/:userId/:conversationId", (req: Request, res: Response) => {
    const turn = running.get(String(req.params.userId), String(req.params.conversationId));
    res.json(turn ? { running: true, ...turn } : { running: false });
  });

  /**
   * POST /api/running/:userId/:conversationId/stop
   * The stop button: what was written so far is kept in the thread.
   */
  router.post("/running/:userId/:conversationId/stop", (req: Request, res: Response) => {
    res.json({ stopped: running.stop(String(req.params.userId), String(req.params.conversationId)) });
  });

  /**
   * GET /api/search/:userId?q=
   * Messages of this user's threads that contain the words, newest first.
   */
  router.get("/search/:userId", async (req: Request, res: Response) => {
    if (!conversations?.searchMessages) return res.status(501).json({ error: "Search not available" });
    const userId = String(req.params.userId);
    const q = String(req.query.q ?? "").trim().slice(0, 200);
    if (q.length < 2) return res.json([]);
    const hits = (await conversations.searchMessages(userId, q, 60)).filter((m) => isThreadId(m.conversationId));
    const titles = new Map((await conversations.listConversations(userId)).map((c) => [c.conversationId, c.title]));
    const needle = q.toLowerCase();
    res.json(
      hits.slice(0, 30).map((m) => {
        const text = m.content.replace(/<document name="([^"]*)">[\s\S]*?(<\/document>|$)/g, "📄 $1").replace(/\s+/g, " ");
        const at = Math.max(0, text.toLowerCase().indexOf(needle));
        const from = Math.max(0, at - 60);
        return {
          conversationId: m.conversationId,
          title: titles.get(m.conversationId) ?? "",
          messageId: m.id,
          role: m.role,
          snippet: (from ? "…" : "") + text.slice(from, at + needle.length + 100) + (at + needle.length + 100 < text.length ? "…" : ""),
          createdAt: m.createdAt,
        };
      })
    );
  });

  /**
   * POST /api/conversations/:userId/:conversationId/truncate
   * Deletes a message and everything after it (edit / regenerate). Body: { messageId }.
   */
  router.post("/conversations/:userId/:conversationId/truncate", async (req: Request, res: Response) => {
    if (!conversations?.deleteMessagesFrom) return res.status(501).json({ error: "Not available" });
    const messageId = typeof req.body?.messageId === "string" ? req.body.messageId : "";
    if (!messageId) return res.status(400).json({ error: "messageId is required" });
    const deleted = await conversations.deleteMessagesFrom(String(req.params.conversationId), String(req.params.userId), messageId);
    if (!deleted) return res.status(404).json({ error: "Message not found" });
    res.json({ deleted });
  });

  /**
   * GET /api/conversations/:userId/:conversationId/export?format=md|pdf|docx
   * The thread as a document to download.
   */
  router.get("/conversations/:userId/:conversationId/export", async (req: Request, res: Response) => {
    if (!conversations) return res.status(501).json({ error: "Conversation store not available" });
    const userId = String(req.params.userId);
    const conversationId = String(req.params.conversationId);
    const format = ["md", "pdf", "docx"].includes(String(req.query.format)) ? String(req.query.format) : "md";
    const messages = (await conversations.getConversationHistory(conversationId, THREAD_MESSAGE_CAP)).filter((m) => m.userId === userId);
    if (!messages.length) return res.status(404).json({ error: "Conversation not found" });
    const title = (await conversations.listConversations(userId)).find((c) => c.conversationId === conversationId)?.title || "Fil MaDo";
    const body = messages
      .map((m) => {
        const content = m.content
          .replace(/<document name="([^"]*)">[\s\S]*?(<\/document>|$)/g, "[📄 $1]")
          .replace(/!\[([^\]]*)\]\(api\/media\/[^)]*\)/g, "[image : $1]")
          .replace(/\[📎 ([^\]]*)\]\(api\/media\/[^)]*\)/g, "[fichier : $1]");
        const when = new Date(m.createdAt ?? Date.now()).toLocaleString("fr-FR");
        return `## ${m.role === "user" ? "Vous" : "MaDo"} — ${when}\n\n${content}`;
      })
      .join("\n\n---\n\n");
    const file = createFile({ filename: title.slice(0, 80), format, content: `# ${title}\n\n${body}` });
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.send(file.data);
  });

  // ----- projects -----

  const ProjectSchema = z.object({
    name: z.string().transform((v) => v.replace(/\s+/g, " ").trim()).pipe(z.string().min(1).max(PROJECT_LIMITS.name)).optional(),
    instructions: z.string().max(PROJECT_LIMITS.instructions).optional(),
  });

  router.get("/projects/:userId", (req: Request, res: Response) => {
    if (!workspace) return res.status(501).json({ error: "Projects not available" });
    res.json(workspace.listProjects(String(req.params.userId)));
  });

  router.post("/projects/:userId", (req: Request, res: Response) => {
    if (!workspace) return res.status(501).json({ error: "Projects not available" });
    const parsed = ProjectSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.name) return res.status(400).json({ error: "A project needs a name (1-80 characters)." });
    try {
      res.json(workspace.createProject(String(req.params.userId), parsed.data.name, parsed.data.instructions ?? ""));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Not created" });
    }
  });

  router.patch("/projects/:userId/:projectId", (req: Request, res: Response) => {
    if (!workspace) return res.status(501).json({ error: "Projects not available" });
    const parsed = ProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid project" });
    const ok = workspace.updateProject(String(req.params.userId), String(req.params.projectId), parsed.data);
    res.status(ok ? 200 : 404).json(ok ? { ok } : { error: "Project not found" });
  });

  router.delete("/projects/:userId/:projectId", (req: Request, res: Response) => {
    if (!workspace) return res.status(501).json({ error: "Projects not available" });
    const ok = workspace.deleteProject(String(req.params.userId), String(req.params.projectId));
    res.status(ok ? 200 : 404).json(ok ? { ok } : { error: "Project not found" });
  });

  router.put("/conversations/:userId/:conversationId/project", (req: Request, res: Response) => {
    if (!workspace) return res.status(501).json({ error: "Projects not available" });
    const projectId = req.body?.projectId;
    if (projectId !== null && typeof projectId !== "string") return res.status(400).json({ error: "projectId must be a string or null" });
    try {
      workspace.setConversationProject(String(req.params.userId), String(req.params.conversationId), projectId);
      res.json({ ok: true });
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ----- reminders and scheduled tasks -----

  router.get("/tasks/:userId", async (req: Request, res: Response) => {
    const scheduler = extras.scheduler;
    if (!scheduler) return res.json([]);
    const tz = await scheduler.timeZone();
    res.json(
      scheduler.list(String(req.params.userId)).map((t) => ({
        ...t,
        description: describeSchedule(t.schedule, tz),
      }))
    );
  });

  router.delete("/tasks/:userId/:taskId", (req: Request, res: Response) => {
    const ok = extras.scheduler?.cancel(String(req.params.userId), String(req.params.taskId)) ?? false;
    res.status(ok ? 200 : 404).json(ok ? { ok } : { error: "Not found (the morning briefing is set in the add-on options)" });
  });

  // ----- cost counter -----

  router.get("/usage/:userId", async (req: Request, res: Response) => {
    if (!workspace) return res.status(501).json({ error: "Cost counter not available" });
    const userId = String(req.params.userId);
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const titles = conversations
      ? new Map((await conversations.listConversations(userId)).map((c) => [c.conversationId, c.title]))
      : new Map<string, string>();
    const byDay = workspace.usageByDay(userId, days);
    res.json({
      currency: "USD",
      days,
      byDay,
      byModel: workspace.usageByModel(userId, days),
      byConversation: workspace
        .usageByConversation(userId, days)
        .map((c) => ({ ...c, title: c.conversationId === "assist" ? "Assist (voix et texte)" : titles.get(c.conversationId) ?? "Fil supprimé" })),
      total: Math.round(byDay.reduce((n, d) => n + d.cost, 0) * 1e6) / 1e6,
      unpriced: byDay.reduce((n, d) => n + d.unpriced, 0),
    });
  });

  // ----- model picker -----

  router.get("/models", async (_req: Request, res: Response) => {
    if (!extras.models) return res.json({ models: [] });
    res.json(await extras.models());
  });

  // ----- diagnostics -----

  router.post("/diagnostics", async (req: Request, res: Response) => {
    if (!extras.diagnostics) return res.status(501).json({ error: "Diagnostics not available" });
    res.json(await extras.diagnostics(req.body?.paid === true));
  });

  /**
   * GET /api/media/:id
   * A chart or image a tool produced (see llm/media-store.ts). Raster images
   * are served inline; anything else only as a download.
   */
  router.get("/media/:id", (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    const media = getMediaStore().get(id);
    if (!media) return res.status(404).json({ error: "Not found" });
    res.setHeader("Content-Type", media.mime);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    if (!media.inline) res.setHeader("Content-Disposition", `attachment; filename="${id}"`);
    res.send(media.data);
  });

  /**
   * GET /api/health
   * Health check endpoint
   */
  router.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version,
      memoryBackend,
      ...healthCapabilities(stt, tts, ttsLanguage),
    });
  });

  return router;
}
