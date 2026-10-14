import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { readZip, writeZip } from "./zip.js";
import { extractFileText, shortenAttachedFiles, MAX_FILE_CHARS, OLD_FILE_EXCERPT } from "./extract.js";
import { createFile, buildPdf, parseCsv } from "./create.js";

/** A one-entry deflated archive, the way real zip tools write them. */
function deflatedZip(name: string, data: Buffer, claimedSize = data.length): Buffer {
  const stored = writeZip([{ name, data: Buffer.alloc(0) }]);
  const comp = deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(claimedSize, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.from(stored.subarray(30 + nameBuf.length, 30 + nameBuf.length + 46 + nameBuf.length));
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(claimedSize, 24);
  central.writeUInt32LE(0, 42);
  const end = Buffer.from(stored.subarray(stored.length - 22));
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(30 + nameBuf.length + comp.length, 16);
  return Buffer.concat([local, nameBuf, comp, central, end]);
}

describe("zip", () => {
  it("round-trips stored entries", () => {
    const zip = writeZip([{ name: "a.txt", data: Buffer.from("hé") }, { name: "dir/b.txt", data: Buffer.from("b") }]);
    expect(readZip(zip).map((e) => [e.name, e.data.toString()])).toEqual([["a.txt", "hé"], ["dir/b.txt", "b"]]);
  });

  it("inflates deflated entries", () => {
    expect(readZip(deflatedZip("x.txt", Buffer.from("bonjour ".repeat(100))))[0].data.toString()).toContain("bonjour bonjour");
  });

  it("does not inflate past its budget (zip bomb)", () => {
    const bomb = deflatedZip("bomb.txt", Buffer.alloc(20 * 1024 * 1024));
    const entries = readZip(bomb, { maxEntries: 10, maxTotalBytes: 1024 * 1024 });
    expect(entries.reduce((n, e) => n + e.data.length, 0)).toBeLessThanOrEqual(1024 * 1024);
  });

  it("refuses something that is not an archive", () => {
    expect(() => readZip(Buffer.from("hello"))).toThrow();
  });
});

describe("creating and reading files", () => {
  const md = "# Rapport\n\nTexte **gras**.\n\n- un\n- deux\n\n| A | B |\n|---|---|\n| 1 | 2 |";

  it("writes a Word document it can read back", async () => {
    const f = createFile({ filename: "rapport", format: "docx", content: md });
    expect(f.filename).toBe("rapport.docx");
    const text = await extractFileText(f.filename, f.mime, f.data);
    expect(text).toContain("Rapport");
    expect(text).toContain("Texte gras.");
    expect(text).toContain("A | B");
  });

  it("writes an Excel workbook with numbers, formulas and several sheets", async () => {
    const f = createFile({
      filename: "conso.xlsx",
      format: "xlsx",
      sheets: [{ name: "Oct", rows: [["Jour", "kWh"], ["Lundi", 12.4], ["Total", "=SUM(B2:B2)"]] }, { name: "Notes", rows: [["é"]] }],
    });
    const text = await extractFileText(f.filename, f.mime, f.data);
    expect(text).toContain("## Sheet: Oct\nJour,kWh\nLundi,12.4\nTotal,=SUM(B2:B2)");
    expect(text).toContain("## Sheet: Notes\né");
  });

  it("builds a workbook from CSV content", () => {
    expect(parseCsv('a;b\n1;"x;y"\n')).toEqual([["a", "b"], ["1", "x;y"]]);
    const f = createFile({ filename: "t", format: "xlsx", content: "a,b\n1,2" });
    expect(f.mime).toContain("spreadsheetml");
  });

  it("writes a PDF with accents, pages and an xref", () => {
    const pdf = buildPdf("# Énergie\n\n" + "Coût 42 € — œuvre. ".repeat(600)).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toMatch(/\/Count [2-9]/);
    expect(pdf).toContain("\\200"); // € in WinAnsi
    expect(pdf).toContain("startxref");
  });

  it("zips several files, renaming duplicates", async () => {
    const f = createFile({ filename: "pack", format: "zip", files: [{ filename: "a.txt", content: "1" }, { filename: "a.txt", content: "2" }, { filename: "b.md", content: "# b" }] });
    expect(readZip(f.data).map((e) => e.name)).toEqual(["a.txt", "a-2.txt", "b.md"]);
  });

  it("keeps file names safe", () => {
    expect(createFile({ filename: "../../etc/passwd", format: "txt", content: "x" }).filename).toBe("etcpasswd.txt");
    expect(() => createFile({ filename: "a", format: "zip", files: [] })).toThrow();
  });
});

describe("extractFileText", () => {
  it("reads text formats and strips HTML", async () => {
    expect(await extractFileText("a.csv", "", Buffer.from("x,y\n1,2"))).toBe("x,y\n1,2");
    expect(await extractFileText("p.html", "text/html", Buffer.from("<p>Salut</p><script>x()</script>"))).toBe("Salut");
  });

  it("says why a file cannot be read", async () => {
    expect(await extractFileText("a.pdf", "application/pdf", buildPdf(""))).toContain("Mistral API key");
    expect(await extractFileText("old.doc", "", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).toContain(".docx");
    expect(await extractFileText("x.bin", "application/octet-stream", Buffer.from([0, 1, 2, 3, 0, 255]))).toContain("binary file");
    expect(await extractFileText("broken.docx", "", Buffer.from("nope"))).toContain("could not be read");
  });

  it("reads a PDF's own text without OCR", async () => {
    let ocr = 0;
    const text = await extractFileText("a.pdf", "", buildPdf("# Facture\n\nTotal à payer : 42,50 € pour le mois d'octobre."), { ocrPdf: async () => { ocr++; return ""; } });
    expect(text).toContain("--- page 1 ---\nFacture");
    expect(text).toContain("42,50 €");
    expect(ocr).toBe(0);
  });

  it("asks before sending a scan to OCR, and follows the answer", async () => {
    const scan = buildPdf("");
    const ocrPdf = async (url: string) => `ocr:${url.slice(0, 28)}`;
    const requests: { name: string; pages: number }[] = [];
    expect(await extractFileText("s.pdf", "", scan, { ocrPdf, ocrRequests: requests })).toContain("waiting for the user");
    expect(requests).toEqual([{ name: "s.pdf", pages: 1 }]);
    expect(await extractFileText("s.pdf", "", scan, { ocrPdf, ocr: "no" })).toContain("chose not to pay");
    expect(await extractFileText("s.pdf", "", scan, { ocrPdf, ocr: "yes" })).toBe("ocr:data:application/pdf;base64,");
  });

  it("reads the files inside an archive, without OCR", async () => {
    const zip = writeZip([
      { name: "notes.md", data: Buffer.from("# Notes") },
      { name: "doc.pdf", data: buildPdf("Contenu du PDF texte, lisible sans OCR.") },
      { name: "scan.pdf", data: buildPdf("") },
    ]);
    let ocr = 0;
    const requests: { name: string; pages: number }[] = [];
    const text = await extractFileText("a.zip", "application/zip", zip, { ocrPdf: async () => { ocr++; return ""; }, ocr: "yes", ocrRequests: requests });
    expect(text).toContain("--- notes.md ---\n# Notes");
    expect(text).toContain("Contenu du PDF texte");
    expect(text).toContain("--- scan.pdf ---\n[scanned PDF");
    expect(ocr).toBe(0);
    expect(requests).toEqual([]);
  });

  it("caps a long file", async () => {
    const text = await extractFileText("big.txt", "text/plain", Buffer.from("a".repeat(MAX_FILE_CHARS + 5)));
    expect(text).toContain("cut after");
  });
});

describe("shortenAttachedFiles", () => {
  it("keeps only the opening of an old attachment", () => {
    const long = "x".repeat(OLD_FILE_EXCERPT + 100);
    const out = shortenAttachedFiles(`Q\n\n<document name="a.pdf">\n${long}\n</document>`);
    expect(out.length).toBeLessThan(OLD_FILE_EXCERPT + 300);
    expect(out).toContain("attach the file again");
    expect(shortenAttachedFiles('<document name="s">\nshort\n</document>')).toBe('<document name="s">\nshort\n</document>');
  });
});
