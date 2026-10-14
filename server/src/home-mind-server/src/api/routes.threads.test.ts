import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createRouter } from "./routes.js";
import { SqliteConversationStore } from "../memory/conversation-sqlite.js";
import type { IChatEngine } from "../llm/interface.js";
import type { IMemoryStore } from "../memory/interface.js";

// The thread endpoints over HTTP against the real SQLite store, the way the
// embedded web UI calls them: create → list → messages → rename → delete
// (delete rides the existing conversation route).

async function startServer(store: SqliteConversationStore) {
  const app = express();
  app.use(express.json());
  const llm = {
    chat: async () => ({ response: "", toolsUsed: [], factsLearned: 0 }),
  } as unknown as IChatEngine;
  const memory = {} as unknown as IMemoryStore;
  app.use("/api", createRouter(llm, memory, "sqlite", "test", undefined, store));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}/api` };
}

describe("thread API", () => {
  let store: SqliteConversationStore;
  let server: ReturnType<typeof express> extends never ? never : { close: () => void };
  let base: string;

  beforeEach(async () => {
    store = new SqliteConversationStore(":memory:");
    const started = await startServer(store);
    server = started.server;
    base = started.base;
  });

  afterEach(() => {
    server.close();
    store.close();
  });

  it("creates a thread, lists it, reads its messages, renames and deletes it", async () => {
    const createRes = await fetch(`${base}/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { conversationId: string; title: string };
    expect(created.conversationId.startsWith("mado-thread:")).toBe(true);
    expect(created.title).toBe("");

    const threadUrl = `${base}/threads/default/${encodeURIComponent(created.conversationId)}`;

    const list = (await (await fetch(`${base}/threads/default`)).json()) as Array<{ conversationId: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].conversationId).toBe(created.conversationId);

    // What the chat engine stores on a turn in this thread:
    store.storeMessage(created.conversationId, "default", "user", "Bonjour, où en est le chauffage ?");
    store.storeMessage(created.conversationId, "default", "assistant", "Le salon est à 21 °C.");

    const listed = (await (await fetch(`${base}/threads/default`)).json()) as Array<{
      title: string; messageCount: number;
    }>;
    expect(listed[0].title).toBe("Bonjour, où en est le chauffage ?");
    expect(listed[0].messageCount).toBe(2);

    const history = (await (await fetch(`${threadUrl}/messages`)).json()) as {
      conversationId: string; messages: Array<{ role: string; content: string }>;
    };
    expect(history.conversationId).toBe(created.conversationId);
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0].role).toBe("user");
    expect(history.messages[1].content).toBe("Le salon est à 21 °C.");

    const patch = await fetch(threadUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Chauffage" }),
    });
    expect(patch.status).toBe(200);
    expect(((await (await fetch(`${base}/threads/default`)).json()) as Array<{ title: string }>)[0].title).toBe("Chauffage");

    const del = await fetch(
      `${base}/conversations/default/${encodeURIComponent(created.conversationId)}`,
      { method: "DELETE" }
    );
    expect(del.status).toBe(200);
    expect(await (await fetch(`${base}/threads/default`)).json()).toHaveLength(0);
  });

  it("rejects a rename without a title", async () => {
    const created = (await (
      await fetch(`${base}/threads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).json()) as { conversationId: string };

    const patch = await fetch(`${base}/threads/default/${encodeURIComponent(created.conversationId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(patch.status).toBe(400);
  });
});
