import { describe, it, expect } from "vitest";
import { CHAT_LIMITS, ChatRequestSchema } from "./routes.js";

describe("ChatRequestSchema (#63)", () => {
  // HA's conversation.process without a conversation_id serialized to an
  // explicit `"conversationId": null`, which `.optional()` rejects — every
  // such service call 400'd before any LLM was reached.

  it("accepts conversationId: null and normalizes it to undefined", () => {
    const result = ChatRequestSchema.safeParse({
      message: "hello",
      conversationId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversationId).toBeUndefined();
    }
  });

  it("accepts an absent conversationId", () => {
    const result = ChatRequestSchema.safeParse({ message: "hello" });
    expect(result.success).toBe(true);
  });

  it("passes a real conversationId through", () => {
    const result = ChatRequestSchema.safeParse({
      message: "hello",
      conversationId: "01ABCDEFGHIJKLMNOPQRSTUVWX",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversationId).toBe("01ABCDEFGHIJKLMNOPQRSTUVWX");
    }
  });

  it("accepts userId: null and falls back to default — same latent shape", () => {
    const result = ChatRequestSchema.safeParse({
      message: "hello",
      userId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe("default");
    }
  });

  it("still requires a message", () => {
    const result = ChatRequestSchema.safeParse({ conversationId: null });
    expect(result.success).toBe(false);
  });
});

describe("ChatRequestSchema limits", () => {
  it("accepts a request at every ceiling", () => {
    const result = ChatRequestSchema.safeParse({
      message: "x".repeat(CHAT_LIMITS.message),
      userId: "u".repeat(CHAT_LIMITS.id),
      conversationId: "mado-thread:" + "c".repeat(CHAT_LIMITS.id - 12),
      images: Array(CHAT_LIMITS.images).fill("https://example.com/a.jpg"),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a request past any ceiling", () => {
    for (const extra of [
      { message: "x".repeat(CHAT_LIMITS.message + 1) },
      { userId: "u".repeat(CHAT_LIMITS.id + 1) },
      { conversationId: "c".repeat(CHAT_LIMITS.id + 1) },
      { customPrompt: "p".repeat(CHAT_LIMITS.customPrompt + 1) },
      { images: Array(CHAT_LIMITS.images + 1).fill("https://example.com/a.jpg") },
    ]) {
      expect(ChatRequestSchema.safeParse({ message: "hi", ...extra }).success).toBe(false);
    }
  });
});

describe("ChatRequestSchema images", () => {
  it("accepts image data URLs and https links", () => {
    for (const img of ["data:image/jpeg;base64,/9j/4AAQ", "data:image/png;base64,iVBORw0KGgo=", "https://example.com/a.jpg"]) {
      expect(ChatRequestSchema.safeParse({ message: "hi", images: [img] }).success, img).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const img of ["data:text/html;base64,PHNjcmlwdD4=", "http://example.com/a.jpg", "file:///etc/passwd", "data:image/svg+xml;base64,PHN2Zz4="]) {
      expect(ChatRequestSchema.safeParse({ message: "hi", images: [img] }).success, img).toBe(false);
    }
  });
});

describe("ChatRequestSchema documents", () => {
  it("accepts any file as a base64 data URL", () => {
    for (const data of ["data:application/pdf;base64,JVBERi0=", "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEs=", "data:;base64,AA==", "data:application/zip;name=a.zip;base64,UEs="]) {
      expect(ChatRequestSchema.safeParse({ message: "x", documents: [{ name: "a", data }] }).success).toBe(true);
    }
  });

  it("refuses links, non-base64 data and too many files", () => {
    expect(ChatRequestSchema.safeParse({ message: "x", documents: [{ name: "a", data: "https://x/a.pdf" }] }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ message: "x", documents: [{ name: "a", data: "data:text/plain,hello" }] }).success).toBe(false);
    const many = Array.from({ length: CHAT_LIMITS.documents + 1 }, () => ({ name: "a.pdf", data: "data:application/pdf;base64,AA==" }));
    expect(ChatRequestSchema.safeParse({ message: "x", documents: many }).success).toBe(false);
  });
});
