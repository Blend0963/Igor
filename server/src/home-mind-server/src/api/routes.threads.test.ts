import { describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createRouter } from "./routes.js";
import type { IChatEngine } from "../llm/interface.js";
import type { IMemoryStore } from "../memory/interface.js";
import { InMemoryConversationStore } from "../memory/conversation-memory.js";

/** One request against a throwaway server running the real router. */
async function call(router: express.Router, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as { messages?: unknown[]; title?: string } };
  } finally {
    server.close();
  }
}

describe("panel threads in the conversation routes", () => {
  const setup = () => {
    const conversations = new InMemoryConversationStore();
    const memory = { clearUserFacts: vi.fn().mockResolvedValue(3) } as unknown as IMemoryStore;
    const router = createRouter({} as IChatEngine, memory, "shodh", "0", undefined, conversations);
    return { conversations, memory, router };
  };

  it("deleting a thread also forgets that thread's own long-term memory", async () => {
    const { conversations, memory, router } = setup();
    conversations.storeMessage("mado-thread:t1", "default", "user", "hi");

    const res = await call(router, "DELETE", "/api/conversations/default/mado-thread%3At1");

    expect(res.status).toBe(200);
    expect(memory.clearUserFacts).toHaveBeenCalledWith("default@mado-thread.t1");
    expect(memory.clearUserFacts).not.toHaveBeenCalledWith("default");
  });

  it("deleting an Assist conversation never touches the shared memory", async () => {
    const { conversations, memory, router } = setup();
    conversations.storeMessage("mado-user:default", "default", "user", "hi");

    await call(router, "DELETE", "/api/conversations/default/mado-user%3Adefault");

    expect(memory.clearUserFacts).not.toHaveBeenCalled();
  });

  it("shows a thread beyond the 20 most recent messages", async () => {
    const { conversations, router } = setup();
    for (let i = 0; i < 30; i++) conversations.storeMessage("mado-thread:t1", "default", "user", `m${i}`);

    const res = await call(router, "GET", "/api/conversations/default/mado-thread%3At1");

    expect(res.body.messages).toHaveLength(30);
  });

  it("renames a thread, and the new name survives in the list", async () => {
    const { conversations, router } = setup();
    conversations.storeMessage("mado-thread:t1", "default", "user", "first question");

    const res = await call(router, "PATCH", "/api/conversations/default/mado-thread%3At1", {
      title: "  Plantes   du salon ",
    });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Plantes du salon");
    expect(conversations.listConversations("default")[0].title).toBe("Plantes du salon");
  });

  it("refuses to name someone else's thread, or with an empty title", async () => {
    const { conversations, router } = setup();
    conversations.storeMessage("mado-thread:t1", "alice", "user", "hi");

    expect((await call(router, "PATCH", "/api/conversations/bob/mado-thread%3At1", { title: "x" })).status).toBe(404);
    expect((await call(router, "PATCH", "/api/conversations/alice/mado-thread%3At1", { title: "   " })).status).toBe(400);
  });
});
