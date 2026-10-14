import { describe, it, expect, vi, afterEach } from "vitest";
import { parseConversationOutputs, withDocuments, documentBlock, listFromEnv, MAX_OCR_CHARS, ocrDocument } from "./mistral-platform.js";
import { handlePlatformTool } from "./platform-tools.js";
import { configureMediaStore, getMediaStore } from "./media-store.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("parseConversationOutputs", () => {
  it("reads text, files, code runs and references", () => {
    const result = parseConversationOutputs([
      { type: "tool.execution", name: "code_interpreter", info: { code: "print(2+2)", code_output: "4\n" } },
      {
        type: "message.output",
        content: [
          { type: "text", text: "The answer is 4. " },
          { type: "tool_file", tool: "code_interpreter", file_id: "f1", file_name: "plot.png", file_type: "png" },
          { type: "tool_reference", title: "Manual.pdf" },
          { type: "text", text: "Done." },
        ],
      },
    ]);
    expect(result.text).toBe("The answer is 4. Done.");
    expect(result.files).toEqual([{ fileId: "f1", fileName: "plot.png", fileType: "png" }]);
    expect(result.executions).toEqual([{ code: "print(2+2)", output: "4\n" }]);
    expect(result.references).toEqual(["Manual.pdf"]);
  });

  it("degrades to nothing on shapes it does not know", () => {
    expect(parseConversationOutputs(undefined)).toEqual({ text: "", files: [], executions: [], references: [] });
    expect(parseConversationOutputs([null, 3, { content: 5 }]).text).toBe("");
    expect(parseConversationOutputs([{ type: "message.output", content: "plain" }]).text).toBe("plain");
  });
});

describe("documents", () => {
  it("appends the OCR text of each PDF, marked for the panel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ pages: [{ markdown: "# Facture" }, { markdown: "Total 42 €" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await withDocuments("Résume", [{ name: "f.pdf", data: "data:application/pdf;base64,JVBERg==" }], "key");
    expect(out).toBe('Résume\n\n<document name="f.pdf">\n--- page 1 ---\n# Facture\n\n--- page 2 ---\nTotal 42 €\n</document>');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.mistral.ai/v1/ocr");
    expect(body.document).toEqual({ type: "document_url", document_url: "data:application/pdf;base64,JVBERg==" });
  });

  it("keeps the message going when OCR fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const out = await withDocuments("Q", [{ name: "x.pdf", data: "data:application/pdf;base64,AA" }], "key");
    expect(out).toContain("[file could not be read");
  });

  it("reads other files on the add-on, without calling Mistral", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await withDocuments("Q", [{ name: "notes.txt", data: `data:text/plain;base64,${Buffer.from("salut").toString("base64")}` }]);
    expect(out).toBe('Q\n\n<document name="notes.txt">\nsalut\n</document>');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cuts very long documents", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ pages: [{ markdown: "a".repeat(MAX_OCR_CHARS + 10) }] })));
    const text = await ocrDocument("key", "data:application/pdf;base64,AA");
    expect(text.length).toBeLessThan(MAX_OCR_CHARS + 200);
    expect(text).toContain("document cut");
  });

  it("cannot break out of the document marker through its name", () => {
    expect(documentBlock('a"><x>.pdf', "t")).toBe('<document name="ax.pdf">\nt\n</document>');
  });

  it("splits comma-separated settings", () => {
    expect(listFromEnv(" a, ,b ")).toEqual(["a", "b"]);
    expect(listFromEnv(undefined)).toEqual([]);
  });
});

describe("platform tools", () => {
  it("refuses without a Mistral key", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "");
    expect(await handlePlatformTool("run_code", { task: "x" })).toHaveProperty("error");
  });

  it("run_code keeps the chart it drew and hands back its link", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "k");
    configureMediaStore();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        outputs: [
          { type: "tool.execution", info: { code: "plot()", code_output: "" } },
          { type: "message.output", content: [{ type: "text", text: "Here." }, { type: "tool_file", file_id: "f9", file_name: "chart.png", file_type: "png" }] },
        ],
      }))
      .mockResolvedValueOnce(new Response(png, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const attachments: string[] = [];
    const result = (await handlePlatformTool("run_code", { task: "draw" }, attachments)) as { images: string[] };
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual([{ type: "code_interpreter" }]);
    expect(body.store).toBe(false);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.mistral.ai/v1/files/f9/content");
    expect(result.images).toHaveLength(1);
    expect(attachments).toEqual(result.images);
    const id = /api\/media\/([0-9a-f-]{36})/.exec(result.images[0])![1];
    expect(getMediaStore().get(id)).toMatchObject({ mime: "image/png", inline: true });
  });

  it("search_documents sends the configured libraries", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "k");
    vi.stubEnv("MISTRAL_LIBRARY_IDS", "lib-1,lib-2");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ outputs: [{ type: "message.output", content: "Reset: hold 10 s." }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handlePlatformTool("search_documents", { query: "reset" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tools).toEqual([{ type: "document_library", library_ids: ["lib-1", "lib-2"] }]);
    expect(result).toMatchObject({ answer: "Reset: hold 10 s." });
  });

  it("use_connector only reaches configured connectors", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "k");
    vi.stubEnv("MISTRAL_CONNECTORS", "gmail");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ outputs: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await handlePlatformTool("use_connector", { connector: "bank", request: "pay" })).toHaveProperty("error");
    expect(fetchMock).not.toHaveBeenCalled();
    await handlePlatformTool("use_connector", { connector: "gmail", request: "last mail" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tools).toEqual([{ type: "connector", connector_id: "gmail" }]);
  });
});
