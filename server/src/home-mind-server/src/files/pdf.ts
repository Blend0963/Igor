/**
 * The text layer of a PDF, read on the add-on with pdf.js.
 *
 * Most PDFs (invoices, downloaded manuals, exports) carry their text and
 * need no OCR at all; only scans and photographed pages do. Reading the text
 * layer first makes those free and leaves Mistral OCR, billed per page, for
 * the documents that are pictures of text.
 */

/** Pages read at most. */
export const MAX_PDF_PAGES = 500;
/** A page with fewer visible characters than this is taken for a picture. */
const MIN_PAGE_CHARS = 25;

export interface PdfText {
  pages: number;
  /** Pages that carry no real text (scans, photos). */
  imagePages: number;
  text: string;
  /** True when the text layer is too thin to stand for the document. */
  needsOcr: boolean;
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | undefined;

export async function readPdfText(data: Buffer, maxChars: number): Promise<PdfText> {
  pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  const { getDocument } = await pdfjs;
  // Text only: no fonts loaded, nothing rendered.
  const task = getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const pages = doc.numPages;
    const parts: string[] = [];
    let used = 0;
    let imagePages = 0;
    for (let i = 1; i <= Math.min(pages, MAX_PDF_PAGES); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
      page.cleanup();
      if (text.replace(/\s/g, "").length < MIN_PAGE_CHARS) imagePages++;
      if (used < maxChars) {
        parts.push(`--- page ${i} ---\n${text}`);
        used += text.length;
      }
    }
    const read = Math.min(pages, MAX_PDF_PAGES);
    return {
      pages,
      imagePages,
      text: parts.join("\n\n"),
      // Half the pages without text: a scan, or mostly one.
      needsOcr: read > 0 && imagePages * 2 >= read,
    };
  } finally {
    await task.destroy();
  }
}
