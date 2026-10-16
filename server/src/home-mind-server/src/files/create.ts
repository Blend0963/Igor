/**
 * Files Igor writes for the user: Word, Excel, PDF, text formats and ZIP
 * archives of them, built here without dependencies (office files are ZIP
 * archives of XML, see zip.ts). The model describes the content; this turns
 * it into a file the user downloads from the chat panel.
 *
 * Word and PDF take a light Markdown: "#" headings, "-" / "1." lists,
 * "| a | b |" tables, **bold** and *italic*, blank lines between paragraphs.
 */

import { writeZip, type ZipEntry } from "./zip.js";

export type CreatableFormat = "txt" | "md" | "csv" | "json" | "html" | "xml" | "ics" | "docx" | "xlsx" | "pdf" | "zip";
export const CREATABLE_FORMATS: CreatableFormat[] = ["txt", "md", "csv", "json", "html", "xml", "ics", "docx", "xlsx", "pdf", "zip"];

export interface SheetSpec {
  name?: string;
  rows: unknown[][];
}

export interface FileSpec {
  filename?: string;
  format?: string;
  content?: string;
  sheets?: SheetSpec[];
  files?: FileSpec[];
}

export interface CreatedFile {
  filename: string;
  mime: string;
  data: Buffer;
}

const MIME: Record<CreatableFormat, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  xml: "application/xml",
  ics: "text/calendar",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  zip: "application/zip",
};

/** Bounds on what one call may build. */
export const CREATE_LIMITS = { contentChars: 500_000, rows: 20_000, columns: 200, sheets: 20, files: 50 } as const;

function safeName(name: string | undefined, format: CreatableFormat): string {
  const base = (name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120) || "document";
  return base.toLowerCase().endsWith(`.${format}`) ? base : `${base.replace(/\.[a-z0-9]{1,5}$/i, "")}.${format}`;
}

function formatOf(spec: FileSpec): CreatableFormat {
  const declared = (spec.format ?? "").toLowerCase().replace(/^\./, "");
  if ((CREATABLE_FORMATS as string[]).includes(declared)) return declared as CreatableFormat;
  const ext = (spec.filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  if ((CREATABLE_FORMATS as string[]).includes(ext)) return ext as CreatableFormat;
  if (spec.sheets) return "xlsx";
  if (spec.files) return "zip";
  return "txt";
}

function xml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ----- light Markdown, shared by Word and PDF -----

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "item"; text: string; ordered: boolean; n: number; indent: number }
  | { kind: "table"; rows: string[][] }
  | { kind: "rule" };

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(\s*)([-*+]|(\d{1,3})[.)])\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1].length, text: h[2] });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
    } else if (line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      flush();
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      i--;
      blocks.push({ kind: "table", rows });
    } else if (item) {
      flush();
      blocks.push({ kind: "item", text: item[4], ordered: Boolean(item[3]), n: Number(item[3] ?? 0), indent: Math.min(3, Math.floor(item[1].length / 2)) });
    } else para.push(line.trim());
  }
  flush();
  return blocks;
}

/** Text runs with bold / italic from **…** and *…*. */
function runs(text: string): { text: string; bold: boolean; italic: boolean }[] {
  const out: { text: string; bold: boolean; italic: boolean }[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false, italic: false });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true, italic: false });
    else if (m[2] !== undefined) out.push({ text: m[2], bold: false, italic: true });
    else out.push({ text: m[3], bold: false, italic: false });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false, italic: false });
  return out;
}

// ----- Word -----

function wRuns(text: string, size?: number, forceBold = false): string {
  return runs(text)
    .map((r) => {
      const props = [r.bold || forceBold ? "<w:b/>" : "", r.italic ? "<w:i/>" : "", size ? `<w:sz w:val="${size}"/>` : ""].join("");
      return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
    })
    .join("");
}

export function buildDocx(markdown: string): Buffer {
  const HEADING_SIZES = [36, 30, 26, 24, 22, 22];
  const body = parseBlocks(markdown)
    .map((b) => {
      switch (b.kind) {
        case "heading":
          return `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>${wRuns(b.text, HEADING_SIZES[b.level - 1], true)}</w:p>`;
        case "para":
          return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${wRuns(b.text)}</w:p>`;
        case "item": {
          const marker = b.ordered ? `${b.n}.` : "•";
          const left = 360 + b.indent * 360;
          return `<w:p><w:pPr><w:spacing w:after="60"/><w:ind w:left="${left}" w:hanging="270"/></w:pPr>${wRuns(`${marker}\t${b.text}`)}</w:p>`;
        }
        case "rule":
          return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>`;
        case "table": {
          const border = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:color="999999"/>`).join("")}</w:tblBorders>`;
          const rows = b.rows
            .map((row, r) => `<w:tr>${row.map((cell) => `<w:tc><w:p>${wRuns(cell, undefined, r === 0)}</w:p></w:tc>`).join("")}</w:tr>`)
            .join("");
          return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${border}</w:tblPr>${rows}</w:tbl><w:p/>`;
        }
      }
    })
    .join("");
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return writeZip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
    },
    { name: "word/document.xml", data: Buffer.from(document) },
  ]);
}

// ----- Excel -----

function columnName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetName(name: string | undefined, i: number, used: Set<string>): string {
  let base = (name ?? "").replace(/[[\]:*?/\\]/g, "").trim().slice(0, 31) || `Feuille${i + 1}`;
  while (used.has(base.toLowerCase())) base = `${base.slice(0, 28)}_${i + 1}`;
  used.add(base.toLowerCase());
  return base;
}

/** Rows from CSV text (comma or semicolon, quoted fields). */
/** Spreadsheet functions that reach outside the file. */
const UNSAFE_FORMULA = /\b(HYPERLINK|WEBSERVICE|FILTERXML|IMPORTDATA|IMPORTXML|IMPORTHTML|IMPORTFEED|IMPORTRANGE|IMAGE|CALL|REGISTER(\.ID)?|EXEC|RTD|DDE|INFO)\s*\(|\|/i;

/**
 * A CSV whose cells cannot start a formula when opened in a spreadsheet
 * (=, +, -, @ at the start of a non-numeric cell get a leading apostrophe).
 */
export function neutralizeCsv(text: string): string {
  const quote = (cell: string) => (/[",\n\r;]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return parseCsv(text)
    .map((row) =>
      row
        .map((cell) => (/^[=+\-@\t\r]/.test(cell) && !/^[+-]?\d+([.,]\d+)?$/.test(cell) ? `'${cell}` : cell))
        .map(quote)
        .join(",")
    )
    .join("\r\n");
}

export function parseCsv(text: string): string[][] {
  const sep = (text.split("\n")[0].match(/;/g) ?? []).length > (text.split("\n")[0].match(/,/g) ?? []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function buildXlsx(sheets: SheetSpec[]): Buffer {
  const used = new Set<string>();
  const specs = sheets.slice(0, CREATE_LIMITS.sheets).map((s, i) => ({ name: sheetName(s.name, i, used), rows: (s.rows ?? []).slice(0, CREATE_LIMITS.rows) }));
  if (!specs.length) specs.push({ name: "Feuille1", rows: [] });
  const sheetXml = specs.map((s) => {
    const rows = s.rows
      .map((row, r) => {
        const cells = (Array.isArray(row) ? row : [row]).slice(0, CREATE_LIMITS.columns).map((v, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const style = r === 0 ? ' s="1"' : "";
          if (v === null || v === undefined || v === "") return "";
          if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
          if (typeof v === "boolean") return `<c r="${ref}" t="b"${style}><v>${v ? 1 : 0}</v></c>`;
          const text = String(v);
          // A formula the model wrote ("=SUM(B2:B9)") stays a formula, unless
          // it reaches outside the workbook (links, web calls, DDE): those are
          // how a spreadsheet made from untrusted text phones home.
          if (/^=[A-Z]/.test(text) && !UNSAFE_FORMULA.test(text)) return `<c r="${ref}"${style}><f>${xml(text.slice(1))}</f></c>`;
          if (/^-?\d+([.,]\d+)?$/.test(text) && text.length < 16) return `<c r="${ref}"${style}><v>${text.replace(",", ".")}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
        });
        return `<row r="${r + 1}">${cells.join("")}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
          specs.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
          `</Types>`
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
          specs.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
          `</sheets></workbook>`
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          specs.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
          `<Relationship Id="rId${specs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      ),
    },
    {
      name: "xl/styles.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
          `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
          `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
          `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
          `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
          `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
          `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
          `</styleSheet>`
      ),
    },
    ...sheetXml.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(data) })),
  ];
  return writeZip(entries);
}

// ----- PDF -----

const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97, "™": 0x99, "œ": 0x9c, "Œ": 0x8c, "Ÿ": 0x9f, " ": 0x20, " ": 0x20,
};

/** A PDF string literal in WinAnsi, non-ASCII bytes as octal escapes. */
function pdfString(text: string): string {
  let out = "(";
  for (const ch of text) {
    let code = WIN_ANSI[ch] ?? ch.codePointAt(0)!;
    if (code > 0xff || (code < 0x20 && ch !== "\t")) code = 0x3f;
    if (ch === "\t") code = 0x20;
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += "\\" + String.fromCharCode(code);
    else if (code < 0x80) out += String.fromCharCode(code);
    else out += "\\" + code.toString(8).padStart(3, "0");
  }
  return out + ")";
}

/** Helvetica's average glyph width, as a share of the font size. */
const AVG_WIDTH = 0.5;

function wrap(text: string, size: number, width: number): string[] {
  const max = Math.max(10, Math.floor(width / (size * AVG_WIDTH)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if ((line + " " + word).length <= max) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
    while (line.length > max) {
      lines.push(line.slice(0, max));
      line = line.slice(max);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function buildPdf(markdown: string, title?: string): Buffer {
  const W = 595, H = 842, M = 56;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = H - M;
  const newPage = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = H - M;
  };
  const text = (s: string, x: number, size: number, bold = false) => {
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td ${pdfString(s)} Tj ET`);
  };
  const lineOf = (s: string, x: number, size: number, bold = false, gap = 1.35) => {
    if (y - size * gap < M) newPage();
    y -= size * gap;
    text(s, x, size, bold);
  };
  const plain = (s: string) => runs(s).map((r) => r.text).join("");
  const SIZES = [20, 16, 14, 12, 12, 12];
  if (title) lineOf(title, M, 22, true);
  for (const b of parseBlocks(markdown)) {
    if (b.kind === "heading") {
      y -= 8;
      for (const l of wrap(plain(b.text), SIZES[b.level - 1], W - 2 * M)) lineOf(l, M, SIZES[b.level - 1], true);
      y -= 2;
    } else if (b.kind === "para") {
      const allBold = /^\*\*[^*]+\*\*$/.test(b.text.trim());
      for (const l of wrap(plain(b.text), 11, W - 2 * M)) lineOf(l, M, 11, allBold);
      y -= 6;
    } else if (b.kind === "item") {
      const indent = M + 14 + b.indent * 16;
      const lines = wrap(plain(b.text), 11, W - indent - M);
      lines.forEach((l, i) => {
        lineOf(l, indent, 11);
        if (i === 0) text(b.ordered ? `${b.n}.` : "•", indent - 14, 11);
      });
      y -= 2;
    } else if (b.kind === "rule") {
      y -= 8;
      ops.push(`0.6 G ${M} ${y.toFixed(1)} m ${W - M} ${y.toFixed(1)} l S 0 G`);
      y -= 6;
    } else if (b.kind === "table") {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const colW = (W - 2 * M) / cols;
      b.rows.forEach((row, r) => {
        const cells = row.map((c) => wrap(plain(c), 10, colW - 8));
        const height = Math.max(...cells.map((c) => c.length)) * 13 + 6;
        if (y - height < M) newPage();
        const top = y;
        cells.forEach((lines, c) => {
          let ly = top - 13;
          for (const l of lines) {
            ops.push(`BT /${r === 0 ? "F2" : "F1"} 10 Tf ${(M + c * colW + 4).toFixed(1)} ${ly.toFixed(1)} Td ${pdfString(l)} Tj ET`);
            ly -= 13;
          }
        });
        y = top - height;
        ops.push(`0.7 G ${M} ${y.toFixed(1)} m ${(M + cols * colW).toFixed(1)} ${y.toFixed(1)} l S 0 G`);
      });
      y -= 10;
    }
  }
  newPage();
  if (pages.length > 1 && !pages[pages.length - 1]) pages.pop();

  const objects: string[] = [];
  const add = (body: string) => objects.push(body) ;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages, filled below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const content of pages) {
    const stream = Buffer.from(content, "latin1");
    add(`<< /Length ${stream.length} >>\nstream\n${content}\nendstream`);
    const contentId = objects.length;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ----- entry point -----

/** One file from what the model described. Throws on an empty request. */
export function createFile(spec: FileSpec, depth = 0): CreatedFile {
  const format = formatOf(spec);
  const filename = safeName(spec.filename, format);
  const content = (spec.content ?? "").slice(0, CREATE_LIMITS.contentChars);
  let data: Buffer;
  switch (format) {
    case "docx":
      data = buildDocx(content);
      break;
    case "pdf":
      data = buildPdf(content);
      break;
    case "xlsx": {
      const sheets = spec.sheets?.length ? spec.sheets : [{ name: undefined, rows: parseCsv(content) }];
      data = buildXlsx(sheets);
      break;
    }
    case "zip": {
      if (depth > 0) throw new Error("archives inside archives are not supported");
      const files = (spec.files ?? []).slice(0, CREATE_LIMITS.files).map((f) => createFile(f, depth + 1));
      if (!files.length) throw new Error("a zip needs 'files'");
      const seen = new Set<string>();
      data = writeZip(files.map((f) => {
        let name = f.filename;
        for (let n = 2; seen.has(name.toLowerCase()); n++) name = f.filename.replace(/(\.[^.]+)?$/, `-${n}$1`);
        seen.add(name.toLowerCase());
        return { name, data: f.data };
      }));
      break;
    }
    case "csv":
      // Excel opens a UTF-8 CSV with accents correctly only with a BOM.
      data = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(neutralizeCsv(content), "utf8")]);
      break;
    default:
      data = Buffer.from(content, "utf8");
  }
  if (!data.length) throw new Error("the file would be empty");
  return { filename, mime: MIME[format], data };
}
