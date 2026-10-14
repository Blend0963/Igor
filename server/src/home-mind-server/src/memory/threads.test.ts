import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteConversationStore } from "./conversation-sqlite.js";
import { InMemoryConversationStore } from "./conversation-memory.js";
import { THREAD_PREFIX } from "./types.js";

// Web-UI discussion threads. A thread is an ordinary conversation with a
// sidebar life of its own: created before its first message, titled from
// that message (until renamed), durable across the 24h cleanup, and with
// semantic recall that can be scoped to the thread alone.

describe("threads in the SQLite store", () => {
  let store: SqliteConversationStore;

  beforeEach(() => {
    store = new SqliteConversationStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("creates a thread and lists it before its first message", () => {
    const thread = store.createThread("user-1");
    expect(thread.conversationId.startsWith(THREAD_PREFIX)).toBe(true);

    const listed = store.listThreads("user-1");
    expect(listed).toHaveLength(1);
    expect(listed[0].conversationId).toBe(thread.conversationId);
    expect(listed[0].title).toBe("");
    expect(listed[0].messageCount).toBe(0);
  });

  it("keeps threads of different users apart", () => {
    store.createThread("user-1");
    store.createThread("user-2");
    expect(store.listThreads("user-1")).toHaveLength(1);
    expect(store.listThreads("user-2")).toHaveLength(1);
  });

  it("titles a thread from its first user message and keeps a rename sticky", () => {
    const thread = store.createThread("user-1");
    store.storeMessage(thread.conversationId, "user-1", "user", "Où en est le chauffage ?");
    expect(store.listThreads("user-1")[0].title).toBe("Où en est le chauffage ?");

    expect(store.renameThread(thread.conversationId, "Chauffage")).toBe(true);
    store.storeMessage(thread.conversationId, "user-1", "user", "Autre message plus tard");
    expect(store.listThreads("user-1")[0].title).toBe("Chauffage");
    expect(store.renameThread(thread.conversationId, "   ")).toBe(false);
  });

  it("is durable: no 20-message cap, and it survives the 24h cleanup", () => {
    const thread = store.createThread("user-1");
    for (let i = 0; i < 25; i++) {
      store.storeMessage(thread.conversationId, "user-1", "user", `Message ${i}`);
    }
    expect(store.getConversationHistory(thread.conversationId, 100)).toHaveLength(25);

    // Backdate every thread message past the cleanup window, and compare
    // with a transient conversation that must disappear.
    const db = (store as unknown as { db: import("better-sqlite3").Database }).db;
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare(`UPDATE messages SET created_at = ? WHERE conversation_id = ?`).run(
      oldDate,
      thread.conversationId
    );
    db.prepare(
      `INSERT INTO messages (id, conversation_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("old-id", "conv-transient", "user-1", "user", "Old message", oldDate);

    store.cleanupOldConversations(24);
    expect(store.getConversationHistory(thread.conversationId, 100)).toHaveLength(25);
    expect(store.getConversationHistory("conv-transient")).toHaveLength(0);
    expect(store.listThreads("user-1")).toHaveLength(1);
  });

  it("deleteConversation also drops the thread row", () => {
    const thread = store.createThread("user-1");
    store.storeMessage(thread.conversationId, "user-1", "user", "Hello");

    const deleted = store.deleteConversation(thread.conversationId);
    expect(deleted).toBe(1);
    expect(store.listThreads("user-1")).toHaveLength(0);
    expect(store.getConversationHistory(thread.conversationId)).toHaveLength(0);
  });

  it("scopes semantic search to one thread when a conversationId is given", () => {
    const a = store.createThread("user-1");
    const b = store.createThread("user-1");
    const idA = store.storeMessage(a.conversationId, "user-1", "user", "isolation du grenier");
    const idB = store.storeMessage(b.conversationId, "user-1", "user", "isolation du grenier");
    store.storeMessageEmbedding(idA, [1, 0, 0]);
    store.storeMessageEmbedding(idB, [1, 0, 0]);

    expect(store.searchSimilarMessages("user-1", [0.99, 0.01, 0], 5)).toHaveLength(2);
    const scoped = store.searchSimilarMessages("user-1", [0.99, 0.01, 0], 5, a.conversationId);
    expect(scoped.map((m) => m.id)).toEqual([idA]);
  });
});

describe("threads in the in-memory store", () => {
  let store: InMemoryConversationStore;

  beforeEach(() => {
    store = new InMemoryConversationStore();
  });

  afterEach(() => {
    store.close();
  });

  it("creates, lists, renames and deletes threads", () => {
    const thread = store.createThread("user-1");
    expect(store.listThreads("user-1")).toHaveLength(1);

    store.storeMessage(thread.conversationId, "user-1", "user", "Premier message");
    const listed = store.listThreads("user-1");
    expect(listed[0].title).toBe("Premier message");
    expect(listed[0].messageCount).toBe(1);

    expect(store.renameThread(thread.conversationId, "Renommé")).toBe(true);
    expect(store.listThreads("user-1")[0].title).toBe("Renommé");

    store.deleteConversation(thread.conversationId);
    expect(store.listThreads("user-1")).toHaveLength(0);
  });

  it("does not clean up old threads", () => {
    const thread = store.createThread("user-1");
    store.storeMessage(thread.conversationId, "user-1", "user", "Hello");
    // Backdate the stored message object past the cleanup window.
    const history = store.getConversationHistory(thread.conversationId);
    history[0].createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

    store.cleanupOldConversations(24);
    expect(store.getConversationHistory(thread.conversationId)).toHaveLength(1);
  });

  it("scopes semantic search to one thread", () => {
    const a = store.createThread("user-1");
    const b = store.createThread("user-1");
    const idA = store.storeMessage(a.conversationId, "user-1", "user", "projets solaires");
    const idB = store.storeMessage(b.conversationId, "user-1", "user", "projets solaires");
    store.storeMessageEmbedding(idA, [1, 0, 0]);
    store.storeMessageEmbedding(idB, [1, 0, 0]);

    expect(store.searchSimilarMessages("user-1", [0.99, 0.01, 0])).toHaveLength(2);
    expect(
      store.searchSimilarMessages("user-1", [0.99, 0.01, 0], 5, a.conversationId).map((m) => m.id)
    ).toEqual([idA]);
  });
});
