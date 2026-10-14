import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryConversationStore } from "./conversation-memory.js";

describe("InMemoryConversationStore", () => {
  let store: InMemoryConversationStore;

  beforeEach(() => {
    store = new InMemoryConversationStore();
  });

  it("stores and retrieves messages", () => {
    store.storeMessage("conv-1", "user-1", "user", "Hello");
    store.storeMessage("conv-1", "user-1", "assistant", "Hi there!");

    const history = store.getConversationHistory("conv-1");

    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("Hello");
    expect(history[1].content).toBe("Hi there!");
  });

  it("deletes only the named user's messages when a userId is given", () => {
    store.storeMessage("mado-thread:x", "user-1", "user", "mine");
    store.storeMessage("mado-thread:x", "user-2", "user", "theirs");

    expect(store.deleteConversation("mado-thread:x", "user-1")).toBe(1);
    const left = store.getConversationHistory("mado-thread:x");
    expect(left.map((m) => m.content)).toEqual(["theirs"]);
    expect(store.deleteConversation("mado-thread:x", "user-1")).toBe(0);
  });

  it("scopes semantic recall to one thread, or keeps it out of every thread", () => {
    const a = store.storeMessage("mado-thread:a", "user-1", "user", "secret of thread a");
    const b = store.storeMessage("mado-thread:b", "user-1", "user", "secret of thread b");
    const assist = store.storeMessage("mado-user:user-1", "user-1", "user", "assist note");
    for (const id of [a, b, assist]) store.storeMessageEmbedding(id, [1, 0]);

    const inA = store.searchSimilarMessages("user-1", [1, 0], 10, { conversationId: "mado-thread:a" });
    expect(inA.map((m) => m.content)).toEqual(["secret of thread a"]);

    const inAssist = store.searchSimilarMessages("user-1", [1, 0], 10, {
      excludeConversationPrefix: "mado-thread:",
    });
    expect(inAssist.map((m) => m.content)).toEqual(["assist note"]);

    store.storeMessage("mado-thread:c", "user-1", "user", "unembedded");
    expect(
      store
        .getMessagesWithoutEmbeddings("user-1", 30, { excludeConversationPrefix: "mado-thread:" })
        .map((m) => m.content)
    ).toEqual([]);
  });

  it("keeps far more than 20 messages in a thread", () => {
    for (let i = 0; i < 60; i++) store.storeMessage("mado-thread:long", "user-1", "user", `m${i}`);
    for (let i = 0; i < 60; i++) store.storeMessage("other", "user-1", "user", `m${i}`);
    expect(store.getConversationHistory("mado-thread:long", 1000)).toHaveLength(60);
    expect(store.getConversationHistory("other", 1000)).toHaveLength(20);
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

  it("cleans up old conversations", () => {
    // Store a message, then manually backdate it
    store.storeMessage("conv-1", "user-1", "user", "Old message");

    // Access the internal state to backdate (for testing only)
    const history = store.getConversationHistory("conv-1");
    history[0].createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago

    const deleted = store.cleanupOldConversations(24);
    expect(deleted).toBe(1);

    const after = store.getConversationHistory("conv-1");
    expect(after).toHaveLength(0);
  });

  it("lists conversations with the first user message as title", () => {
    store.storeMessage("mado-thread:1", "user-1", "user", "First question");
    store.storeMessage("mado-thread:1", "user-1", "assistant", "First answer");
    store.storeMessage("mado-thread:1", "user-1", "user", "Follow-up question");

    const [summary] = store.listConversations("user-1");
    expect(summary.conversationId).toBe("mado-thread:1");
    expect(summary.title).toBe("First question");
    expect(summary.lastMessage).toBe("Follow-up question");
  });

  it("keeps web threads idle for over 24h, as they are user-visible in the panel", () => {
    store.storeMessage("mado-thread:old", "user-1", "user", "Old thread message");
    const history = store.getConversationHistory("mado-thread:old");
    history[0].createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

    expect(store.cleanupOldConversations(24)).toBe(0);
    expect(store.getConversationHistory("mado-thread:old")).toHaveLength(1);
  });

  it("clears all data on close", () => {
    store.storeMessage("conv-1", "user-1", "user", "Hello");
    store.close();

    const history = store.getConversationHistory("conv-1");
    expect(history).toHaveLength(0);
  });
});
