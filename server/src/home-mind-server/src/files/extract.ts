/**
 * The text of a file attached to a chat message, for the model to read.
 *
 * Read here, on the add-on, whenever the format allows it: Word, Excel,
 * PowerPoint and OpenDocument files are ZIP archives of XML, text formats are
 * text, a PDF's own text layer is read with pdf.js, and an archive is opened
 * and its readable files read in turn. Only a PDF without text (a scan) needs
 * Mistral OCR, which is billed per page, and only once the user has agreed to
 * its price; everything else costs nothing but the tokens of the text itself,
 * which is capped per file.
 */

import { readZip, type ZipEntry } from "./zip.js";
import { readPdfText } from "./pdf.js";

/** Longest text kept from one attached file, in characters (~10k tokens). */
export const MAX_FILE_CHARS = 40000;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "html", "htm", "yaml", "yml", "toml", "ini",
  "conf", "cfg", "log", "js", "mjs", "ts", "py", "sh", "bash", "sql", "ics", "vcf", "svg", "rtf", "tex", "srt",
  "css", "java", "c", "h", "cpp", "go", "rs", "php", "rb", "kt", "swift", "lua", "env", "properties", "gpx", "kml",
]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "tif", "tiff"]);
const LEGACY_OFFICE = new Set(["doc", "xls", "ppt"]);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Word: paragraphs, headings marked with #, tables as | rows. */
export function docxText(entries: ZipEntry[]): string {
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) return "";
  const xml = doc.data.toString("utf8");
  let out = "";
  let heading = 0;
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>|<w:pStyle w:val="([^"]+)"|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
  let m: RegExpExecArray | null;
  let line = "";
  while ((m = token.exec(xml))) {
    const t = m[0];
    if (m[1] !== undefined) line += decodeXml(m[1]);
    else if (t.startsWith("<w:tab")) line += "\t";
    else if (t.startsWith("<w:br")) line += "\n";
    else if (m[2] !== undefined) {
      const level = /(?:heading|titre|title)\s*(\d)?/i.exec(m[2]);
      heading = level ? Number(level[1] ?? 1) : 0;
    } else if (t === "</w:p>") {
      out += (heading && line.trim() ? `${"#".repeat(Math.min(heading, 4))} ` : "") + line;
      line = "";
      heading = 0;
      out += "\n";
    } else if (t === "</w:tc>") {
      out = out.replace(/\n$/, "") + " | ";
    } else if (t === "</w:tr>") {
      out = out.replace(/ \| $/, "") + "\n";
    }
  }
  return tidy(out + line);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function csvCell(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Excel: every sheet as CSV under its name. */
export function xlsxText(entries: ZipEntry[], budget = MAX_FILE_CHARS): string {
  const get = (n: string) => entries.find((e) => e.name === n)?.data.toString("utf8");
  const shared: string[] = [];
  const sst = get("xl/sharedStrings.xml");
  if (sst) {
    for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml((si.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
    }
  }
  const workbook = get("xl/workbook.xml") ?? "";
  const names = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"/g)].map((m) => ({ name: decodeXml(m[1]), rid: m[2] }));
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]*)"[^>]*\bTarget="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  let sheets = names.map((s) => {
    const target = (targets.get(s.rid) ?? "").replace(/^\/?(xl\/)?/, "");
    return { name: s.name, path: target ? `xl/${target}` : "" };
  });
  if (!sheets.some((s) => s.path && get(s.path))) {
    sheets = entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .map((e, i) => ({ name: names[i]?.name ?? `Sheet${i + 1}`, path: e.name }));
  }
  const parts: string[] = [];
  let used = 0;
  for (const sheet of sheets) {
    const xml = get(sheet.path);
    if (!xml) continue;
    const lines: string[] = [];
    for (const row of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const cells: string[] = [];
      for (const c of row.match(/<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>/g) ?? []) {
        const ref = /\br="([A-Z]+)\d+"/.exec(c)?.[1] ?? "";
        const type = /\bt="([^"]+)"/.exec(c)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(c)?.[1];
        let value = "";
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = decodeXml((c.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join(""));
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (v !== undefined) value = decodeXml(v);
        else {
          // A formula never calculated (written by a program, not Excel).
          const f = /<f>([^<]*)<\/f>/.exec(c)?.[1];
          if (f) value = `=${decodeXml(f)}`;
        }
        const at = ref ? columnIndex(ref) : cells.length;
        while (cells.length < at) cells.push("");
        cells[at] = csvCell(value);
      }
      if (cells.some((c) => c !== "")) lines.push(cells.join(","));
      used += lines[lines.length - 1]?.length ?? 0;
      if (used > budget) break;
    }
    parts.push(`## Sheet: ${sheet.name}\n${lines.join("\n")}`);
    if (used > budget) break;
  }
  return parts.join("\n\n");
}

/** PowerPoint: the text of each slide, in order. */
export function pptxText(entries: ZipEntry[]): string {
  const slides = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a.name)![1]) - Number(/(\d+)\.xml$/.exec(b.name)![1]));
  return slides
    .map((s, i) => {
      const xml = s.data.toString("utf8").replace(/<\/a:p>/g, "\n");
      const text = (xml.match(/<a:t>[^<]*<\/a:t>|\n/g) ?? []).map((t) => (t === "\n" ? "\n" : decodeXml(t.slice(5, -6)))).join("");
      return `--- slide ${i + 1} ---\n${tidy(text)}`;
    })
    .join("\n\n");
}

/** OpenDocument (odt, ods, odp): paragraphs, cells and rows from content.xml. */
export function odfText(entries: ZipEntry[]): string {
  const content = entries.find((e) => e.name === "content.xml");
  if (!content) return "";
  const xml = content.data
    .toString("utf8")
    .replace(/<text:tab\/>/g, "\t")
    .replace(/<text:line-break\/>/g, "\n")
    .replace(/<\/text:(p|h)>\s*<\/table:table-cell>/g, " | ")
    .replace(/<\/text:(p|h)>/g, "\n")
    .replace(/<\/table:table-cell>/g, " | ")
    .replace(/<\/table:table-row>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeXml(xml).replace(/ \| \n/g, "\n"));
}

function htmlText(html: string): string {
  return tidy(
    decodeXml(
      html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
        .replace(/<\/(p|div|h\d|li|tr|br)>|<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
    )
  );
}

/** True when a buffer reads as text (valid UTF-8, almost no control bytes). */
function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 4096);
  if (sample.includes(0)) return false;
  const text = sample.toString("utf8");
  const bad = (text.match(/[\u0000-\u0008\u000e-\u001f�]/g) ?? []).length;
  return bad <= sample.length / 100;
}

export function cut(text: string, max = MAX_FILE_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[… cut after ${max} characters of ${text.length}]` : text;
}

/** A scanned PDF waiting for the user's yes before it is sent to OCR. */
export interface OcrRequest {
  name: string;
  pages: number;
}

export interface ExtractOptions {
  /** Reads a PDF (data URL) through OCR; absent means scans cannot be read. */
  ocrPdf?: (dataUrl: string) => Promise<string>;
  /**
   * What to do with a scan: "ask" (default) records it in `ocrRequests` and
   * reads nothing, "yes" sends it to OCR, "no" leaves it unread.
   */
  ocr?: "ask" | "yes" | "no";
  /** Scans waiting for the user's decision ("ask"). */
  ocrRequests?: OcrRequest[];
  /** Archive nesting depth already reached. */
  depth?: number;
  /**
   * Inflated bytes still allowed for this file and everything inside it. An
   * archive of 500 office files used to give each one its own 50 MB, so a
   * small upload could make the server inflate gigabytes; the budget is now
   * shared by the whole file.
   */
  budget?: { bytes: number };
}

/** Inflated bytes allowed for one attached file, archives and their contents together. */
export const FILE_INFLATE_BUDGET = 60 * 1024 * 1024;

/** A ZIP read within the file's shared budget, which it then spends. */
function zipWithin(data: Buffer, opts: ExtractOptions, filter?: (name: string) => boolean): ZipEntry[] {
  const budget = (opts.budget ??= { bytes: FILE_INFLATE_BUDGET });
  if (budget.bytes <= 0) throw new Error("too much to unpack in this file");
  const entries = readZip(data, { maxEntries: 500, maxTotalBytes: Math.min(budget.bytes, 50 * 1024 * 1024) }, filter);
  budget.bytes -= entries.reduce((n, e) => n + e.data.length, 0);
  return entries;
}

/** Files read at the same time at most: parsing is CPU work on the server's one thread. */
const MAX_PARALLEL_EXTRACTIONS = 2;
let activeExtractions = 0;
const waiting: Array<() => void> = [];

async function withExtractionSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeExtractions >= MAX_PARALLEL_EXTRACTIONS) await new Promise<void>((resolve) => waiting.push(resolve));
  activeExtractions++;
  try {
    return await run();
  } finally {
    activeExtractions--;
    waiting.shift()?.();
  }
}

/** The readable text of one file, or a bracketed note saying why there is none. */
export async function extractFileText(name: string, mime: string, data: Buffer, opts: ExtractOptions = {}): Promise<string> {
  // An attached file takes a slot; what is inside an archive runs in its parent's.
  if (!opts.depth) return withExtractionSlot(() => extractOne(name, mime, data, { ...opts, budget: { bytes: FILE_INFLATE_BUDGET } }));
  return extractOne(name, mime, data, opts);
}

async function extractOne(name: string, mime: string, data: Buffer, opts: ExtractOptions): Promise<string> {
  const ext = extensionOf(name);
  const type = mime.toLowerCase();
  try {
    if (ext === "pdf" || type === "application/pdf") return await pdfFileText(name, data, opts);
    if (LEGACY_OFFICE.has(ext)) {
      return `[old binary Office format (.${ext}) not readable: save it as .${ext}x and attach it again]`;
    }
    if (["docx", "docm", "dotx"].includes(ext)) return cut(docxText(zipWithin(data, opts, (n) => n === "word/document.xml")) || "[empty document]");
    if (["xlsx", "xlsm", "xltx"].includes(ext)) return cut(xlsxText(zipWithin(data, opts, (n) => n.startsWith("xl/"))) || "[empty workbook]");
    if (["pptx", "ppsx"].includes(ext)) return cut(pptxText(zipWithin(data, opts, (n) => n.startsWith("ppt/slides/slide"))) || "[no text in these slides]");
    if (["odt", "ods", "odp"].includes(ext)) return cut(odfText(zipWithin(data, opts, (n) => n === "content.xml")) || "[empty document]");
    if (ext === "zip" || type === "application/zip" || type === "application/x-zip-compressed") {
      return cut(await zipText(data, opts.depth ?? 0, opts));
    }
    if (IMAGE_EXTENSIONS.has(ext) || type.startsWith("image/")) {
      return "[image file: attach it as an image (📎 or 📷) to have it looked at]";
    }
    if (ext === "html" || ext === "htm" || type === "text/html") return cut(htmlText(data.toString("utf8")));
    if (TEXT_EXTENSIONS.has(ext) || type.startsWith("text/") || /json|xml|yaml|csv/.test(type) || looksLikeText(data)) {
      return cut(data.toString("utf8"));
    }
    return `[binary file (${type || ext || "unknown type"}), ${data.length} bytes: its content cannot be read]`;
  } catch (error) {
    return `[file could not be read: ${error instanceof Error ? error.message : "unknown error"}]`;
  }
}

/** An archive: its listing, then the text of each readable file in it. */
async function zipText(data: Buffer, depth: number, opts: ExtractOptions): Promise<string> {
  const entries = zipWithin(data, opts);
  const listing = entries.map((e) => `- ${e.name} (${e.data.length} bytes)`).join("\n");
  if (depth >= 1) return `Archive contents:\n${listing}`;
  const parts = [`Archive contents (${entries.length} files):\n${listing}`];
  let used = parts[0].length;
  for (const entry of entries) {
    if (used > MAX_FILE_CHARS) break;
    const ext = extensionOf(entry.name);
    if (IMAGE_EXTENSIONS.has(ext) || entry.name.startsWith("__MACOSX/")) continue;
    // Never OCR inside an archive: a scanned PDF in it is only noted.
    if (opts.budget && opts.budget.bytes <= 0) {
      parts.push("[the remaining files were not read: too much to unpack in this archive]");
      break;
    }
    const text = await extractFileText(entry.name, "", entry.data, { depth: depth + 1, budget: opts.budget });
    const block = `--- ${entry.name} ---\n${cut(text, Math.max(500, MAX_FILE_CHARS - used))}`;
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n\n");
}

/** Messages at the end of the history that keep their attached files whole. */
export const RECENT_FILE_MESSAGES = 6;
/** What an older message keeps of each attached file, in characters. */
export const OLD_FILE_EXCERPT = 1500;

/**
 * A stored message with its attached files shortened to an excerpt. Every
 * message of the history window is re-sent on every model call, so a 10k-
 * token document attached ten turns ago would be paid again on each of them;
 * past the last few messages only its opening is kept, and the model is told
 * to ask for the file again if it needs more.
 */
export function shortenAttachedFiles(content: string, excerpt = OLD_FILE_EXCERPT): string {
  return content.replace(/<document name="([^"]*)">\n?([\s\S]*?)\n?<\/document>/g, (whole, name: string, body: string) =>
    body.length <= excerpt
      ? whole
      : `<document name="${name}">\n${body.slice(0, excerpt)}\n[… only the opening is kept this far back in the conversation; ask the user to attach the file again if its details are needed]\n</document>`
  );
}

/** A PDF: its own text when it has one, OCR for a scan once the user agreed. */
async function pdfFileText(name: string, data: Buffer, opts: ExtractOptions): Promise<string> {
  let local: Awaited<ReturnType<typeof readPdfText>> | undefined;
  try {
    local = await readPdfText(data, MAX_FILE_CHARS);
  } catch (error) {
    // Damaged or encrypted: OCR may still manage, so it is treated as a scan.
    console.warn(`[pdf] ${name}: ${error instanceof Error ? error.message : error}`);
  }
  if (local && !local.needsOcr) {
    const note = local.imagePages
      ? `\n\n[${local.imagePages} of ${local.pages} pages carry no text (images or scans) and were not read]`
      : "";
    return cut(local.text) + note;
  }
  const pages = local?.pages ?? 0;
  const what = `scanned PDF${pages ? ` (${pages} page${pages > 1 ? "s" : ""})` : ""}`;
  if (!opts.ocrPdf) {
    return `[${what}: it has no text layer, and reading it needs Mistral OCR, which needs a Mistral API key in the MaDo add-on configuration]`;
  }
  const decision = opts.ocr ?? "ask";
  if (decision === "no") return `[${what} not read: the user chose not to pay for OCR]`;
  if (decision === "ask") {
    opts.ocrRequests?.push({ name, pages });
    return `[${what}: waiting for the user to accept the OCR cost]`;
  }
  return cut((await opts.ocrPdf(`data:application/pdf;base64,${data.toString("base64")}`)) || "[no text found in this PDF]");
}
