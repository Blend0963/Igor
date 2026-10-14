import { describe, it, expect, vi, afterEach } from "vitest";
import { WorkspaceStore } from "./workspace-store.js";
import { estimateCost, priceOf } from "../llm/prices.js";

afterEach(() => vi.unstubAllEnvs());

describe("prices", () => {
  it("prices by model prefix, cached input at 10%", () => {
    expect(priceOf("mistral-large-2512")).toEqual([0.5, 1.5]);
    expect(priceOf("ministral-8b-latest")).toEqual([0.15, 0.15]);
    expect(priceOf("my-local-model")).toBeUndefined();
    expect(estimateCost({ model: "mistral-large-latest", calls: 1, promptTokens: 1_000_000, cachedTokens: 500_000, completionTokens: 100_000 })).toBeCloseTo(0.25 + 0.025 + 0.15);
  });

  it("takes overrides from MODEL_PRICES", () => {
    vi.stubEnv("MODEL_PRICES", '{"my-local": [0, 0], "mistral-large": [1, 2]}');
    expect(priceOf("my-local-model")).toEqual([0, 0]);
    expect(priceOf("mistral-large-latest")).toEqual([1, 2]);
  });
});

describe("WorkspaceStore", () => {
  it("keeps projects per user and forgets a thread's project with it", () => {
    const store = new WorkspaceStore();
    const p = store.createProject("u", "Jardin", "Réponds en jardinier.");
    store.setConversationProject("u", "mado-thread:a", p.id);
    expect(store.projectOf("u", "mado-thread:a")?.instructions).toBe("Réponds en jardinier.");
    expect(store.projectOf("v", "mado-thread:a")).toBeUndefined();
    expect(() => store.setConversationProject("v", "mado-thread:a", p.id)).toThrow();
    store.updateProject("u", p.id, { instructions: "Bref." });
    expect(store.projectOf("u", "mado-thread:a")?.instructions).toBe("Bref.");
    store.deleteProject("u", p.id);
    expect(store.conversationProjects("u").size).toBe(0);
  });

  it("sums usage per day, thread and model", () => {
    const store = new WorkspaceStore();
    const now = new Date("2026-10-14T12:00:00Z");
    store.recordUsage("u", "mado-thread:a", { model: "mistral-large-latest", calls: 2, promptTokens: 20000, cachedTokens: 10000, completionTokens: 500 }, now);
    store.recordUsage("u", "assist", { model: "my-local", calls: 1, promptTokens: 100, cachedTokens: 0, completionTokens: 10 }, now);
    const [day] = store.usageByDay("u", 30, now);
    expect(day).toMatchObject({ day: "2026-10-14", calls: 3, unpriced: 1 });
    expect(day.cost).toBeCloseTo((10000 * 0.5 + 10000 * 0.05 + 500 * 1.5) / 1e6);
    expect(store.usageByConversation("u", 30, now)[0].conversationId).toBe("mado-thread:a");
    expect(store.usageByModel("u", 30, now).map((m) => m.model)).toEqual(["mistral-large-latest", "my-local"]);
  });
});
