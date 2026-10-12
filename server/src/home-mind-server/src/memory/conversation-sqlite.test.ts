import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteConversationStore } from "./conversation-sqlite.js";

describe("SqliteConversationStore", () => {
  let store: SqliteConversationStore;

  beforeEach(() => {
    // Use in-memory SQLite for tests
    store = new SqliteConversationStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("stores and retrieves messages", () => {
    store.storeMessage("conv-1", "user-1", "user", "Hello");
    store.storeMessage("conv-1", "user-1", "assistant", "Hi there!");

    const history = store.getConversationHistory("conv-1");

    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("Hello");
    expect(history[0].role).toBe("user");
    expect(history[1].content).toBe("Hi there!");
    expect(history[1].role).toBe("assistant");
  });

  it("limits history to last N messages", () => {
    for (let i = 0; i < 5; i++) {
      store.storeMessage("conv-1", "user-1", "user", `Message ${i}`);
    }

    const history = store.getConversationHistory("conv-1", 3);

    expect(history).toHaveLength(3);
    expect(history[0].content).toBe("Message 2");
    expect(history[2].content).toBe("Message 4");
  });

  it("keeps only last 20 messages per conversation", () => {
    for (let i = 0; i < 25; i++) {
      store.storeMessage("conv-1", "user-1", "user", `Message ${i}`);
    }

    const history = store.getConversationHistory("conv-1", 100);

    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("Message 5");
    expect(history[19].content).toBe("Message 24");
  });

  it("returns empty array for unknown conversation", () => {
    const history = store.getConversationHistory("nonexistent");
    expect(history).toEqual([]);
  });

  it("tracks known users", () => {
    store.storeMessage("conv-1", "user-1", "user", "Hello");
    store.storeMessage("conv-2", "user-2", "user", "Hi");

    const users = store.getKnownUsers();
    expect(users).toContain("user-1");
    expect(users).toContain("user-2");
  });

  it("still knows a user after their messages are pruned", () => {
    // Regression: known users used to be SELECT DISTINCT user_id FROM messages,
    // so a user who hadn't chatted in 24h vanished from the list the moment
    // cleanupOldConversations() ran — which silently disabled the fact-cleanup
    // job for everyone (observed live: "[cleanup] No known users" on every run).
    const db = (store as unknown as { db: import("better-sqlite3").Database }).db;
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    store.storeMessage("conv-old", "user-1", "user", "Hello");
    db.prepare(`UPDATE messages SET created_at = ? WHERE conversation_id = ?`).run(
      oldDate,
      "conv-old"
    );

    store.cleanupOldConversations(24);

    expect(store.getConversationHistory("conv-old")).toHaveLength(0);
    expect(store.getKnownUsers()).toContain("user-1");
  });

  it("cleans up old conversations", () => {
    // Insert a message with a backdated timestamp directly
    const db = (store as unknown as { db: import("better-sqlite3").Database }).db;
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO messages (id, conversation_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("old-id", "conv-old", "user-1", "user", "Old message", oldDate);

    // Store a recent message in a different conversation
    store.storeMessage("conv-new", "user-1", "user", "New message");

    const deleted = store.cleanupOldConversations(24);
    expect(deleted).toBe(1);

    // Old conversation gone, new one remains
    expect(store.getConversationHistory("conv-old")).toHaveLength(0);
    expect(store.getConversationHistory("conv-new")).toHaveLength(1);
  });

  it("retrieves recent messages across conversations for one user", () => {
    store.storeMessage("conv-1", "user-1", "user", "Earlier question");
    store.storeMessage("conv-1", "user-1", "assistant", "Earlier answer");
    store.storeMessage("conv-2", "user-1", "user", "Current topic");
    store.storeMessage("conv-3", "user-2", "user", "Other user's private message");

    const recent = store.getRecentMessages("user-1", 24, 12, "conv-2");
    expect(recent.map((m) => m.content)).toEqual(["Earlier question", "Earlier answer"]);
    expect(recent.every((m) => m.conversationId !== "conv-2")).toBe(true);
    expect(recent.some((m) => m.content.includes("private"))).toBe(false);
  });

  it("returns messages with createdAt as Date objects", () => {
    store.storeMessage("conv-1", "user-1", "user", "Hello");

    const history = store.getConversationHistory("conv-1");
    expect(history[0].createdAt).toBeInstanceOf(Date);
  });

  it("returns message id from storeMessage", () => {
    const id = store.storeMessage("conv-1", "user-1", "user", "Hello");
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("isolates conversations by id", () => {
    store.storeMessage("conv-1", "user-1", "user", "Message A");
    store.storeMessage("conv-2", "user-1", "user", "Message B");

    expect(store.getConversationHistory("conv-1")).toHaveLength(1);
    expect(store.getConversationHistory("conv-2")).toHaveLength(1);
    expect(store.getConversationHistory("conv-1")[0].content).toBe("Message A");
  });

  it("retrieves semantically similar messages only for the same user", () => {
    const relevantId = store.storeMessage("mado-user:user-1", "user-1", "user", "We discussed insulating the attic");
    store.storeMessageEmbedding(relevantId, [1, 0, 0]);
    const unrelatedId = store.storeMessage("mado-user:user-2", "user-2", "user", "Private solar panel plans");
    store.storeMessageEmbedding(unrelatedId, [1, 0, 0]);
    const weakId = store.storeMessage("mado-user:user-1", "user-1", "user", "Favorite music");
    store.storeMessageEmbedding(weakId, [0, 1, 0]);

    const results = store.searchSimilarMessages("user-1", [0.99, 0.01, 0], 5);
    expect(results.map((message) => message.id)).toEqual([relevantId]);
    expect(results.some((message) => message.userId === "user-2")).toBe(false);
  });
});
