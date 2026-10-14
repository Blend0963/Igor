import { describe, it, expect } from "vitest";
import { inRecallScope, resolveMemoryScope, threadFactBucket } from "./memory-scope.js";

describe("resolveMemoryScope", () => {
  it("seals a panel thread off: own conversation, own facts, recall inside it only", () => {
    const scope = resolveMemoryScope("alice", "mado-thread:t1");
    expect(scope).toEqual({
      conversationId: "mado-thread:t1",
      factBucket: threadFactBucket("alice", "mado-thread:t1"),
      recall: { conversationId: "mado-thread:t1" },
      isThread: true,
    });
    expect(scope.factBucket).not.toBe("alice");
  });

  it("puts every Assist device on the one shared conversation, with threads out of recall", () => {
    for (const conversationId of [undefined, "01HXYZ", "phone-chat-log"]) {
      expect(resolveMemoryScope("alice", conversationId)).toEqual({
        conversationId: "mado-user:alice",
        factBucket: "alice",
        recall: { excludeConversationPrefix: "mado-thread:" },
        isThread: false,
      });
    }
  });

  it("gives two threads of the same user two different buckets", () => {
    expect(threadFactBucket("alice", "mado-thread:a")).not.toBe(
      threadFactBucket("alice", "mado-thread:b")
    );
  });
});

describe("inRecallScope", () => {
  it("keeps a thread's recall inside the thread", () => {
    const scope = resolveMemoryScope("alice", "mado-thread:t1").recall;
    expect(inRecallScope("mado-thread:t1", scope)).toBe(true);
    expect(inRecallScope("mado-thread:t2", scope)).toBe(false);
    expect(inRecallScope("mado-user:alice", scope)).toBe(false);
  });

  it("keeps Assist's recall out of every thread", () => {
    const scope = resolveMemoryScope("alice").recall;
    expect(inRecallScope("mado-user:alice", scope)).toBe(true);
    expect(inRecallScope("01HXYZ", scope)).toBe(true);
    expect(inRecallScope("mado-thread:t1", scope)).toBe(false);
  });
});
