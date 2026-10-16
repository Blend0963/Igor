import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import type { IMemoryStore } from "./interface.js";
import type { Fact, FactCategory } from "./types.js";
import type { IChatEngine } from "../llm/interface.js";
import { InMemoryConversationStore } from "./conversation-memory.js";
import { MERGE_READ_LIMIT, createEmptyBucketCheck, mergeMemoryInto } from "./shared-memory.js";
import { createRouter } from "../api/routes.js";

/** A memory store that keeps facts in a map, enough for getFacts/addFacts. */
function fakeMemory(initial: Record<string, string[]> = {}) {
  const buckets = new Map<string, Fact[]>();
  let next = 0;
  const add = (userId: string, content: string, category: FactCategory = "preference", confidence = 0.8) => {
    const id = `fact-${++next}`;
    const facts = buckets.get(userId) ?? [];
    facts.push({
      id,
      userId,
      content,
      category,
      confidence,
      createdAt: new Date(),
      lastUsed: new Date(),
      useCount: 0,
    });
    buckets.set(userId, facts);
    return id;
  };
  for (const [userId, contents] of Object.entries(initial)) {
    for (const content of contents) add(userId, content);
  }
  const store = {
    getFacts: vi.fn(async (userId: string) => [...(buckets.get(userId) ?? [])]),
    addFacts: vi.fn(
      async (userId: string, facts: { content: string; category: FactCategory; confidence?: number }[]) =>
        facts.map((f) => add(userId, f.content, f.category, f.confidence))
    ),
    deleteFact: vi.fn(),
    clearUserFacts: vi.fn(),
    getFactsWithinTokenLimit: vi.fn(),
    addFact: vi.fn(),
    factExists: vi.fn(),
    addFactIfNew: vi.fn(),
    getFactCount: vi.fn(),
    isHealthy: vi.fn(),
    close: vi.fn(),
  };
  const contents = (userId: string) => (buckets.get(userId) ?? []).map((f) => f.content);
  return { memory: store as unknown as IMemoryStore & typeof store, contents };
}

/** A conversation store that has seen the given users. */
function knownUsers(...userIds: string[]) {
  const conversations = new InMemoryConversationStore();
  for (const userId of userIds) conversations.storeMessage(`conv-${userId}`, userId, "user", "hi");
  return conversations;
}

describe("mergeMemoryInto (nives#65)", () => {
  let dir: string;
  let marker: string;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    dir = await mkdtemp(path.join(tmpdir(), "memory-merge-"));
    marker = path.join(dir, "memory-merges.json");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("copies other users' facts into the target and skips what it already has", async () => {
    const { memory, contents } = fakeMemory({
      default: ["User prefers 22°C at home"],
      "ha-user-1": ["user prefers 22 °C at home!", "User's name is Alex"],
    });
    const conversations = knownUsers("default", "ha-user-1");

    const result = await mergeMemoryInto("default", memory, conversations, marker);

    expect(result).toEqual({
      merged: 1,
      sources: [{ userId: "ha-user-1", copied: 1, duplicates: 1 }],
    });
    expect(contents("default")).toEqual(["User prefers 22°C at home", "User's name is Alex"]);
  });

  it("copies a fact two people both hold only once", async () => {
    const { memory, contents } = fakeMemory({
      "ha-user-1": ["The dog is called Luna"],
      "ha-user-2": ["the dog is called Luna."],
    });
    const conversations = knownUsers("default", "ha-user-1", "ha-user-2");

    const result = await mergeMemoryInto("default", memory, conversations, marker);

    expect(result).toEqual({
      merged: 1,
      sources: [
        { userId: "ha-user-1", copied: 1, duplicates: 0 },
        { userId: "ha-user-2", copied: 0, duplicates: 1 },
      ],
    });
    expect(contents("default")).toEqual(["The dog is called Luna"]);
  });

  it("keeps each fact's category and confidence", async () => {
    const { memory } = fakeMemory();
    (memory.getFacts as ReturnType<typeof vi.fn>).mockImplementation(async (userId: string) =>
      userId === "ha-user-1"
        ? [{ id: "x", userId, content: "Kitchen light is light.wled_kitchen", category: "device", confidence: 0.95, createdAt: new Date(), lastUsed: new Date(), useCount: 3 }]
        : []
    );

    await mergeMemoryInto("default", memory, knownUsers("ha-user-1"), marker);

    expect(memory.addFacts).toHaveBeenCalledWith("default", [
      { content: "Kitchen light is light.wled_kitchen", category: "device", confidence: 0.95 },
    ]);
  });

  it("leaves the source memories untouched", async () => {
    const { memory, contents } = fakeMemory({
      "ha-user-1": ["User prefers 72 degrees", "User wakes at 6:30"],
    });

    await mergeMemoryInto("default", memory, knownUsers("default", "ha-user-1"), marker);

    expect(contents("ha-user-1")).toEqual(["User prefers 72 degrees", "User wakes at 6:30"]);
    expect(memory.addFacts).not.toHaveBeenCalledWith("ha-user-1", expect.anything());
    expect(memory.deleteFact).not.toHaveBeenCalled();
    expect(memory.clearUserFacts).not.toHaveBeenCalled();
  });

  it("runs once per target: a second call is skipped via the marker", async () => {
    const { memory, contents } = fakeMemory({ "ha-user-1": ["User prefers 72 degrees"] });
    const conversations = knownUsers("default", "ha-user-1");

    await mergeMemoryInto("default", memory, conversations, marker);
    const second = await mergeMemoryInto("default", memory, conversations, marker);

    expect(second).toEqual({ merged: 0, skipped: true });
    expect(memory.addFacts).toHaveBeenCalledTimes(1);
    expect(contents("default")).toEqual(["User prefers 72 degrees"]);
    const recorded = JSON.parse(await readFile(marker, "utf-8"));
    expect(recorded.default).toMatchObject({ merged: 1 });
  });

  it("records each target separately, so a new shared memory name still gets its merge", async () => {
    const { memory, contents } = fakeMemory({ default: ["User prefers 72 degrees"] });
    const conversations = knownUsers("default", "family");

    await mergeMemoryInto("default", memory, conversations, marker);
    const renamed = await mergeMemoryInto("family", memory, conversations, marker);

    expect(renamed).toEqual({
      merged: 1,
      sources: [{ userId: "default", copied: 1, duplicates: 0 }],
    });
    expect(contents("family")).toEqual(["User prefers 72 degrees"]);
  });

  it("without a marker, a repeat call copies nothing thanks to the duplicate check", async () => {
    const { memory, contents } = fakeMemory({ "ha-user-1": ["User prefers 72 degrees"] });
    const conversations = knownUsers("default", "ha-user-1");

    await mergeMemoryInto("default", memory, conversations);
    const second = await mergeMemoryInto("default", memory, conversations);

    expect(second).toEqual({
      merged: 0,
      sources: [{ userId: "ha-user-1", copied: 0, duplicates: 1 }],
    });
    expect(contents("default")).toEqual(["User prefers 72 degrees"]);
  });

  it("does not record a merge that failed, so the next call tries again", async () => {
    const { memory, contents } = fakeMemory({ "ha-user-1": ["User prefers 72 degrees"] });
    const conversations = knownUsers("default", "ha-user-1");
    memory.addFacts.mockRejectedValueOnce(new Error("Shodh API error 503"));

    await expect(mergeMemoryInto("default", memory, conversations, marker)).rejects.toThrow("503");
    const retry = await mergeMemoryInto("default", memory, conversations, marker);

    expect(retry).toMatchObject({ merged: 1 });
    expect(contents("default")).toEqual(["User prefers 72 degrees"]);
  });

  it("two simultaneous calls for the same target copy once", async () => {
    const { memory, contents } = fakeMemory({ "ha-user-1": ["User prefers 72 degrees"] });
    const conversations = knownUsers("default", "ha-user-1");

    const [a, b] = await Promise.all([
      mergeMemoryInto("default", memory, conversations),
      mergeMemoryInto("default", memory, conversations),
    ]);

    expect(a).toEqual(b);
    expect(contents("default")).toEqual(["User prefers 72 degrees"]);
  });

  it("treats an unreadable marker as never merged", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeFile(marker, "not json");
    const { memory, contents } = fakeMemory({ "ha-user-1": ["User prefers 72 degrees"] });

    const result = await mergeMemoryInto("default", memory, knownUsers("ha-user-1"), marker);

    expect(result).toMatchObject({ merged: 1 });
    expect(contents("default")).toEqual(["User prefers 72 degrees"]);
  });

  it("logs the plan before writing anything", async () => {
    const order: string[] = [];
    const { memory } = fakeMemory({ "ha-user-1": ["User prefers 72 degrees"] });
    (console.log as ReturnType<typeof vi.fn>).mockImplementation((line: string) => order.push(line));
    memory.addFacts.mockImplementationOnce(async () => {
      order.push("write");
      return ["id"];
    });

    await mergeMemoryInto("default", memory, knownUsers("ha-user-1"), marker);

    expect(order[0]).toContain('Would merge 1 facts from bucket "ha-user-1" into "default"');
    expect(order[1]).toBe("write");
    expect(order[2]).toContain('Merged 1 facts into "default"');
  });
});

describe("createEmptyBucketCheck (nives#65)", () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says so when the request's memory is empty and another holds facts", async () => {
    const { memory } = fakeMemory({ "ha-user-1": ["User prefers 72 degrees", "User wakes at 6:30"] });
    const check = createEmptyBucketCheck(memory, knownUsers("default", "ha-user-1"));

    await check("default");

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('Memory bucket "default" is empty');
    expect(line).toContain('"ha-user-1" (2)');
    expect(line).toContain("Shared memory");
  });

  it("stays quiet when the request's memory has facts", async () => {
    const { memory } = fakeMemory({ default: ["x"], "ha-user-1": ["y"] });
    await createEmptyBucketCheck(memory, knownUsers("default", "ha-user-1"))("default");
    expect(log).not.toHaveBeenCalled();
  });

  it("stays quiet on a fresh install where no memory has facts yet", async () => {
    const { memory } = fakeMemory();
    await createEmptyBucketCheck(memory, knownUsers("default", "ha-user-1"))("default");
    expect(log).not.toHaveBeenCalled();
  });

  it("looks at each user id once per process", async () => {
    const { memory } = fakeMemory({ "ha-user-1": ["y"] });
    const check = createEmptyBucketCheck(memory, knownUsers("default", "ha-user-1"));

    await check("default");
    await check("default");
    await check("default");

    expect(log).toHaveBeenCalledTimes(1);
    expect(memory.getFacts).toHaveBeenCalledTimes(2); // own bucket + the one other
  });

  it("reads whole buckets, not the 100 facts a prompt sees", async () => {
    // A heavy bucket must be copied in full; the prompt's cap is not a copy cap.
    const { memory } = fakeMemory({ "ha-user-1": ["a"] });
    await mergeMemoryInto("default", memory, knownUsers("default", "ha-user-1"));
    const calls = (memory.getFacts as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call[1]).toBe(MERGE_READ_LIMIT);
    expect(MERGE_READ_LIMIT).toBeGreaterThanOrEqual(1000);
  });

  it("swallows errors and logs them at debug", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { memory } = fakeMemory();
    memory.getFacts.mockRejectedValueOnce(new Error("Shodh down"));

    await expect(createEmptyBucketCheck(memory, knownUsers("default"))("default")).resolves.toBeUndefined();

    expect(debug).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("POST /api/memory/:userId/merge", () => {
  async function post(router: express.Router, url: string) {
    const app = express();
    app.use("/api", router);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}${url}`, { method: "POST" });
      return { status: res.status, body: await res.json() };
    } finally {
      server.close();
    }
  }

  const llm = {} as IChatEngine;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges into the named user and returns what it copied", async () => {
    const { memory, contents } = fakeMemory({ "ha-user-1": ["User prefers 72 degrees"] });
    const router = createRouter(llm, memory, "shodh", "0.0.0", undefined, knownUsers("my house", "ha-user-1"));

    const res = await post(router, "/api/memory/my%20house/merge");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      merged: 1,
      sources: [{ userId: "ha-user-1", copied: 1, duplicates: 0 }],
    });
    expect(contents("my house")).toEqual(["User prefers 72 degrees"]);
  });

  it("answers 501 without a conversation store to find users in", async () => {
    const { memory } = fakeMemory();
    const res = await post(createRouter(llm, memory), "/api/memory/default/merge");
    expect(res.status).toBe(501);
  });
});
