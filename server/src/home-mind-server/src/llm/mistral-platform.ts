/**
 * Mistral's built-in tools, reached the way web_search already is: one
 * `/v1/conversations` call that carries the tool, separate from MaDo's own
 * chat loop, so the Home Assistant tools and the conversation stay ours.
 *
 * - code_interpreter: Python in Mistral's sandbox (exact maths, data
 *   analysis, charts as image files)
 * - image_generation: images from a description
 * - document_library: search the owner's own documents (device manuals...)
 * - connector: MCP connectors set up in Mistral's console
 * - OCR: PDF to markdown, for documents attached to a message
 *
 * Every response is parsed defensively: the platform is young, documents its
 * shapes mostly through SDK examples, and a field we do not expect must
 * degrade to "no text" rather than throw.
 */

import { extractFileText, type OcrRequest } from "../files/extract.js";

const API = "https://api.mistral.ai/v1";

/**
 * The model that runs a built-in tool call. Mistral documents the agent tools
 * (code interpreter, image generation, libraries, connectors) on its Medium
 * and Large models; the call is short, so Medium keeps it cheap.
 */
export const MISTRAL_TOOL_MODEL = process.env.MISTRAL_TOOL_MODEL || "mistral-medium-latest";

/** The Mistral key the platform tools run on, when one is configured. */
export function mistralKey(): string | undefined {
  return process.env.MISTRAL_API_KEY?.trim() || undefined;
}

export interface MistralFileRef {
  fileId: string;
  fileName?: string;
  fileType?: string;
}

export interface ConversationResult {
  /** The text of every message.output entry, joined. */
  text: string;
  /** Files the tools produced (charts, generated images). */
  files: MistralFileRef[];
  /** Code the interpreter ran, with its output. */
  executions: { code?: string; output?: string }[];
  /** Titles or ids of the documents a library search cited. */
  references: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Reads a /v1/conversations response into text, files and code runs. */
export function parseConversationOutputs(outputs: unknown): ConversationResult {
  const result: ConversationResult = { text: "", files: [], executions: [], references: [] };
  if (!Array.isArray(outputs)) return result;
  const texts: string[] = [];
  for (const entry of outputs) {
    const e = asRecord(entry);
    if (!e) continue;
    if (e.type === "tool.execution") {
      const info = asRecord(e.info) ?? {};
      const code = typeof info.code === "string" ? info.code : undefined;
      const output = typeof info.code_output === "string" ? info.code_output : undefined;
      if (code || output) result.executions.push({ code, output });
      continue;
    }
    const content = e.content;
    if (typeof content === "string") {
      texts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const chunk of content) {
      const c = asRecord(chunk);
      if (!c) continue;
      if (c.type === "text" && typeof c.text === "string") texts.push(c.text);
      else if (c.type === "tool_file" && typeof c.file_id === "string") {
        result.files.push({
          fileId: c.file_id,
          fileName: typeof c.file_name === "string" ? c.file_name : undefined,
          fileType: typeof c.file_type === "string" ? c.file_type : undefined,
        });
      } else if (c.type === "tool_reference") {
        const label = [c.title, c.url, c.source].find((v) => typeof v === "string") as string | undefined;
        if (label) result.references.push(label);
      }
    }
  }
  result.text = texts.join("").trim();
  return result;
}

async function post(apiKey: string, path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 400);
    throw new Error(`Mistral ${path} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

/** One conversation turn with built-in tools, nothing stored on Mistral's side. */
export async function runConversation(
  apiKey: string,
  instruction: string,
  tools: Record<string, unknown>[],
  timeoutMs = 90000
): Promise<ConversationResult> {
  const payload = (await post(
    apiKey,
    "/conversations",
    {
      model: MISTRAL_TOOL_MODEL,
      inputs: [{ role: "user", content: instruction }],
      tools,
      store: false,
    },
    timeoutMs
  )) as { outputs?: unknown };
  return parseConversationOutputs(payload.outputs);
}

/** The bytes of a file a tool produced. */
export async function downloadFile(apiKey: string, fileId: string): Promise<{ data: Buffer; mime: string }> {
  const response = await fetch(`${API}/files/${encodeURIComponent(fileId)}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Mistral file download returned HTTP ${response.status}`);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    mime: response.headers.get("content-type") || "application/octet-stream",
  };
}

/** Longest OCR text handed to the model, in characters (~10k tokens). */
export const MAX_OCR_CHARS = 40000;

/** A PDF (data URL) as markdown, through Mistral OCR. */
export async function ocrDocument(apiKey: string, dataUrl: string): Promise<string> {
  const payload = (await post(
    apiKey,
    "/ocr",
    {
      model: "mistral-ocr-latest",
      document: { type: "document_url", document_url: dataUrl },
    },
    120000
  )) as { pages?: { markdown?: unknown }[] };
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const text = pages
    .map((p, i) => (typeof p?.markdown === "string" ? `--- page ${i + 1} ---\n${p.markdown}` : ""))
    .filter(Boolean)
    .join("\n\n");
  return text.length > MAX_OCR_CHARS
    ? `${text.slice(0, MAX_OCR_CHARS)}\n\n[… document cut after ${MAX_OCR_CHARS} characters of ${text.length}]`
    : text;
}

/** Comma-separated list from the environment. */
export function listFromEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** A file attached to a chat message, as a data URL. */
export interface AttachedDocument {
  name: string;
  data: string;
}

/** The marker a stored message carries for each file, read back by the panel. */
export function documentBlock(name: string, text: string): string {
  const safeName = name.replace(/["<>\n\r]/g, "").slice(0, 200) || "document";
  // The file's own text cannot close the block early and pass for the user's
  // words: any </document> inside it is defused.
  const body = text.replace(/<\/?document\b/gi, (tag) => tag.replace("<", "‹"));
  return `<document name="${safeName}">\n${body}\n</document>`;
}

/** The media type and bytes of a data URL. */
export function decodeDataUrl(dataUrl: string): { mime: string; data: Buffer } {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(5, comma);
  return { mime: header.split(";")[0] || "application/octet-stream", data: Buffer.from(dataUrl.slice(comma + 1), "base64") };
}

/**
 * The user's message with the text of every attached file after it. Read
 * once (on the add-on, or through OCR for a scanned PDF the user agreed to
 * pay for) and stored with the message: later turns of the thread see the
 * file in their history without reading it again.
 *
 * `ocrRequests` lists the scans still waiting for that agreement; the caller
 * must ask before going on when it is not empty.
 */
export async function withDocuments(
  message: string,
  documents: AttachedDocument[],
  apiKey?: string,
  ocr: "ask" | "yes" | "no" = "ask"
): Promise<{ message: string; ocrRequests: OcrRequest[] }> {
  const blocks: string[] = [];
  const ocrRequests: OcrRequest[] = [];
  for (const doc of documents) {
    const { mime, data } = decodeDataUrl(doc.data);
    const text = await extractFileText(doc.name, mime, data, {
      ocrPdf: apiKey ? (dataUrl) => ocrDocument(apiKey, dataUrl) : undefined,
      ocr,
      ocrRequests,
    });
    blocks.push(documentBlock(doc.name, text));
  }
  return { message: blocks.length ? `${message}\n\n${blocks.join("\n\n")}` : message, ocrRequests };
}

/** Mistral's OCR list price per 1000 pages, in USD (OCR_PRICE_PER_1000_PAGES). */
export function ocrPricePer1000Pages(): number {
  const n = Number(process.env.OCR_PRICE_PER_1000_PAGES);
  return Number.isFinite(n) && n >= 0 ? n : 4;
}
