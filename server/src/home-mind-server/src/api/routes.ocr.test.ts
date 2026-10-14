import { describe, it, expect, vi, afterEach } from "vitest";
import { ChatRequestSchema, withAttachedDocuments } from "./routes.js";
import { buildPdf } from "../files/create.js";

const pdf = (md: string) => `data:application/pdf;base64,${buildPdf(md).toString("base64")}`;
const parse = (body: unknown) => ChatRequestSchema.parse(body);

afterEach(() => vi.unstubAllEnvs());

describe("withAttachedDocuments: OCR only with the user's agreement", () => {
  it("reads a PDF with text for free, without asking", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "k");
    const { request, confirm } = await withAttachedDocuments(parse({ message: "Résume", documents: [{ name: "f.pdf", data: pdf("Facture du mois, total 42 euros à payer.") }] }));
    expect(confirm).toBeUndefined();
    expect(request.message).toContain("Facture du mois");
  });

  it("returns the page count and an estimated price for a scan", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "k");
    vi.stubEnv("OCR_PRICE_PER_1000_PAGES", "4");
    const { confirm, request } = await withAttachedDocuments(parse({ message: "Lis", documents: [{ name: "scan.pdf", data: pdf("") }] }));
    expect(confirm).toEqual({ files: [{ name: "scan.pdf", pages: 1, cost: 0.004 }], pages: 1, cost: 0.004, pricePer1000Pages: 4 });
    expect(request.message).toBe("Lis");
  });

  it("goes on without the scan when the user says no", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "k");
    const { confirm, request } = await withAttachedDocuments(parse({ message: "Lis", ocr: "no", documents: [{ name: "scan.pdf", data: pdf("") }] }));
    expect(confirm).toBeUndefined();
    expect(request.message).toContain("chose not to pay");
  });

  it("never asks when no Mistral key could pay for it", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "");
    const { confirm, request } = await withAttachedDocuments(parse({ message: "Lis", documents: [{ name: "scan.pdf", data: pdf("") }] }));
    expect(confirm).toBeUndefined();
    expect(request.message).toContain("needs a Mistral API key");
  });
});
