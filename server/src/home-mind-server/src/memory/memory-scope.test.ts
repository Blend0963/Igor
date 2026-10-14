import { describe, it, expect } from "vitest";
import { inRecallScope, resolveMemoryScope, threadFactBucket } from "./memory-scope.js";

describe("resolveMemoryScope", () => {
  it("gives a thread its own conversation and recall, and the user's shared facts by default", () => {
    expect(resolveMemoryScope("alice", "mado-thread:t1")).toEqual({
      conversationId: "mado-thread:t1",
      factBucket: "alice",
      recall: { conversationId: "mado-thread:t1" },
      isThread: true,
      historyWindow: 20,
    });
  });

  it("seals a thread's facts off too when thread memory is isolated", () => {
    const scope = resolveMemoryScope("alice", "mado-thread:t1", "isolated");
    expect(scope.factBucket).toBe(threadFactBucket("alice", "mado-thread:t1"));
    expect(scope.factBucket).not.toBe("alice");
    expect(scope.recall).toEqual({ conversationId: "mado-thread:t1" });
  });

  it("never changes Assist, whatever the thread setting", () => {
    expect(resolveMemoryScope("alice", "01HXYZ", "isolated").factBucket).toBe("alice");
  });

  it("puts every Assist device on the one shared conversation, with threads out of recall", () => {
    for (const conversationId of [undefined, "01HXYZ", "phone-chat-log"]) {
      expect(resolveMemoryScope("alice", conversationId)).toEqual({
        conversationId: "mado-user:alice",
        factBucket: "alice",
        recall: { excludeConversationPrefix: "mado-thread:" },
        isThread: false,
        historyWindow: 12,
      });
    }
  });

  it("gives two threads of the same user two different buckets", () => {
    expect(threadFactBucket("alice", "mado-thread:a")).not.toBe(
      threadFactBucket("alice", "mado-thread:b")
    );
  });
});

describe("threadFactBucket", () => {
  // Shodh: "user_id contains invalid characters (allowed: alphanumeric, -, _, @, .)"
  const SHODH_USER_ID = /^[A-Za-z0-9\-_@.]+$/;

  it("only uses characters Shodh accepts in a user_id", () => {
    for (const id of [
      "mado-thread:3f2b1c9e-7a44-4b1d-9e0f-2c5d8a6b7e10",
      "mado-thread:id-lx3k9-ab12cd34",
      "mado-thread:weird id/with:stuff",
    ]) {
      expect(threadFactBucket("default", id)).toMatch(SHODH_USER_ID);
    }
    expect(threadFactBucket("default", "mado-thread:abc")).toBe("default@mado-thread.abc");
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
