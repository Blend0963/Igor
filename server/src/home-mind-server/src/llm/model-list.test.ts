import { describe, it, expect, vi, afterEach } from "vitest";
import { createModelLister } from "./model-list.js";
import type { Config } from "../config.js";

afterEach(() => vi.unstubAllGlobals());

describe("createModelLister", () => {
  it("lists Mistral chat models with tools, latest aliases first, configured ones marked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "mistral-large-2512", aliases: ["mistral-large-latest"], capabilities: { completion_chat: true, function_calling: true, vision: true } },
        { id: "mistral-large-latest", aliases: ["mistral-large-2512"], capabilities: { completion_chat: true, function_calling: true, vision: true } },
        { id: "mistral-embed", capabilities: { completion_chat: false } },
        { id: "open-old", capabilities: { completion_chat: true, function_calling: true }, deprecation: "2026-01-01" },
        { id: "ministral-8b-latest", capabilities: { completion_chat: true, function_calling: true } },
      ],
    }))));
    const list = createModelLister({ llmModel: "mistral-large-latest", fastModel: "ministral-8b-latest", openaiBaseUrl: "https://api.mistral.ai/v1" } as Config, "k");
    const out = await list();
    expect(out.models.map((m) => m.id)).toEqual(["ministral-8b-latest", "mistral-large-latest"]);
    expect(out.models.find((m) => m.id === "mistral-large-latest")).toMatchObject({ role: "main", vision: true });
    expect(out).toMatchObject({ main: "mistral-large-latest", fast: "ministral-8b-latest" });
  });

  it("falls back to the configured models elsewhere", async () => {
    const out = await createModelLister({ llmModel: "gpt-4o-mini" } as Config)();
    expect(out.models).toEqual([{ id: "gpt-4o-mini", role: "main" }]);
  });
});
