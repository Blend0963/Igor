import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../config.js";
import type { IMemoryStore } from "../memory/interface.js";
import type { IConversationStore } from "../memory/types.js";
import type { IFactExtractor } from "./interface.js";
import type { HomeAssistantClient } from "../ha/client.js";
import type { DeviceScanner } from "../ha/device-scanner.js";
import type { TopologyScanner } from "../ha/topology-scanner.js";

/**
 * The Anthropic SDK's `messages.stream()` returns an object we subscribe to and
 * then await. Mock the two members the engine touches.
 */
const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { stream: mockStream };
  },
}));

vi.mock("./tool-handler.js", () => ({
  handleToolCall: vi.fn().mockResolvedValue({ state: "on" }),
  extractAndStoreFacts: vi.fn().mockResolvedValue(1),
}));

import { LLMClient } from "./client.js";

function finalMessage(overrides: Record<string, unknown>) {
  const message = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 40 },
    ...overrides,
  };
  return {
    on: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue(message),
  };
}

describe("LLMClient (Anthropic engine)", () => {
  let engine: LLMClient;
  let config: Config;
  let conversations: IConversationStore & {
    getConversationHistory: ReturnType<typeof vi.fn>;
    storeMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockStream.mockReset();
    config = {
      llmProvider: "anthropic",
      llmModel: "claude-test",
      anthropicApiKey: "test-key",
      memoryTokenLimit: 1500,
      logLevel: "info",
    } as Config;

    const memory = {
      getFactsWithinTokenLimit: vi.fn().mockResolvedValue([]),
    } as unknown as IMemoryStore;
    conversations = {
      getConversationHistory: vi.fn().mockReturnValue([]),
      storeMessage: vi.fn(),
    } as unknown as typeof conversations;
    const scanner = {
      refreshIfStale: vi.fn().mockResolvedValue(undefined),
      hasProfiles: vi.fn().mockReturnValue(false),
      formatCheatSheet: vi.fn().mockReturnValue(""),
    } as unknown as DeviceScanner;
    const topology = {
      refreshIfStale: vi.fn().mockResolvedValue(undefined),
      hasLayout: vi.fn().mockReturnValue(false),
      formatSection: vi.fn().mockReturnValue(""),
    } as unknown as TopologyScanner;

    engine = new LLMClient(
      config,
      memory,
      conversations,
      {} as IFactExtractor,
      {} as HomeAssistantClient,
      scanner,
      topology
    );
  });

  it("uses the shared written ceiling by default", async () => {
    mockStream.mockReturnValue(
      finalMessage({ content: [{ type: "text", text: "Hello" }] })
    );
    await engine.chat({ message: "Hi", userId: "u" });
    expect(mockStream.mock.calls[0][0].max_tokens).toBe(8192);
  });

  it("cuts repeated spoken text in the Anthropic stream before returning it", async () => {
    const loop =
      "La lumière est allumée. Tout est prêt. La lumière est allumée. Je recommence.";
    const stream = Object.assign(
      finalMessage({ content: [{ type: "text", text: loop }] }),
      { abort: vi.fn() }
    );
    stream.on = vi.fn((event: string, callback: (textDelta: string) => void) => {
      if (event === "text") {
        callback("La lumière est allumée. ");
        callback("Tout est prêt. ");
        callback("La lumière est allumée. Je recommence.");
      }
      return stream;
    }) as typeof stream.on;
    mockStream.mockReturnValue(stream);
    const spoken: string[] = [];

    const result = await engine.chat(
      { message: "Hi", userId: "u", isVoice: true },
      (chunk) => spoken.push(chunk)
    );

    expect(result.response).toBe("La lumière est allumée. Tout est prêt. ");
    expect(spoken.join("")).toBe(result.response);
    expect(stream.abort).toHaveBeenCalledOnce();
  });

  it("uses the shared spoken ceiling for voice", async () => {
    mockStream.mockReturnValue(
      finalMessage({ content: [{ type: "text", text: "Hello" }] })
    );
    await engine.chat({ message: "Hi", userId: "u", isVoice: true });
    expect(mockStream.mock.calls[0][0].max_tokens).toBe(2000);
  });

  it("honours a configured ceiling over the default", async () => {
    config.maxOutputTokens = 12000;
    mockStream.mockReturnValue(
      finalMessage({ content: [{ type: "text", text: "Hello" }] })
    );
    await engine.chat({ message: "Hi", userId: "u" });
    expect(mockStream.mock.calls[0][0].max_tokens).toBe(12000);
  });

  it("says so when a written answer was cut off part way", async () => {
    mockStream.mockReturnValue(
      finalMessage({
        content: [{ type: "text", text: "The kitchen sensor reads" }],
        stop_reason: "max_tokens",
      })
    );
    const result = await engine.chat({ message: "Hi", userId: "u" });
    expect(result.response).toContain("The kitchen sensor reads");
    expect(result.response).toContain("ran out of room");
    expect(result.error).toBeUndefined();
  });

  it("keeps the spoken notice short", async () => {
    mockStream.mockReturnValue(
      finalMessage({
        content: [{ type: "text", text: "It is 21 degrees" }],
        stop_reason: "max_tokens",
      })
    );
    const result = await engine.chat({ message: "Hi", userId: "u", isVoice: true });
    expect(result.response).toContain("ran out of room");
    expect(result.response).not.toContain("add-on settings");
  });

  it("attaches MAX_TOKENS_TRUNCATED when the cap left nothing at all", async () => {
    mockStream.mockReturnValue(
      finalMessage({ content: [], stop_reason: "max_tokens" })
    );
    const result = await engine.chat({ message: "Hi", userId: "u" });
    expect(result.response).toBe("");
    expect(result.error?.code).toBe("MAX_TOKENS_TRUNCATED");
    expect(result.error?.hint).toMatch(/ran out of room/);
  });

  it("attaches EMPTY_CONTENT for an empty reply that did not hit the cap", async () => {
    mockStream.mockReturnValue(finalMessage({ content: [], stop_reason: "end_turn" }));
    const result = await engine.chat({ message: "Hi", userId: "u" });
    expect(result.error?.code).toBe("EMPTY_CONTENT");
  });

  it("leaves a complete answer untouched and error-free", async () => {
    mockStream.mockReturnValue(
      finalMessage({ content: [{ type: "text", text: "It is 21 degrees." }] })
    );
    const result = await engine.chat({ message: "Hi", userId: "u" });
    expect(result.response).toBe("It is 21 degrees.");
    expect(result.error).toBeUndefined();
  });

  it("logs the cap being reached with Anthropic's usage field names", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStream.mockReturnValue(
      finalMessage({
        content: [{ type: "text", text: "partial" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 81446, output_tokens: 8192 },
      })
    );
    await engine.chat({ message: "Hi", userId: "u" });
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("output cap reached"));
    expect(line).toContain("cap=8192");
    expect(line).toContain("prompt=81446");
    expect(line).toContain("completion=8192");
    // Anthropic gives no reasoning count; the log must say so, not print 0.
    expect(line).toContain("reasoning=unreported");
    warn.mockRestore();
  });

  it("gives a mado-thread: id its own conversation, isolated from Assist", async () => {
    // The thread panel sends "mado-thread:" ids: short-term history must be
    // segmented per thread, or every thread shares one stream.
    mockStream.mockReturnValue(
      finalMessage({ content: [{ type: "text", text: "Hello" }] })
    );
    await engine.chat({ message: "Hi", userId: "u", conversationId: "mado-thread:t-1" });

    expect(conversations.getConversationHistory).toHaveBeenCalledWith("mado-thread:t-1", 20);
    expect(conversations.storeMessage).toHaveBeenCalledWith("mado-thread:t-1", "u", "user", "Hi");
    expect(conversations.storeMessage).toHaveBeenCalledWith("mado-thread:t-1", "u", "assistant", "Hello");
  });

  it("keeps non-thread callers on the shared Assist conversation", async () => {
    // Assist sends Home Assistant own conversation ids, one per chat log:
    // those must not fragment the durable mado-user: conversation.
    mockStream.mockReturnValue(
      finalMessage({ content: [{ type: "text", text: "Hello" }] })
    );
    await engine.chat({ message: "Hi", userId: "u", conversationId: "01JDWG7QTQXQF8J1XQ" });

    expect(conversations.getConversationHistory).toHaveBeenCalledWith("mado-user:u", 12);
    expect(conversations.storeMessage).toHaveBeenCalledWith("mado-user:u", "u", "user", "Hi");
  });
});
