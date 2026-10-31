import { localTurnMessages } from "../train/local-dataset.js";
import { LOCAL_PROTOCOL, LOCAL_REMINDER } from "./local-protocol.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Config } from "../config.js";
import type { IMemoryStore } from "../memory/interface.js";
import type { IConversationStore } from "../memory/types.js";
import type { IFactExtractor } from "./interface.js";
import type { HomeAssistantClient } from "../ha/client.js";
import { DeviceScanner } from "../ha/device-scanner.js";
import { TopologyScanner } from "../ha/topology-scanner.js";

// Async iterator helper for simulating OpenAI streams
function makeStream(chunks: object[]) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < chunks.length)
            return { value: chunks[i++], done: false as const };
          return { value: undefined, done: true as const };
        },
      };
    },
  };
}

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      baseURL: string;
      chat: { completions: { create: typeof mockCreate; baseURL: string } };
      // Each call's `this` (mockCreate.mock.contexts) names the endpoint it went to.
      constructor(opts?: { baseURL?: string }) {
        this.baseURL = opts?.baseURL ?? "https://api.openai.com/v1";
        this.chat = { completions: { create: mockCreate, baseURL: this.baseURL } };
      }
    },
  };
});

vi.mock("./tool-handler.js", () => ({
  handleToolCall: vi.fn().mockResolvedValue({ state: "on" }),
  extractAndStoreFacts: vi.fn().mockResolvedValue(1),
}));

vi.mock("./order-check.js", () => ({
  askIsOrder: vi.fn().mockResolvedValue({ order: false }),
}));

import { OpenAIChatEngine, localToolList } from "./openai-client.js";
import { askIsOrder } from "./order-check.js";
import { resetTokenCapCache } from "./token-cap.js";
import { resetReasoningEffortCache } from "./reasoning-effort.js";
import { handleToolCall, extractAndStoreFacts } from "./tool-handler.js";

describe("OpenAIChatEngine", () => {
  let engine: OpenAIChatEngine;
  let memory: IMemoryStore;
  let conversations: IConversationStore;
  let extractor: IFactExtractor;
  let ha: HomeAssistantClient;
  let config: Config;

  beforeEach(() => {
    resetTokenCapCache();
    resetReasoningEffortCache();
    mockCreate.mockReset();
    vi.mocked(handleToolCall).mockReset();
    vi.mocked(extractAndStoreFacts).mockReset();

    vi.mocked(handleToolCall).mockResolvedValue({ state: "on" });
    vi.mocked(extractAndStoreFacts).mockResolvedValue(1);
    vi.mocked(askIsOrder).mockReset().mockResolvedValue({ order: false });

    memory = {
      getFactsWithinTokenLimit: vi.fn().mockResolvedValue([]),
    } as unknown as IMemoryStore;

    conversations = {
      getConversationHistory: vi.fn().mockReturnValue([]),
      storeMessage: vi.fn(),
      getKnownUsers: vi.fn().mockReturnValue([]),
      cleanupOldConversations: vi.fn().mockReturnValue(0),
      close: vi.fn(),
    } as unknown as IConversationStore;

    extractor = {} as IFactExtractor;

    ha = { getEntities: vi.fn().mockResolvedValue([]) } as unknown as HomeAssistantClient;

    config = {
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      openaiApiKey: "test-key",
      memoryTokenLimit: 1500,
    } as Config;

    const mockScanner = {
      refreshIfStale: vi.fn().mockResolvedValue(undefined),
      hasProfiles: vi.fn().mockReturnValue(false),
      formatCheatSheet: vi.fn().mockReturnValue(""),
    } as unknown as DeviceScanner;
    const mockTopology = {
      refreshIfStale: vi.fn().mockResolvedValue(undefined),
      hasLayout: vi.fn().mockReturnValue(false),
      formatSection: vi.fn().mockReturnValue(""),
    } as unknown as TopologyScanner;
    engine = new OpenAIChatEngine(config, memory, conversations, extractor, ha, mockScanner, mockTopology);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.LEAN_MODE;
  });

  it("accumulates text from stream deltas", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Hello" }, finish_reason: null }] },
        { choices: [{ delta: { content: " world" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    const result = await engine.chat({
      message: "Hi",
      userId: "user-1",
    });

    expect(result.response).toBe("Hello world");
  });

  it("sends images as image_url content blocks when provided", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "ok" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({
      message: "What's in this image?",
      userId: "user-1",
      images: ["data:image/png;base64,AAAA"],
    });

    const sent = mockCreate.mock.calls[0][0];
    const userMsg = [...sent.messages].reverse().find((m: { role: string }) => m.role === "user");
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0]).toEqual({ type: "text", text: "What's in this image?" });
    expect(userMsg.content[1]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    });
  });

  it("sends a plain string user message when no images", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "ok" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({ message: "Hello", userId: "user-1" });

    const sent = mockCreate.mock.calls[0][0];
    const userMsg = [...sent.messages].reverse().find((m: { role: string }) => m.role === "user");
    expect(userMsg.content).toBe("Hello");
  });

  it("passes written text deltas on as they come", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "A" }, finish_reason: null }] },
        { choices: [{ delta: { content: "B" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    const chunks: string[] = [];
    await engine.chat({ message: "Hi", userId: "user-1" }, (chunk) =>
      chunks.push(chunk)
    );

    expect(chunks).toEqual(["A", "B"]);
  });

  it("accumulates tool call deltas across chunks", async () => {
    // First stream: tool call
    mockCreate.mockResolvedValueOnce(
      makeStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    function: { name: "get_state", arguments: '{"entity' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '_id":"light.kitchen"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ])
    );

    // Second stream: final response after tool result
    mockCreate.mockResolvedValueOnce(
      makeStream([
        {
          choices: [
            { delta: { content: "The light is on" }, finish_reason: null },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    const result = await engine.chat({ message: "Is the light on?", userId: "user-1" });

    expect(handleToolCall).toHaveBeenCalledWith(
      ha,
      "get_state",
      { entity_id: "light.kitchen" },
      expect.objectContaining({ turnId: expect.any(String) })
    );
    expect(result.response).toBe("The light is on");
    expect(result.toolsUsed).toEqual(["get_state"]);
  });

  it("handles multiple tool calls in one response", async () => {
    // First stream: two tool calls
    mockCreate.mockResolvedValueOnce(
      makeStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    function: {
                      name: "get_state",
                      arguments: '{"entity_id":"sensor.temp"}',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: "call-2",
                    function: {
                      name: "get_state",
                      arguments: '{"entity_id":"sensor.humidity"}',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ])
    );

    // Second stream: final response
    mockCreate.mockResolvedValueOnce(
      makeStream([
        { choices: [{ delta: { content: "22°C, 45%" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    const result = await engine.chat({ message: "temp and humidity?", userId: "user-1" });

    expect(handleToolCall).toHaveBeenCalledTimes(2);
    expect(result.toolsUsed).toEqual(["get_state", "get_state"]);
  });

  describe("OpenAI-compatible endpoints that stream differently", () => {
    const toolDelta = (toolCall: object, finish_reason: string | null = null) => ({
      choices: [{ delta: { tool_calls: [toolCall] }, finish_reason }],
    });
    const answer = (text: string) =>
      makeStream([{ choices: [{ delta: { content: text }, finish_reason: "stop" }] }]);
    const assistantToolCalls = (call: number) =>
      mockCreate.mock.calls[call][0].messages.find(
        (m: { role: string }) => m.role === "assistant"
      ).tool_calls;

    it("runs the tool calls of a turn that reports finish_reason stop", async () => {
      mockCreate.mockResolvedValueOnce(
        makeStream([
          toolDelta(
            { index: 0, id: "call-1", function: { name: "get_state", arguments: '{"entity_id":"sensor.t"}' } },
            "stop"
          ),
        ])
      );
      mockCreate.mockResolvedValueOnce(answer("20 °C"));

      const result = await engine.chat({ message: "temperature?", userId: "user-1" });

      expect(handleToolCall).toHaveBeenCalledWith(
        ha,
        "get_state",
        { entity_id: "sensor.t" },
        expect.anything()
      );
      expect(result.toolsUsed).toEqual(["get_state"]);
      expect(result.response).toBe("20 °C");
      expect(result.error).toBeUndefined();
    });

    it("keeps parallel calls apart when each arrives whole with its own id and no index", async () => {
      mockCreate.mockResolvedValueOnce(
        makeStream([
          toolDelta({
            id: "call_a",
            type: "function",
            function: { name: "get_state", arguments: '{"entity_id":"climate.living_room"}' },
          }),
          toolDelta({
            id: "call_b",
            type: "function",
            function: { name: "search_entities", arguments: '{"query":"living room"}' },
          }),
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );
      mockCreate.mockResolvedValueOnce(answer("ok"));

      await engine.chat({ message: "living room?", userId: "user-1" });

      const sent = assistantToolCalls(1);
      expect(sent.map((c: { id: string }) => c.id)).toEqual(["call_a", "call_b"]);
      expect(sent[0].function).toEqual({
        name: "get_state",
        arguments: '{"entity_id":"climate.living_room"}',
      });
      expect(sent[1].function).toEqual({
        name: "search_entities",
        arguments: '{"query":"living room"}',
      });
      expect(handleToolCall).toHaveBeenCalledTimes(2);
    });

    it("opens a new call when a delta brings a new id under an index already in use", async () => {
      mockCreate.mockResolvedValueOnce(
        makeStream([
          toolDelta({ index: 0, id: "call_a", function: { name: "get_state", arguments: '{"entity_id":"a.b"}' } }),
          toolDelta({ index: 0, id: "call_b", function: { name: "get_state", arguments: '{"entity_id":"c.d"}' } }),
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      );
      mockCreate.mockResolvedValueOnce(answer("ok"));

      await engine.chat({ message: "both?", userId: "user-1" });

      const sent = assistantToolCalls(1);
      expect(sent.map((c: { id: string }) => c.id)).toEqual(["call_a", "call_b"]);
      expect(sent[1].function.arguments).toBe('{"entity_id":"c.d"}');
    });

    it("still joins calls streamed in pieces under their index, even interleaved", async () => {
      mockCreate.mockResolvedValueOnce(
        makeStream([
          toolDelta({ index: 0, id: "call-1", function: { name: "get_state", arguments: '{"entity_id":' } }),
          toolDelta({ index: 1, id: "call-2", function: { name: "get_state", arguments: '{"entity_id":' } }),
          toolDelta({ index: 0, function: { arguments: '"sensor.temp"}' } }),
          toolDelta({ index: 1, function: { arguments: '"sensor.humidity"}' } }),
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      );
      mockCreate.mockResolvedValueOnce(answer("22 °C, 45 %"));

      const result = await engine.chat({ message: "temp and humidity?", userId: "user-1" });

      const sent = assistantToolCalls(1);
      expect(sent.map((c: { id: string }) => c.id)).toEqual(["call-1", "call-2"]);
      expect(sent[0].function.arguments).toBe('{"entity_id":"sensor.temp"}');
      expect(sent[1].function.arguments).toBe('{"entity_id":"sensor.humidity"}');
      expect(result.response).toBe("22 °C, 45 %");
    });

    it("hands a tool call's extra_content back untouched on the next turn", async () => {
      const extra = { vendor: { signature: "sig-abc" } };
      mockCreate.mockResolvedValueOnce(
        makeStream([
          toolDelta({
            index: 0,
            id: "call-1",
            function: { name: "get_state", arguments: '{"entity_id":"light.a"}' },
            extra_content: extra,
          }),
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      );
      mockCreate.mockResolvedValueOnce(answer("On"));

      await engine.chat({ message: "light?", userId: "user-1" });

      expect(assistantToolCalls(1)[0].extra_content).toEqual(extra);
    });

    it("keeps extra_content with its own call when parallel calls arrive whole", async () => {
      const extra = { vendor: { signature: "sig" } };
      mockCreate.mockResolvedValueOnce(
        makeStream([
          toolDelta({
            id: "call_a",
            function: { name: "get_state", arguments: "{}" },
            extra_content: extra,
          }),
          toolDelta({ id: "call_b", function: { name: "get_state", arguments: "{}" } }),
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );
      mockCreate.mockResolvedValueOnce(answer("ok"));

      await engine.chat({ message: "x", userId: "user-1" });

      const sent = assistantToolCalls(1);
      expect(sent[0].extra_content).toEqual(extra);
      expect(sent[1]).not.toHaveProperty("extra_content");
    });

    it("omits extra_content when the endpoint sends none", async () => {
      mockCreate.mockResolvedValueOnce(
        makeStream([
          toolDelta({ index: 0, id: "call-1", function: { name: "get_state", arguments: "{}" } }, "tool_calls"),
        ])
      );
      mockCreate.mockResolvedValueOnce(answer("ok"));

      await engine.chat({ message: "x", userId: "user-1" });

      expect(assistantToolCalls(1)[0]).not.toHaveProperty("extra_content");
    });

    it("keeps the empty-response diagnosis when a tool turn ends without a word", async () => {
      // No canned reply is substituted: the voice path and the integration
      // decide what to say, in the user's language.
      mockCreate.mockResolvedValueOnce(
        makeStream([
          toolDelta({ index: 0, id: "call-1", function: { name: "call_service", arguments: "{}" } }, "stop"),
        ])
      );
      mockCreate.mockResolvedValueOnce(
        makeStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }])
      );

      const result = await engine.chat({ message: "lights on", userId: "user-1" });

      expect(result.response).toBe("");
      expect(result.error?.code).toBe("EMPTY_CONTENT");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("still bounds the loop and forces an answer when every turn reports stop", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockCreate.mockImplementation(async () =>
        makeStream([
          toolDelta({ index: 0, id: "call-1", function: { name: "get_state", arguments: "{}" } }, "stop"),
        ])
      );

      await engine.chat({ message: "x", userId: "user-1" });

      // One opening request plus eight tool rounds; the last one may not call tools.
      expect(mockCreate).toHaveBeenCalledTimes(9);
      expect(mockCreate.mock.calls[8][0].tool_choice).toBe("none");
      expect(mockCreate.mock.calls[7][0]).not.toHaveProperty("tool_choice");
    });
  });

  describe("chat-panel threads (v0.7.0)", () => {
    const reply = (chunks: object[] = [{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }]) => makeStream(chunks);
    const thread = "mado-thread:0f8c1d9e-1111-4a4a-9b9b-222233334444";

    afterEach(() => vi.unstubAllEnvs());

    it("reasons at the thread setting while Assist stays at none for voice", async () => {
      config.threadReasoning = "high";
      mockCreate.mockResolvedValue(reply());
      await engine.chat({ message: "Analyse pourquoi x", userId: "user-1", conversationId: thread });
      expect(mockCreate.mock.calls[0][0].reasoning_effort).toBe("high");

      mockCreate.mockResolvedValue(reply());
      await engine.chat({ message: "x", userId: "user-1", isVoice: true });
      expect(mockCreate.mock.calls[1][0].reasoning_effort).toBe("none");
    });

    it("gives a reasoning thread a larger output ceiling", async () => {
      config.threadReasoning = "high";
      mockCreate.mockResolvedValue(reply());
      await engine.chat({ message: "x", userId: "user-1", conversationId: thread });
      const body = mockCreate.mock.calls[0][0];
      expect(body.max_completion_tokens ?? body.max_tokens).toBe(16384);
    });

    it("keeps thinking chunks out of the answer and says it is thinking", async () => {
      config.threadReasoning = "high";
      mockCreate.mockResolvedValue(
        reply([
          { choices: [{ delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: "secret plan" }] }] }, finish_reason: null }] },
          { choices: [{ delta: { content: "Voilà." }, finish_reason: "stop" }] },
        ])
      );
      const onStatus = vi.fn();
      const result = await engine.chat({ message: "x", userId: "user-1", conversationId: thread }, { onStatus });
      expect(result.response).toBe("Voilà.");
      expect(onStatus).toHaveBeenCalledWith("Réflexion…");
    });

    it("offers the Mistral agent tools in threads only, when a Mistral key is set", async () => {
      vi.stubEnv("MISTRAL_API_KEY", "k");
      mockCreate.mockResolvedValue(reply());
      await engine.chat({ message: "x", userId: "user-1", conversationId: thread });
      mockCreate.mockResolvedValue(reply());
      await engine.chat({ message: "x", userId: "user-1" });
      const names = (i: number) => mockCreate.mock.calls[i][0].tools.map((t: { function: { name: string } }) => t.function.name);
      expect(names(0)).toEqual(expect.arrayContaining(["run_code", "generate_image"]));
      expect(names(1)).not.toContain("run_code");
    });

    it("adds the images a tool produced when the answer leaves them out", async () => {
      vi.mocked(handleToolCall).mockImplementation(async (_ha, _name, _args, ctx) => {
        ctx?.attachments?.push("![chart](api/media/11111111-2222-4333-8444-555555555555)");
        if (ctx) ctx.attachments ??= ["![chart](api/media/11111111-2222-4333-8444-555555555555)"];
        return { images: [] };
      });
      mockCreate
        .mockResolvedValueOnce(
          reply([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "run_code", arguments: "{\"task\":\"x\"}" } }] }, finish_reason: "tool_calls" }] }])
        )
        .mockResolvedValueOnce(reply([{ choices: [{ delta: { content: "Le graphique :" }, finish_reason: "stop" }] }]));
      const result = await engine.chat({ message: "x", userId: "user-1", conversationId: thread });
      expect(result.response).toBe("Le graphique :\n\n![chart](api/media/11111111-2222-4333-8444-555555555555)");
    });
  });

  describe("fast model and stop (v0.8.0)", () => {
    // The full path, as with lean_mode: false (lean mode has its own tests).
    beforeEach(() => { process.env.LEAN_MODE = "off"; });
    afterEach(() => { delete process.env.LEAN_MODE; });

    const reply = (text = "ok") => makeStream([{ choices: [{ delta: { content: text }, finish_reason: "stop" }] }]);

    it("sends a plain command to FAST_MODEL without reasoning, the rest to the main model", async () => {
      config.fastModel = "ministral-8b-latest";
      config.threadReasoning = "high";
      mockCreate
        .mockResolvedValueOnce(
          makeStream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "call_service", arguments: '{"domain":"light","service":"turn_on","entity_id":"light.salon"}' } }] }, finish_reason: "tool_calls" }] }])
        )
        .mockResolvedValueOnce(reply());
      const r1 = await engine.chat({ message: "allume la lumière du salon", userId: "u" });
      expect(mockCreate.mock.calls[0][0]).toMatchObject({ model: "ministral-8b-latest", reasoning_effort: "none" });
      expect(r1.usage?.model).toBe("ministral-8b-latest");
      mockCreate.mockResolvedValue(reply());
      await engine.chat({ message: "pourquoi la chambre est froide le matin ?", userId: "u" });
      expect(mockCreate.mock.calls[2][0].model).toBe("gpt-4o-mini");
    });

    it("uses the model and thinking picked in the panel, over the fast model", async () => {
      config.fastModel = "ministral-8b-latest";
      mockCreate.mockResolvedValue(reply());
      await engine.chat({ message: "allume le salon", userId: "u", conversationId: "mado-thread:p", model: "mistral-medium-latest", reasoning: "low" });
      expect(mockCreate.mock.calls[0][0]).toMatchObject({ model: "mistral-medium-latest", reasoning_effort: "low" });
    });

    it("falls back to the main model when the fast one fails", async () => {
      config.fastModel = "does-not-exist";
      mockCreate.mockRejectedValueOnce(Object.assign(new Error("404 model not found"), { status: 404 })).mockResolvedValue(reply("fait"));
      const r = await engine.chat({ message: "éteins la cuisine", userId: "u" });
      expect(r.response).toBe("fait");
      expect(mockCreate.mock.calls[1][0].model).toBe("gpt-4o-mini");
    });

    it("asks again, on the main model with a required tool call, when a command was answered without acting", async () => {
      config.fastModel = "ministral-8b-latest";
      const chunks: string[] = [];
      mockCreate
        .mockResolvedValueOnce(reply("La lumière est éteinte."))
        .mockResolvedValueOnce(
          makeStream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "call_service", arguments: '{"domain":"light","service":"turn_off","entity_id":"light.salon"}' } }] }, finish_reason: "tool_calls" }] }])
        )
        .mockResolvedValueOnce(reply("C'est éteint."));
      const r = await engine.chat({ message: "Éteins toutes les lumières de la maison.", userId: "u" }, { onChunk: (c) => chunks.push(c) });
      expect(mockCreate.mock.calls[0][0].model).toBe("ministral-8b-latest");
      expect(mockCreate.mock.calls[1][0]).toMatchObject({ model: "gpt-4o-mini", tool_choice: "required" });
      expect(mockCreate.mock.calls[2][0].tool_choice).toBeUndefined();
      expect(r.toolsUsed).toEqual(["call_service"]);
      expect(r.response).toBe("C'est éteint.");
      // The false "it's off" was never streamed to the speaker.
      expect(chunks.join("")).not.toContain("La lumière est éteinte");
    });

    it("asks a model whether an unusual wording was an order, and acts when it was", async () => {
      vi.mocked(askIsOrder).mockResolvedValue({ order: true });
      const chunks: string[] = [];
      mockCreate
        .mockResolvedValueOnce(reply("C'est déjà fait."))
        .mockResolvedValueOnce(
          makeStream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "call_service", arguments: '{"domain":"light","service":"turn_off","entity_id":"all"}' } }] }, finish_reason: "tool_calls" }] }])
        )
        .mockResolvedValueOnce(reply("Voilà, tout est éteint."));
      const r = await engine.chat({ message: "Plonge la maison dans le noir", userId: "u" }, { onChunk: (c) => chunks.push(c) });
      expect(askIsOrder).toHaveBeenCalledWith(expect.anything(), "gpt-4o-mini", "Plonge la maison dans le noir", undefined, undefined);
      expect(mockCreate.mock.calls[1][0]).toMatchObject({ tool_choice: "required" });
      expect(r.toolsUsed).toEqual(["call_service"]);
      expect(chunks.join("")).not.toContain("déjà fait");
    });

    it("lets the answer through when the model says it was no order", async () => {
      const chunks: string[] = [];
      mockCreate.mockResolvedValue(reply("Bonsoir !"));
      const r = await engine.chat({ message: "bonsoir Igor", userId: "u" }, { onChunk: (c) => chunks.push(c) });
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(r.response).toBe("Bonsoir !");
      expect(chunks.join("")).toBe("Bonsoir !");
    });

    it("keeps the answer when the order check fails", async () => {
      vi.mocked(askIsOrder).mockRejectedValue(new Error("boom"));
      mockCreate.mockResolvedValue(reply("Bonsoir !"));
      const r = await engine.chat({ message: "bonsoir", userId: "u" });
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(r.response).toBe("Bonsoir !");
    });

    it("shows the model what is on right now, after the history", async () => {
      vi.mocked(ha.getEntities).mockResolvedValue([
        { entity_id: "light.salon", state: "on", attributes: { friendly_name: "Salon" }, last_changed: "", last_updated: "" },
        { entity_id: "light.cuisine", state: "off", attributes: {}, last_changed: "", last_updated: "" },
      ]);
      mockCreate.mockResolvedValue(reply("ok"));
      await engine.chat({ message: "salut", userId: "u" });
      const sent = mockCreate.mock.calls[0][0].messages as Array<{ role: string; content: string }>;
      const live = sent.find((m) => m.role === "system" && String(m.content).includes("Live state of the home"));
      expect(live?.content).toContain("Salon — light.salon");
      expect(live?.content).not.toContain("light.cuisine");
      expect(sent[0].content).not.toContain("Live state");
    });

    it("does not second-guess an answer to a question", async () => {
      config.fastModel = "ministral-8b-latest";
      mockCreate.mockResolvedValue(reply("21 degrés."));
      await engine.chat({ message: "quelle température dans le salon ?", userId: "u" });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("keeps what was written when the user stops the reply", async () => {
      const controller = new AbortController();
      mockCreate.mockImplementation(async () => ({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: "Voici le début" }, finish_reason: null }] };
          controller.abort();
          throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
        },
      }));
      const r = await engine.chat({ message: "raconte", userId: "u", conversationId: "mado-thread:z", signal: controller.signal });
      expect(r.interrupted).toBe(true);
      expect(r.response).toBe("Voici le début\n\n*[Réponse interrompue]*");
      expect(conversations.storeMessage).toHaveBeenLastCalledWith("mado-thread:z", "u", "assistant", r.response);
      expect(extractAndStoreFacts).not.toHaveBeenCalled();
    });
  });

  describe("local model for Assist (LOCAL_LLM_URL)", () => {
    const reply = (text = "ok") => makeStream([{ choices: [{ delta: { content: text }, finish_reason: "stop" }] }]);
    const endpoint = (i: number) => (mockCreate.mock.contexts[i] as { baseURL: string }).baseURL;
    let localEngine: OpenAIChatEngine;

    beforeEach(() => {
      process.env.LEAN_MODE = "off";
      config.fastModel = "ministral-8b-latest";
      config.reasoningEffort = "medium";
      localEngine = new OpenAIChatEngine(
        { ...config, localLlmUrl: "http://192.168.1.20:8180/", localLlmKey: "k", localLlmModel: "qwen3-8b" },
        memory, conversations, extractor, ha,
        { refreshIfStale: vi.fn(), hasProfiles: () => false } as unknown as DeviceScanner,
        { refreshIfStale: vi.fn(), hasLayout: () => false } as unknown as TopologyScanner
      );
    });

    it("answers Assist on the local model, without the fast model or reasoning", async () => {
      mockCreate.mockResolvedValue(reply("C'est allumé."));
      const r = await localEngine.chat({ message: "allume la lumière du salon", userId: "u", isVoice: true });
      expect(r.response).toBe("C'est allumé.");
      expect(mockCreate.mock.calls[0][0].model).toBe("qwen3-8b");
      expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("reasoning_effort");
      expect(endpoint(0)).toBe("http://192.168.1.20:8180/v1");
      expect(r.usage?.model).toBe("qwen3-8b");
    });

    it("checks the addressee on the online model, which hears the sentence anyway", async () => {
      mockCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: '{"pour_igor": false}' } }] })
        .mockResolvedValue(reply());
      const r = await localEngine.chat({ message: "c'est Igor qui a éteint la lumière", userId: "u", isVoice: true });
      expect(r.notForMe).toBe(true);
      expect(endpoint(0)).toBe("https://api.openai.com/v1");
    });

    it("says it is unavailable when the local model does not answer, never asking the cloud model", async () => {
      mockCreate.mockRejectedValue(new Error("connect ECONNREFUSED 192.168.1.20:8180"));
      const chunks: string[] = [];
      const r = await localEngine.chat({ message: "pourquoi le ciel est bleu ?", userId: "u", isVoice: true }, { onChunk: (c) => chunks.push(c) });
      expect(r.response).toMatch(/modèle local ne répond pas/);
      expect(chunks.join("")).toBe(r.response);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(extractAndStoreFacts).not.toHaveBeenCalled();
    });

    it("sends the local model short instructions, its own tools and a short history", async () => {
      mockCreate.mockResolvedValue(reply());
      await localEngine.chat({ message: "allume la lumière du salon", userId: "u", isVoice: true });
      const body = mockCreate.mock.calls[0][0];
      expect(body.messages[0].content.startsWith(LOCAL_PROTOCOL)).toBe(true);
      expect(body.messages[0].content).not.toContain("SCHEDULED / RECURRING ACTIONS");
      const names = body.tools.map((t: { function: { name: string } }) => t.function.name);
      expect(names).toContain("call_service");
      expect(names).not.toContain("create_automation");
      expect(names).not.toContain("get_history");
      expect(vi.mocked(conversations.getConversationHistory).mock.calls[0][1]).toBe(6);
      // Near-greedy sampling, and the reminder right before the person's words.
      expect(body).toMatchObject({ temperature: 0.1, top_p: 0.9, top_k: 20 });
      expect(body.presence_penalty).toBeUndefined();
      const beforeUser = body.messages[body.messages.length - 2];
      expect(beforeUser.role).toBe("system");
      expect(beforeUser.content).toContain(LOCAL_REMINDER);
    });

    it("prewarms exactly the prompt a spoken request then sends, minus the words", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-28T20:21:33.456Z"));
      try {
        mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }], timings: { prompt_n: 10, cache_n: 0 } });
        const warm = await localEngine.chat({ message: "", userId: "u", isVoice: true, prewarm: true, customPrompt: "Tu es Igor." });
        expect(warm.response).toBe("");
        expect(conversations.storeMessage).not.toHaveBeenCalled();
        vi.setSystemTime(new Date("2026-10-28T20:21:51.000Z"));
        mockCreate.mockResolvedValueOnce(reply("Bonsoir."));
        await localEngine.chat({ message: "bonsoir", userId: "u", isVoice: true, customPrompt: "Tu es Igor." });
        const [prewarm, real] = [mockCreate.mock.calls[0][0], mockCreate.mock.calls[1][0]];
        expect(prewarm.max_tokens).toBe(1);
        expect(prewarm.messages.slice(0, -1)).toEqual(real.messages.slice(0, -1));
        expect(prewarm.tools).toEqual(real.tools);
        expect(real.messages.at(-1)).toEqual({ role: "user", content: "bonsoir" });
      } finally {
        vi.useRealTimers();
      }
    });

    const orderCall = () =>
      makeStream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "call_service", arguments: '{"domain":"light","service":"turn_on","entity_id":"light.salon"}' } }] }, finish_reason: "tool_calls" }] }]);

    const orderEngine = (localOrderReply: "sentence" | "silent" | "online") =>
      new OpenAIChatEngine(
        { ...config, localLlmUrl: "http://192.168.1.20:8180/", localLlmKey: "k", localLlmModel: "qwen3-8b", localOrderReply },
        memory, conversations, extractor, ha,
        { refreshIfStale: vi.fn(), hasProfiles: () => false } as unknown as DeviceScanner,
        { refreshIfStale: vi.fn(), hasLayout: () => false } as unknown as TopologyScanner
      );

    it("answers a reading through the online model, from the local model's >rep line", async () => {
      vi.mocked(handleToolCall).mockResolvedValue({ entity_id: "sensor.tele_bat", state: "64", attributes: { friendly_name: "Batterie télécommande", unit_of_measurement: "%" } });
      mockCreate
        .mockResolvedValueOnce(makeStream([{ choices: [{ delta: { content: ">rep", tool_calls: [{ index: 0, id: "c1", function: { name: "get_state", arguments: '{"entity_id":"sensor.tele_bat"}' } }] }, finish_reason: "tool_calls" }] }]))
        .mockResolvedValueOnce(reply("La télécommande est à 64 %."));
      const r = await localEngine.chat({ message: "quelle est la batterie de la télécommande ?", userId: "u", isVoice: true });
      expect(r.response).toBe("La télécommande est à 64 %.");
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockCreate.mock.calls[1][0].messages.at(-1).content).toBe(
        ">rep\nlu : sensor.tele_bat (Batterie télécommande)=64 %\ndit : « quelle est la batterie de la télécommande ? »"
      );
    });

    it("words spoken replies with voice_reply_model when it is set", async () => {
      vi.mocked(handleToolCall).mockResolvedValue({ entity_id: "sensor.tele_bat", state: "64", attributes: { friendly_name: "Batterie télécommande", unit_of_measurement: "%" } });
      const engine = new OpenAIChatEngine(
        { ...config, localLlmUrl: "http://192.168.1.20:8180/", localLlmKey: "k", localLlmModel: "qwen3-8b", voiceReplyModel: "mistral-small-latest" },
        memory, conversations, extractor, ha,
        { refreshIfStale: vi.fn(), hasProfiles: () => false } as unknown as DeviceScanner,
        { refreshIfStale: vi.fn(), hasLayout: () => false } as unknown as TopologyScanner
      );
      mockCreate
        .mockResolvedValueOnce(makeStream([{ choices: [{ delta: { content: ">rep", tool_calls: [{ index: 0, id: "c1", function: { name: "get_state", arguments: '{"entity_id":"sensor.tele_bat"}' } }] }, finish_reason: "tool_calls" }] }]))
        .mockResolvedValueOnce(reply("La télécommande est à 64 %."));
      const r = await engine.chat({ message: "quelle est la batterie de la télécommande ?", userId: "u", isVoice: true });
      expect(r.response).toBe("La télécommande est à 64 %.");
      expect(mockCreate.mock.calls[1][0].model).toBe("mistral-small-latest");
    });

    it("always has a failed order said, even after the local model's '-'", async () => {
      vi.mocked(handleToolCall).mockResolvedValue({ error: "Home Assistant refused the call" });
      mockCreate
        .mockResolvedValueOnce(makeStream([{ choices: [{ delta: { content: "-", tool_calls: [{ index: 0, id: "c1", function: { name: "call_service", arguments: '{"domain":"light","service":"turn_on","entity_id":"light.salon"}' } }] }, finish_reason: "tool_calls" }] }]))
        .mockResolvedValueOnce(reply("Je n'ai pas pu allumer le salon."));
      const r = await localEngine.chat({ message: "allume le salon", userId: "u", isVoice: true });
      expect(r.response).toBe("Je n'ai pas pu allumer le salon.");
      expect(mockCreate.mock.calls[1][0].messages.at(-1).content).toMatch(/^>echec\n.*échec : call_service/s);
    });

    it("keeps the local model's request for its training: words, calls and line", async () => {
      vi.mocked(handleToolCall).mockResolvedValue({ changed_states: [{ entity_id: "light.salon", state: "on", name: "Lumière salon" }] });
      mockCreate.mockResolvedValueOnce(orderCall());
      const record = vi.fn();
      localEngine.setTurnLog({ record } as never);
      await localEngine.chat({ message: "allume la lumière du salon", userId: "u", isVoice: true });
      expect(record).toHaveBeenCalledWith({
        words: "allume la lumière du salon",
        history: [],
        calls: [{ name: "call_service", args: { domain: "light", service: "turn_on", entity_id: "light.salon" }, ok: true }],
        line: "-",
        passes: 1,
      });
    });

    it("carries out a plain order in silence by default, with no online call", async () => {
      vi.mocked(handleToolCall).mockResolvedValue({ changed_states: [{ entity_id: "light.salon", state: "on", name: "Lumière salon" }] });
      mockCreate.mockResolvedValueOnce(orderCall());
      const r = await localEngine.chat({ message: "allume la lumière du salon", userId: "u", isVoice: true });
      expect(r.response).toBe("");
      expect(r.error).toBeFalsy();
      // Told apart from an empty failure, so the integration says nothing.
      expect(r.silent).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("says the plain sentence for an order done locally when local_order_reply is sentence", async () => {
      vi.mocked(handleToolCall).mockResolvedValue({ changed_states: [{ entity_id: "light.salon", state: "on", name: "Lumière salon" }] });
      mockCreate.mockResolvedValueOnce(orderCall());
      const chunks: string[] = [];
      const r = await orderEngine("sentence").chat({ message: "allume la lumière du salon", userId: "u", isVoice: true }, { onChunk: (c) => chunks.push(c) });
      expect(r.response).toBe("Lumière salon allumée.");
      expect(chunks.join("")).toBe("Lumière salon allumée.");
      expect(r.silent).toBeUndefined();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(endpoint(0)).toBe("http://192.168.1.20:8180/v1");
    });

    it("carries out an order without a word when local_order_reply is silent", async () => {
      vi.mocked(handleToolCall).mockResolvedValue({ changed_states: [{ entity_id: "light.salon", state: "on", name: "Lumière salon" }] });
      mockCreate.mockResolvedValueOnce(orderCall());
      const chunks: string[] = [];
      const r = await orderEngine("silent").chat({ message: "allume la lumière du salon", userId: "u", isVoice: true }, { onChunk: (c) => chunks.push(c) });
      expect(r.response).toBe("");
      expect(r.error).toBeFalsy();
      expect(chunks.join("")).toBe("");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("acts on the local model, then the online model answers from the words and what was done", async () => {
      vi.mocked(handleToolCall).mockResolvedValue({ changed_states: [{ entity_id: "light.salon", state: "on", name: "Lumière salon" }] });
      mockCreate.mockResolvedValueOnce(orderCall()).mockResolvedValueOnce(reply("Voilà, le salon est éclairé."));
      const chunks: string[] = [];
      const r = await orderEngine("online").chat({ message: "allume la lumière du salon", userId: "u", isVoice: true, customPrompt: "Tu es Igor." }, { onChunk: (c) => chunks.push(c) });
      expect(r.response).toBe("Voilà, le salon est éclairé.");
      expect(chunks.join("")).toBe("Voilà, le salon est éclairé.");
      // One local pass (no second one to word it), then the online model.
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(endpoint(1)).toBe("https://api.openai.com/v1");
      const online = mockCreate.mock.calls[1][0];
      expect(online.tools).toBeUndefined();
      // A terse brief: the tag, what was done, the words.
      expect(online.messages.at(-1)).toEqual({
        role: "user",
        content: ">dire\nfait : light.salon (Lumière salon)=on\ndit : « allume la lumière du salon »",
      });
      expect(online.messages[0].content).toContain("Tu es la voix d'Igor");
      // Never the home's layout or live state.
      expect(JSON.stringify(online.messages)).not.toContain("Live state");
    });

    it("sends a tuned local model exactly what its training set was built from", async () => {
      const engine = new OpenAIChatEngine(
        { ...config, localLlmUrl: "http://192.168.1.20:8180", localLlmModel: "qwen3-8b", localLlmPrompt: "MINUTEUR : script.minuteur.", localLlmTuned: true },
        memory, conversations, extractor, ha,
        { refreshIfStale: vi.fn(), hasProfiles: () => true, formatCheatSheet: () => "LIGHT CHEAT SHEET" } as unknown as DeviceScanner,
        { refreshIfStale: vi.fn(), hasLayout: () => true, formatSection: () => "ROOM MAP" } as unknown as TopologyScanner
      );
      vi.mocked(memory.getFactsWithinTokenLimit).mockResolvedValue([{ id: "f1", content: "Il aime le jazz." }] as never);
      const at = new Date();
      at.setHours(9, 12, 0, 0);
      vi.mocked(conversations.getConversationHistory).mockReturnValue([
        { id: "m1", userId: "u", role: "user", content: "allume le salon", createdAt: at },
        { id: "m2", userId: "u", role: "assistant", content: "Lumière salon allumée.", createdAt: at },
      ] as never);
      mockCreate.mockResolvedValueOnce(reply("-")).mockResolvedValueOnce(reply("Bien sûr."));
      await engine.chat({ message: "Et la cuisine ?", userId: "u", isVoice: true, language: "fr" });
      const sent = mockCreate.mock.calls[0][0];
      const expected = localTurnMessages({
        rules: "MINUTEUR : script.minuteur.",
        facts: ["Il aime le jazz."],
        history: [
          { role: "user", content: "allume le salon", time: "09:12" },
          { role: "assistant", content: "Lumière salon allumée." },
        ],
        message: "Et la cuisine ?",
      }).map(({ training: _training, ...m }) => m);
      expect(sent.messages).toEqual(expected);
      expect(JSON.stringify(sent.messages)).not.toContain("LIGHT CHEAT SHEET");
      expect(JSON.stringify(sent.messages)).not.toContain("ROOM MAP");
      expect(sent.tools).toEqual(localToolList(true));
    });

    it("hands the online model the memories the local one picked, and only real ones", async () => {
      vi.mocked(memory.getFactsWithinTokenLimit).mockResolvedValue([
        { id: "f1", content: "Le prénom de l'utilisateur est Jean." },
        { id: "f2", content: "Il préfère 21 degrés dans le salon." },
      ] as never);
      mockCreate
        .mockResolvedValueOnce(
          makeStream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "share_memory", arguments: JSON.stringify({ facts: ["Le prénom de l'utilisateur est Jean.", "Son code est 1234."] }) } }] }, finish_reason: "tool_calls" }] }])
        )
        .mockResolvedValueOnce(reply("Vous êtes Jean."));
      const r = await localEngine.chat({ message: "comment je m'appelle ?", userId: "u", isVoice: true });
      expect(r.response).toBe("Vous êtes Jean.");
      expect(mockCreate.mock.calls[0][0].tools.map((t: { function: { name: string } }) => t.function.name)).toContain("share_memory");
      expect(handleToolCall).not.toHaveBeenCalled();
      // Straight to the online model: no second local pass.
      expect(mockCreate).toHaveBeenCalledTimes(2);
      const online = mockCreate.mock.calls[1][0];
      const sent = JSON.stringify(online.messages);
      expect(sent).toContain("Le prénom de l'utilisateur est Jean.");
      expect(sent).not.toContain("1234");
      expect(sent).not.toContain("21 degrés");
    });

    it("lets the online model search the web itself when the local one has nothing to do", async () => {
      process.env.MISTRAL_API_KEY = "k";
      try {
        vi.mocked(handleToolCall).mockResolvedValue({ answer: "Le Ballon d'Or 2026 est allé à un milieu espagnol." });
        mockCreate
          .mockResolvedValueOnce(reply("-"))
          .mockResolvedValueOnce(
            makeStream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "w1", function: { name: "web_search", arguments: '{"query":"Ballon d\'Or 2026"}' } }] }, finish_reason: "tool_calls" }] }])
          )
          .mockResolvedValueOnce(reply("Un milieu espagnol l'a remporté."));
        const r = await localEngine.chat({ message: "qui a gagné le ballon d'or ?", userId: "u", isVoice: true });
        expect(r.response).toBe("Un milieu espagnol l'a remporté.");
        expect(mockCreate.mock.calls[0][0].tools.map((t: { function: { name: string } }) => t.function.name)).not.toContain("web_search");
        expect(endpoint(1)).toBe("https://api.openai.com/v1");
        expect(mockCreate.mock.calls[1][0].tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["web_search"]);
        expect(handleToolCall).toHaveBeenCalledWith(expect.anything(), "web_search", { query: "Ballon d'Or 2026" }, expect.anything());
        expect(mockCreate.mock.calls[2][0].tool_choice).toBe("none");
      } finally {
        delete process.env.MISTRAL_API_KEY;
      }
    });

    it("lets the local model act again after searching for a device", async () => {
      vi.mocked(handleToolCall)
        .mockResolvedValueOnce([{ entity_id: "light.bureau", state: "off", name: "Lampe bureau" }])
        .mockResolvedValueOnce({ changed_states: [{ entity_id: "light.bureau", state: "on", name: "Lampe bureau" }] });
      mockCreate
        .mockResolvedValueOnce(
          makeStream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search_entities", arguments: '{"query":"bureau"}' } }] }, finish_reason: "tool_calls" }] }])
        )
        .mockResolvedValueOnce(
          makeStream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c2", function: { name: "call_service", arguments: '{"domain":"light","service":"turn_on","entity_id":"light.bureau"}' } }] }, finish_reason: "tool_calls" }] }])
        )
        .mockResolvedValueOnce(reply("La lampe du bureau est allumée."));
      const r = await orderEngine("online").chat({ message: "allume le bureau", userId: "u", isVoice: true });
      expect(r.response).toBe("La lampe du bureau est allumée.");
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(endpoint(1)).toBe("http://192.168.1.20:8180/v1");
      expect(endpoint(2)).toBe("https://api.openai.com/v1");
    });

    it("gives the local model the last exchange and today's date only, the online one six messages", async () => {
      const at = new Date().toISOString();
      vi.mocked(conversations.getConversationHistory).mockReturnValue(
        ["un", "deux", "trois", "quatre", "cinq", "six"].map((content, i) => ({
          id: String(i), conversationId: "c", userId: "u", role: i % 2 ? "assistant" : "user", content, createdAt: at,
        })) as never
      );
      mockCreate.mockResolvedValueOnce(reply("-")).mockResolvedValueOnce(reply("Bonsoir."));
      await localEngine.chat({ message: "bonsoir", userId: "u", isVoice: true });
      const localSent = JSON.stringify(mockCreate.mock.calls[0][0].messages);
      expect(localSent).toContain("cinq");
      expect(localSent).toContain("six");
      expect(localSent).not.toContain("quatre");
      expect(localSent).not.toContain("Date/Time");
      expect(localSent).toContain("date : ");
      const onlineSent = JSON.stringify(mockCreate.mock.calls[1][0].messages);
      expect(onlineSent).toContain("un");
      expect(onlineSent).toContain("quatre");
    });

    it("leaves the live state out of the local prompt", async () => {
      vi.mocked(ha.getEntities).mockResolvedValue([{ entity_id: "light.salon", state: "on", attributes: { friendly_name: "Salon" } }] as never);
      mockCreate.mockResolvedValue(reply("-"));
      await localEngine.chat({ message: "bonsoir", userId: "u", isVoice: true });
      expect(JSON.stringify(mockCreate.mock.calls[0][0].messages)).not.toContain("Live state");
    });

    it("never speaks the local model's words: the online model answers", async () => {
      mockCreate.mockResolvedValueOnce(reply("Je suis Igor, votre majordome.")).mockResolvedValueOnce(reply("Bonsoir, que puis-je pour vous ?"));
      const chunks: string[] = [];
      const r = await localEngine.chat({ message: "bonsoir", userId: "u", isVoice: true }, { onChunk: (c) => chunks.push(c) });
      expect(r.response).toBe("Bonsoir, que puis-je pour vous ?");
      expect(chunks.join("")).toBe("Bonsoir, que puis-je pour vous ?");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("gives the local model a working identity and the online one only the common persona", async () => {
      const engine = new OpenAIChatEngine(
        { ...config, customPrompt: "Tu es Igor, majordome.", customPromptVoice: "STYLE VOCAL.", localLlmUrl: "http://192.168.1.20:8180", localLlmModel: "qwen3-8b", localLlmPrompt: "MINUTEUR : script.minuteur, recipient en secondes.", localOrderReply: "online" },
        memory, conversations, extractor, ha,
        { refreshIfStale: vi.fn(), hasProfiles: () => false } as unknown as DeviceScanner,
        { refreshIfStale: vi.fn(), hasLayout: () => false } as unknown as TopologyScanner
      );
      vi.mocked(handleToolCall).mockResolvedValue({ changed_states: [{ entity_id: "light.salon", state: "on", name: "Lumière salon" }] });
      mockCreate.mockResolvedValueOnce(orderCall()).mockResolvedValueOnce(reply("Voilà."));
      await engine.chat({ message: "allume le salon", userId: "u", isVoice: true, customPrompt: "Tu es Igor, majordome.\n\nSTYLE VOCAL." });
      const localSystem = mockCreate.mock.calls[0][0].messages[0].content;
      expect(localSystem).toContain("Module domotique");
      expect(localSystem).toContain("MINUTEUR : script.minuteur");
      expect(localSystem).not.toContain("majordome");
      const onlineSystem = mockCreate.mock.calls[1][0].messages[0].content;
      expect(onlineSystem).toContain("Tu es Igor, majordome.");
      expect(onlineSystem).not.toContain("STYLE VOCAL.");
    });

    it("says the plain sentence when the online model does not answer", async () => {
      vi.mocked(handleToolCall).mockResolvedValue({ changed_states: [{ entity_id: "light.salon", state: "on", name: "Lumière salon" }] });
      mockCreate.mockResolvedValueOnce(orderCall()).mockRejectedValueOnce(new Error("503"));
      const r = await orderEngine("online").chat({ message: "allume la lumière du salon", userId: "u", isVoice: true });
      expect(r.response).toBe("Lumière salon allumée.");
    });

    it("sends a question that concerns nothing at home to the online model as it was said, with the last exchanges", async () => {
      vi.mocked(conversations.getConversationHistory).mockReturnValue([
        { id: "1", conversationId: "c", userId: "u", role: "user", content: "parle-moi du ciel", createdAt: new Date().toISOString() },
        { id: "2", conversationId: "c", userId: "u", role: "assistant", content: "Il est souvent bleu.", createdAt: new Date().toISOString() },
      ] as never);
      mockCreate.mockResolvedValueOnce(reply("-")).mockResolvedValueOnce(reply("La lumière bleue est diffusée par l'air."));
      const r = await localEngine.chat({ message: "et pourquoi il est bleu ?", userId: "u", isVoice: true, customPrompt: "Tu es Igor." });
      expect(r.response).toBe("La lumière bleue est diffusée par l'air.");
      expect(endpoint(0)).toBe("http://192.168.1.20:8180/v1");
      expect(endpoint(1)).toBe("https://api.openai.com/v1");
      const online = mockCreate.mock.calls[1][0];
      expect(online.tools).toBeUndefined();
      expect(online.messages[0].content).toContain("Tu es Igor.");
      expect(online.messages.slice(1, 3)).toEqual([
        { role: "user", content: "parle-moi du ciel" },
        { role: "assistant", content: "Il est souvent bleu." },
      ]);
      // The local model's "-" with nothing done: the person asked something, Igor answers.
      expect(online.messages.at(-1)).toEqual({ role: "user", content: ">libre\ndit : « et pourquoi il est bleu ? »" });
      expect(online.messages[0].content).toContain("Date et heure actuelles");
    });

    it("keeps panel threads and images on the main model", async () => {
      mockCreate.mockResolvedValue(reply());
      await localEngine.chat({ message: "écris-moi un poème", userId: "u", conversationId: "mado-thread:t1" });
      expect(mockCreate.mock.calls[0][0].model).toBe("gpt-4o-mini");
      expect(endpoint(0)).toBe("https://api.openai.com/v1");
      mockCreate.mockClear();
      await localEngine.chat({ message: "que vois-tu ?", userId: "u", images: ["data:image/png;base64,AAAA"] });
      expect(endpoint(0)).toBe("https://api.openai.com/v1");
    });
  });

  describe("reasoning_effort", () => {
    const reply = () =>
      makeStream([{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }]);

    it("is not sent when unconfigured", async () => {
      mockCreate.mockResolvedValue(reply());

      await engine.chat({ message: "x", userId: "user-1" });

      expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("reasoning_effort");
    });

    it("defaults to none for a spoken turn, so the voice cap is not spent thinking", async () => {
      mockCreate.mockResolvedValue(reply());

      await engine.chat({ message: "qui es-tu ?", userId: "user-1", isVoice: true });

      expect(mockCreate.mock.calls[0][0].reasoning_effort).toBe("none");
    });

    it("keeps an explicit setting on a spoken turn", async () => {
      config.reasoningEffort = "low";
      mockCreate.mockResolvedValue(reply());

      await engine.chat({ message: "x", userId: "user-1", isVoice: true });

      expect(mockCreate.mock.calls[0][0].reasoning_effort).toBe("low");
    });

    it("is sent when configured", async () => {
      config.reasoningEffort = "low";
      mockCreate.mockResolvedValue(reply());

      await engine.chat({ message: "x", userId: "user-1" });

      expect(mockCreate.mock.calls[0][0].reasoning_effort).toBe("low");
    });

    it("is dropped, and stays dropped, for a model that rejects it", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      config.reasoningEffort = "low";
      const rejection = Object.assign(
        new Error("400 Unrecognized request argument supplied: reasoning_effort"),
        { status: 400 }
      );
      mockCreate.mockRejectedValueOnce(rejection).mockImplementation(async () => reply());

      const first = await engine.chat({ message: "x", userId: "user-1" });
      await engine.chat({ message: "y", userId: "user-1" });

      expect(first.response).toBe("hi");
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(mockCreate.mock.calls[0][0].reasoning_effort).toBe("low");
      expect(mockCreate.mock.calls[1][0]).not.toHaveProperty("reasoning_effort");
      expect(mockCreate.mock.calls[2][0]).not.toHaveProperty("reasoning_effort");
    });

    it("surfaces an unrelated 400 instead of retrying", async () => {
      config.reasoningEffort = "low";
      const unrelated = Object.assign(new Error("400 model not found"), { status: 400 });
      mockCreate.mockRejectedValueOnce(unrelated);

      await expect(engine.chat({ message: "x", userId: "user-1" })).rejects.toBe(unrelated);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("works alongside the max_tokens negotiation", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      config.reasoningEffort = "medium";
      const capRejection = Object.assign(
        new Error("400 Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead."),
        { status: 400, param: "max_tokens", code: "unsupported_parameter" }
      );
      const effortRejection = Object.assign(new Error("400 Unknown parameter: reasoning_effort"), {
        status: 400,
        param: "reasoning_effort",
      });
      mockCreate
        .mockRejectedValueOnce(capRejection)
        .mockRejectedValueOnce(effortRejection)
        .mockImplementation(async () => reply());

      const result = await engine.chat({ message: "x", userId: "user-1" });

      expect(result.response).toBe("hi");
      expect(mockCreate).toHaveBeenCalledTimes(3);
      const last = mockCreate.mock.calls[2][0];
      expect(last.max_completion_tokens).toBe(8192);
      expect(last).not.toHaveProperty("max_tokens");
      expect(last).not.toHaveProperty("reasoning_effort");
    });
  });

  it("never replays another user's turns from a thread id it was handed", async () => {
    (conversations.getConversationHistory as ReturnType<typeof vi.fn>).mockReturnValue([
      { userId: "user-2", role: "user", content: "my door code is 1234" },
      { userId: "user-2", role: "assistant", content: "Noted." },
    ]);
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Response" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({ message: "what did I say?", userId: "user-1", conversationId: "mado-thread:x" });

    const sent = JSON.stringify(mockCreate.mock.calls[0][0].messages);
    expect(sent).not.toContain("1234");
  });

  describe("lean mode (the default)", () => {
    const answer = () =>
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: { content: "ok" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );

    it("gives Assist its whole stored conversation and reads facts by tag only", async () => {
      answer();
      await engine.chat({ message: "hello", userId: "user-1", isVoice: true });
      expect(conversations.getConversationHistory).toHaveBeenCalledWith("mado-user:user-1", 20);
      expect(memory.getFactsWithinTokenLimit).toHaveBeenCalledWith("user-1", 1500, undefined);
    });

    it("reads the morning briefing's last two messages only", async () => {
      answer();
      await engine.chat({ message: "résumé", userId: "user-1", conversationId: "mado-thread:morning-briefing", unattended: true });
      expect(conversations.getConversationHistory).toHaveBeenCalledWith("mado-thread:morning-briefing", 2);
    });

    it("reminds a spoken turn to stay short, right before the person's words, unless detail is asked", async () => {
      answer();
      await engine.chat({ message: "Pourquoi le ciel est bleu ?", userId: "user-1", isVoice: true });
      const msgs = mockCreate.mock.calls[0][0].messages as Array<{ role: string; content: string }>;
      expect(msgs.at(-2)?.content).toContain("at most two short sentences");
      mockCreate.mockClear();
      answer();
      await engine.chat({ message: "Explique-moi en détail pourquoi le ciel est bleu", userId: "user-1", isVoice: true });
      expect(JSON.stringify(mockCreate.mock.calls[0][0].messages)).not.toContain("at most two short sentences");
    });

    it("never routes to FAST_MODEL", async () => {
      config.fastModel = "mistral-small-latest";
      answer();
      await engine.chat({ message: "allume la lumière du salon", userId: "user-1", isVoice: true });
      expect(mockCreate.mock.calls[0][0].model).toBe("gpt-4o-mini");
    });

    it("leaves a thread without long-term memory when thread memory is off", async () => {
      config.threadMemory = "off";
      answer();
      await engine.chat({ message: "retiens que j'aime le thé", userId: "user-1", conversationId: "mado-thread:abc" });
      expect(memory.getFactsWithinTokenLimit).not.toHaveBeenCalled();
      expect(extractAndStoreFacts).not.toHaveBeenCalled();
      const sent = mockCreate.mock.calls[0][0] as { tools: Array<{ function: { name: string } }>; messages: Array<{ content: unknown }> };
      expect(sent.tools.map((t) => t.function.name)).not.toContain("forget_memory");
      expect(JSON.stringify(sent.messages)).toContain("this chat thread has no long-term memory");
    });
  });

  describe("memory isolation between Assist and panel threads", () => {
    // The full path, as with lean_mode: false (lean mode has its own tests).
    beforeEach(() => { process.env.LEAN_MODE = "off"; });
    afterEach(() => { delete process.env.LEAN_MODE; });

    const answer = () =>
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: { content: "ok" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );

    it("gives a thread its own history, and the facts Assist knows too", async () => {
      answer();
      await engine.chat({ message: "hello", userId: "user-1", conversationId: "mado-thread:abc" });

      expect(conversations.getConversationHistory).toHaveBeenCalledWith("mado-thread:abc", 20);
      expect(memory.getFactsWithinTokenLimit).toHaveBeenCalledWith("user-1", 1500, "hello");
      expect(vi.mocked(extractAndStoreFacts).mock.calls[0][2]).toBe("user-1");
    });

    it("keeps a thread's facts to itself when thread memory is isolated", async () => {
      config.threadMemory = "isolated";
      answer();
      await engine.chat({ message: "hello", userId: "user-1", conversationId: "mado-thread:abc" });

      expect(memory.getFactsWithinTokenLimit).toHaveBeenCalledWith(
        "user-1@mado-thread.abc",
        1500,
        "hello"
      );
      expect(vi.mocked(extractAndStoreFacts).mock.calls[0][2]).toBe("user-1@mado-thread.abc");
      expect(conversations.storeMessage).toHaveBeenCalledWith(
        "mado-thread:abc",
        "user-1",
        "user",
        "hello"
      );
    });

    it("builds a thread's system prompt in thread mode, Assist's in Assist mode", async () => {
      answer();
      await engine.chat({ message: "hello", userId: "user-1", conversationId: "mado-thread:abc" });
      answer();
      await engine.chat({ message: "hello", userId: "user-1", conversationId: "01HXYZ" });

      const system = (call: number) => mockCreate.mock.calls[call][0].messages[0].content as string;
      expect(system(0)).toContain("THIS CONVERSATION: A CHAT THREAD");
      expect(system(1)).not.toContain("THIS CONVERSATION: A CHAT THREAD");
      expect(system(1)).toContain("PLAIN TEXT ONLY");
    });

    it("keeps Assist on the user's shared conversation and bucket", async () => {
      answer();
      await engine.chat({ message: "hello", userId: "user-1", conversationId: "01HXYZ" });

      expect(conversations.getConversationHistory).toHaveBeenCalledWith("mado-user:user-1", 12);
      expect(memory.getFactsWithinTokenLimit).toHaveBeenCalledWith("user-1", 1500, "hello");
      expect(vi.mocked(extractAndStoreFacts).mock.calls[0][2]).toBe("user-1");
    });
  });

  it("loads conversation history when conversationId provided", async () => {
    process.env.LEAN_MODE = "off";
    (conversations.getConversationHistory as ReturnType<typeof vi.fn>).mockReturnValue([
      { userId: "user-1", role: "user", content: "previous question" },
      { userId: "user-1", role: "assistant", content: "previous answer" },
    ]);

    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Response" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({
      message: "follow up",
      userId: "user-1",
      conversationId: "conv-1",
    });

    expect(conversations.getConversationHistory).toHaveBeenCalledWith("mado-user:user-1", 12);

    // Check messages passed to OpenAI include history
    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "previous question" }),
        expect.objectContaining({
          role: "assistant",
          content: "previous answer",
        }),
      ])
    );
  });

  it("stamps only the user's history turns with a time marker, never its own replies", async () => {
    // A stamped assistant entry taught the model to open every answer with
    // a recited "[09:12]": it imitates its own past replies.
    (conversations.getConversationHistory as ReturnType<typeof vi.fn>).mockReturnValue([
      { userId: "user-1", role: "user", content: "allume la lumière", createdAt: new Date() },
      { userId: "user-1", role: "assistant", content: "La lumière du salon est allumée.", createdAt: new Date() },
    ]);

    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Response" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({ message: "follow up", userId: "user-1" });

    const createCall = mockCreate.mock.calls[0][0];
    const historyUser = createCall.messages.filter(
      (m: { role: string; content: string }) =>
        m.role === "user" && m.content.includes("allume la lumière")
    );
    expect(historyUser).toHaveLength(1);
    expect(historyUser[0].content).toMatch(
      /^\[(?:\d{1,2} [A-Za-z]{3}, )?\d{2}:\d{2}\] allume la lumière$/
    );

    const historyAssistant = createCall.messages.filter(
      (m: { role: string; content: string }) =>
        m.role === "assistant" && m.content.includes("allumée")
    );
    expect(historyAssistant).toHaveLength(1);
    expect(historyAssistant[0].content).toBe("La lumière du salon est allumée.");
  });

  it("stores user and assistant messages when conversationId present", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Hi!" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({
      message: "Hello",
      userId: "user-1",
      conversationId: "conv-1",
    });

    expect(conversations.storeMessage).toHaveBeenCalledWith(
      "mado-user:user-1",
      "user-1",
      "user",
      "Hello"
    );
    expect(conversations.storeMessage).toHaveBeenCalledWith(
      "mado-user:user-1",
      "user-1",
      "assistant",
      "Hi!"
    );
  });

  it("stores messages in shared history when conversationId is absent", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Hi!" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({ message: "Hello", userId: "user-1" });

    expect(conversations.storeMessage).toHaveBeenCalledWith("mado-user:user-1", "user-1", "user", "Hello");
    expect(conversations.storeMessage).toHaveBeenCalledWith("mado-user:user-1", "user-1", "assistant", "Hi!");
  });

  it("gives a mado-thread: id its own conversation, isolated from Assist", async () => {
    // The thread panel sends "mado-thread:" ids: each thread keeps its own
    // short-term history; only long-term memory is shared.
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Hi!" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({
      message: "Hello",
      userId: "user-1",
      conversationId: "mado-thread:t-1",
    });

    expect(conversations.getConversationHistory).toHaveBeenCalledWith("mado-thread:t-1", 20);
    expect(conversations.storeMessage).toHaveBeenCalledWith(
      "mado-thread:t-1",
      "user-1",
      "user",
      "Hello"
    );
    expect(conversations.storeMessage).toHaveBeenCalledWith(
      "mado-thread:t-1",
      "user-1",
      "assistant",
      "Hi!"
    );
  });

  it("uses the spoken ceiling (4096) for voice mode", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Short" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({
      message: "Hi",
      userId: "user-1",
      isVoice: true,
    });

    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.max_tokens).toBe(4096);
  });

  it("honours a configured output cap, which OPENAI_MAX_TOKENS never reached before", async () => {
    // The documented setting only ever reached the fact extractor, so a user
    // whose replies were being truncated could set it and see no change.
    config.maxOutputTokens = 8000;
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Hi!" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({ message: "Hello", userId: "user-1" });

    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(8000);
  });

  it("uses max_tokens 8192 for non-voice mode", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Long" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({ message: "Hi", userId: "user-1" });

    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.max_tokens).toBe(8192);
  });

  it("retries with max_completion_tokens when the model rejects max_tokens (issue #60)", async () => {
    const rejection = Object.assign(
      new Error(
        "400 Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
      ),
      { status: 400, param: "max_tokens", code: "unsupported_parameter" }
    );
    mockCreate.mockRejectedValueOnce(rejection).mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Hello" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    const result = await engine.chat({ message: "Hi", userId: "user-1" });

    expect(result.response).toBe("Hello");
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(8192);
    expect(mockCreate.mock.calls[0][0].max_completion_tokens).toBeUndefined();
    expect(mockCreate.mock.calls[1][0].max_completion_tokens).toBe(8192);
    expect(mockCreate.mock.calls[1][0].max_tokens).toBeUndefined();
  });

  it("fires extractAndStoreFacts after response", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Response" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({ message: "Remember I like 22°C", userId: "user-1" });

    expect(extractAndStoreFacts).toHaveBeenCalledWith(
      memory,
      extractor,
      "user-1",
      "Remember I like 22°C",
      "Response",
      undefined // no forget_memory in this turn → nothing to filter out
    );
  });

  it("catches extraction errors without failing the response", async () => {
    vi.mocked(extractAndStoreFacts).mockRejectedValue(
      new Error("extraction failed")
    );

    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "OK" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    // Should not throw
    const result = await engine.chat({ message: "Hi", userId: "user-1" });
    expect(result.response).toBe("OK");

    // Wait for the fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 10));
  });

  it("skips empty choices in stream", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [] },
        { choices: [{ delta: { content: "data" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    const result = await engine.chat({ message: "Hi", userId: "user-1" });

    expect(result.response).toBe("data");
  });

  it("includes customPrompt in system message when provided", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Hey!" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({
      message: "Hi",
      userId: "user-1",
      customPrompt: "You are Ava, a sarcastic AI.",
    });

    const createCall = mockCreate.mock.calls[0][0];
    const systemMsg = createCall.messages[0];
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toMatch(/^You are Ava, a sarcastic AI\./);
    expect(systemMsg.content).not.toContain("You are Igor, a helpful smart home assistant");
  });

  it("uses default identity when customPrompt absent", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Hi" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    await engine.chat({ message: "Hi", userId: "user-1" });

    const createCall = mockCreate.mock.calls[0][0];
    const systemMsg = createCall.messages[0];
    expect(systemMsg.content).toContain("You are Igor, a helpful smart home assistant");
  });

  it("returns factsLearned as 0", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { choices: [{ delta: { content: "Hi" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    const result = await engine.chat({ message: "Hi", userId: "user-1" });

    expect(result.factsLearned).toBe(0);
  });

  describe("empty-response diagnostics", () => {
    it("attaches EMPTY_CONTENT error when finish_reason=stop with no text and no tool calls", async () => {
      mockCreate.mockResolvedValue(
        makeStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" });

      expect(result.response).toBe("");
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("EMPTY_CONTENT");
      expect(result.error?.hint).toMatch(/OpenAI-compatible|tool calls/);
    });

    it("attaches MAX_TOKENS_TRUNCATED error when finish_reason=length with empty text", async () => {
      mockCreate.mockResolvedValue(
        makeStream([{ choices: [{ delta: {}, finish_reason: "length" }] }])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" });

      expect(result.error?.code).toBe("MAX_TOKENS_TRUNCATED");
      expect(result.error?.hint).toMatch(/ran out of room/);
    });

    it("blames reasoning only when the provider reports reasoning tokens", async () => {
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: {}, finish_reason: "length" }] },
          {
            choices: [],
            usage: {
              prompt_tokens: 45231,
              completion_tokens: 4096,
              completion_tokens_details: { reasoning_tokens: 3612 },
            },
          },
        ])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" });

      expect(result.error?.code).toBe("MAX_TOKENS_TRUNCATED");
      expect(result.error?.hint).toMatch(/working the problem out/);
    });

    it("does not blame reasoning when the count is absent", async () => {
      // An endpoint that reports no reasoning tokens is not telling us there
      // were none, so the answer must not claim the model was thinking.
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: {}, finish_reason: "length" }] },
          { choices: [], usage: { prompt_tokens: 900, completion_tokens: 4096 } },
        ])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" });

      expect(result.error?.hint).not.toMatch(/working the problem out/);
      expect(result.error?.hint).toMatch(/ran out of room/);
    });

    it("says so when a written answer was cut off part way", async () => {
      // The integration returns the text whenever there is any, so `error` never
      // reaches the reader. Without this the sentence simply stops.
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: { content: "The kitchen sensor reads" }, finish_reason: "length" }] },
        ])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" });

      expect(result.response).toContain("The kitchen sensor reads");
      expect(result.response).toContain("ran out of room");
      expect(result.error).toBeUndefined();
    });

    it("does not read an internal token-limit notice aloud", async () => {
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: { content: "It is 21 degrees" }, finish_reason: "length" }] },
        ])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1", isVoice: true });

      expect(result.response).toBe("It is 21 degrees");
      expect(result.response).not.toMatch(/tokens|ran out of room|add-on settings/i);
    });

    it("leaves a complete answer untouched", async () => {
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: { content: "It is 21 degrees." }, finish_reason: "stop" }] },
        ])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" });

      expect(result.response).toBe("It is 21 degrees.");
    });

    it("cuts a spoken reply that starts looping, and drops its emojis", async () => {
      const loop =
        "Le minuteur est lancé, monsieur. Bonne nuit. 🌙 --- *Je corrige :* Le minuteur est lancé, monsieur. Bonne nuit.";
      mockCreate.mockResolvedValue(
        makeStream([
          ...loop.match(/.{1,9}/gs)!.map((part) => ({ choices: [{ delta: { content: part } }] })),
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );
      const spoken: string[] = [];

      const result = await engine.chat({ message: "Hi", userId: "user-1", isVoice: true }, (c) => spoken.push(c));

      expect(result.response.trim()).toBe("Le minuteur est lancé, monsieur. Bonne nuit.");
      expect(spoken.join("").trim()).toBe("Le minuteur est lancé, monsieur. Bonne nuit.");
    });

    it("stays silent, and keeps nothing, on a sentence not said to Igor", async () => {
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: { content: "NOT_" } }] },
          { choices: [{ delta: { content: "FOR_ME" } }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );
      vi.mocked(conversations.storeMessage).mockReturnValue("m1" as never);
      const deleteMessagesFrom = vi.fn().mockReturnValue(1);
      (conversations as unknown as { deleteMessagesFrom: unknown }).deleteMessagesFrom = deleteMessagesFrom;
      const spoken: string[] = [];

      const result = await engine.chat(
        { message: "Igor, euh, non rien", userId: "user-1", isVoice: true, conversationId: "mado-user:user-1" },
        (c) => spoken.push(c)
      );

      expect(result.notForMe).toBe(true);
      expect(result.response).toBe("");
      expect(result.error).toBeUndefined();
      expect(spoken.join("")).toBe("");
      expect(deleteMessagesFrom).toHaveBeenCalledWith(expect.any(String), "user-1", "m1");
      expect(vi.mocked(conversations.storeMessage).mock.calls.filter((c) => c[2] === "assistant")).toHaveLength(0);
      expect(extractAndStoreFacts).not.toHaveBeenCalled();
    });

    it("never calls the main model for a sentence a small check finds is only about Igor", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"pour_igor": false}' } }],
        usage: { prompt_tokens: 300, completion_tokens: 8 },
      });
      const spoken: string[] = [];

      const result = await engine.chat(
        { message: "c'est Igor l'autre jour qui a fait ça", userId: "user-1", isVoice: true, conversationId: "mado-user:user-1" },
        (c) => spoken.push(c)
      );

      expect(result.notForMe).toBe(true);
      expect(result.response).toBe("");
      expect(spoken.join("")).toBe("");
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const check = mockCreate.mock.calls[0][0] as { max_tokens: number; stream?: boolean; messages: Array<{ content: string }> };
      expect(check.max_tokens).toBeLessThanOrEqual(16);
      expect(check.stream).toBeUndefined();
      expect(check.messages[1].content).toContain("c'est Igor l'autre jour qui a fait ça");
      expect(conversations.storeMessage).not.toHaveBeenCalled();
      expect(extractAndStoreFacts).not.toHaveBeenCalled();
    });

    it("answers normally when the check finds the sentence is said to Igor", async () => {
      mockCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: '{"pour_igor": true}' } }] })
        .mockResolvedValueOnce(
          makeStream([{ choices: [{ delta: { content: "Il est midi." }, finish_reason: "stop" }] }])
        );

      const result = await engine.chat({ message: "quelle heure est-il, Igor ?", userId: "user-1", isVoice: true });

      expect(result.notForMe).toBeUndefined();
      expect(result.response).toBe("Il est midi.");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("answers when the check fails, and skips it when the name opens the sentence", async () => {
      mockCreate
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValue(makeStream([{ choices: [{ delta: { content: "Oui." }, finish_reason: "stop" }] }]));

      const failed = await engine.chat({ message: "tu sais quoi Igor ?", userId: "user-1", isVoice: true });
      expect(failed.response).toBe("Oui.");
      expect(mockCreate).toHaveBeenCalledTimes(2);

      mockCreate.mockClear();
      await engine.chat({ message: "Igor, quelle heure est-il ?", userId: "user-1", isVoice: true });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("leaves a written reply as the model wrote it when it is not looping", async () => {
      mockCreate.mockResolvedValue(
        makeStream([{ choices: [{ delta: { content: "Fait. 🌙 --- Fait." }, finish_reason: "stop" }] }])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" });

      expect(result.response).toBe("Fait. 🌙 --- Fait.");
    });

    it("keeps a written reply whose sentence comes back once", async () => {
      const chunks: string[] = [];
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: { content: "J'ai trouvé le dépôt. " }, finish_reason: null }] },
          { choices: [{ delta: { content: "Voici le résultat. " }, finish_reason: null }] },
          { choices: [{ delta: { content: "J'ai trouvé le dépôt. Et voilà." }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" }, (c) => chunks.push(c));

      expect(result.response).toBe("J'ai trouvé le dépôt. Voici le résultat. J'ai trouvé le dépôt. Et voilà.");
      expect(chunks.join("")).toBe(result.response);
    });

    it("continues a thread reply that hit the output cap, as one message", async () => {
      const chunks: string[] = [];
      mockCreate
        .mockResolvedValueOnce(makeStream([{ choices: [{ delta: { content: "| A | 1 |\n| B" }, finish_reason: "length" }] }]))
        .mockResolvedValueOnce(makeStream([{ choices: [{ delta: { content: " | 2 |\n\nFin." }, finish_reason: "stop" }] }]));

      const result = await engine.chat({ message: "Un tableau", userId: "user-1", conversationId: "mado-thread:t1" }, (c) => chunks.push(c));

      expect(result.response).toBe("| A | 1 |\n| B | 2 |\n\nFin.");
      expect(chunks.join("")).toBe(result.response);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      const second = mockCreate.mock.calls[1][0] as { messages: Array<{ role: string; content: unknown }>; max_tokens?: number; max_completion_tokens?: number };
      expect(second.messages.at(-2)).toEqual({ role: "assistant", content: "| A | 1 |\n| B" });
      expect(second.messages.at(-1)?.role).toBe("user");
      expect(second.max_tokens ?? second.max_completion_tokens).toBe(16384);
    });

    it("asks the endpoint for a usage breakdown on every streamed call", async () => {
      mockCreate.mockResolvedValue(
        makeStream([{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }])
      );

      await engine.chat({ message: "Hi", userId: "user-1" });

      expect(mockCreate.mock.calls[0][0].stream_options).toEqual({
        include_usage: true,
      });
    });

    it("attaches CONTENT_FILTERED error when finish_reason=content_filter with empty text", async () => {
      mockCreate.mockResolvedValue(
        makeStream([{ choices: [{ delta: {}, finish_reason: "content_filter" }] }])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" });

      expect(result.error?.code).toBe("CONTENT_FILTERED");
    });

    it("does NOT attach error when the model returns text", async () => {
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: { content: "Done" }, finish_reason: "stop" }] },
        ])
      );

      const result = await engine.chat({ message: "Hi", userId: "user-1" });

      expect(result.response).toBe("Done");
      expect(result.error).toBeUndefined();
    });
  });

  describe("shared tool context & extraction suppression", () => {
    const toolCallTurn = (name: string, args: string) =>
      makeStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: "call-1", function: { name, arguments: args } }],
              },
              finish_reason: null,
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ]);

    it("passes forgetTargets from the turn's tool calls into extraction", async () => {
      // Extraction still RUNS on a forget turn (so "…my name is now Y" is
      // learned); the touched memory is handed over to be filtered out.
      vi.mocked(handleToolCall).mockImplementation(
        async (_ha, _name, _input, ctx?: { forgetTargets?: string[] }) => {
          if (ctx) ctx.forgetTargets = ["User's name is X"];
          return { confirmation_required: true };
        }
      );
      mockCreate.mockResolvedValueOnce(toolCallTurn("forget_memory", '{"query":"my name is X"}'));
      mockCreate.mockResolvedValueOnce(
        makeStream([
          { choices: [{ delta: { content: "Shall I forget it?" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );

      await engine.chat({ message: "forget that my name is X", userId: "user-1" });

      expect(handleToolCall).toHaveBeenCalledTimes(1);
      expect(extractAndStoreFacts).toHaveBeenCalledWith(
        memory,
        extractor,
        "user-1",
        "forget that my name is X",
        "Shall I forget it?",
        ["User's name is X"]
      );
    });

    it("passes undefined forgetTargets on an ordinary turn", async () => {
      mockCreate.mockResolvedValue(
        makeStream([
          { choices: [{ delta: { content: "Hi" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );

      await engine.chat({ message: "Hello", userId: "user-1" });

      expect(extractAndStoreFacts).toHaveBeenCalledWith(
        memory, extractor, "user-1", "Hello", "Hi", undefined
      );
    });

    it("passes the SAME context object to every tool call in a turn", async () => {
      mockCreate.mockResolvedValueOnce(
        makeStream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call-1", function: { name: "get_state", arguments: '{"entity_id":"a.b"}' } },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 1, id: "call-2", function: { name: "get_state", arguments: '{"entity_id":"c.d"}' } },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      );
      mockCreate.mockResolvedValueOnce(
        makeStream([
          { choices: [{ delta: { content: "done" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ])
      );

      await engine.chat({ message: "check both", userId: "user-1", conversationId: "conv-1" });

      const calls = vi.mocked(handleToolCall).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][3]).toBe(calls[1][3]);
      expect(calls[0][3]).toMatchObject({ userId: "user-1", conversationId: "mado-user:user-1", memory });
    });
  });
});

describe("stream events: turn boundaries and the long-lookup heads-up", () => {
  // The bare-function form of the second argument is the old API; these use
  // the events object. Both are accepted.
  let engine: OpenAIChatEngine;

  const toolCallStream = (name: string, args: Record<string, unknown>, text?: string) =>
    makeStream([
      ...(text ? [{ choices: [{ delta: { content: text }, finish_reason: null }] }] : []),
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "c1", function: { name, arguments: JSON.stringify(args) } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
  const answerStream = (text: string) =>
    makeStream([
      { choices: [{ delta: { content: text }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
  const weekAgo = () => new Date(Date.now() - 7 * 86400000).toISOString();

  beforeEach(() => {
    resetTokenCapCache();
    mockCreate.mockReset();
    vi.mocked(handleToolCall).mockReset().mockResolvedValue({ kind: "raw", points: [] });
    const config = {
      llmProvider: "openai",
      llmModel: "gpt-test",
      openaiApiKey: "k",
      memoryTokenLimit: 1500,
      logLevel: "info",
    } as Config;
    const memory = { getFactsWithinTokenLimit: vi.fn().mockResolvedValue([]) } as unknown as IMemoryStore;
    const conversations = {
      getConversationHistory: vi.fn().mockReturnValue([]),
      storeMessage: vi.fn(),
    } as unknown as IConversationStore;
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
    engine = new OpenAIChatEngine(
      config,
      memory,
      conversations,
      {} as IFactExtractor,
      {} as HomeAssistantClient,
      scanner,
      topology
    );
  });

  it("sends the heads-up before a week-long history batch the model did not announce itself", async () => {
    mockCreate
      .mockResolvedValueOnce(toolCallStream("get_history", { entity_id: "sensor.voc", start_time: weekAgo() }))
      .mockResolvedValueOnce(answerStream("VOC peaks every evening."));
    const events: string[] = [];
    const result = await engine.chat(
      { message: "analyse VOC", userId: "u" },
      {
        onTurn: () => events.push("turn"),
        onStatus: (t) => events.push(`status:${t}`),
        onChunk: (t) => events.push(`chunk:${t}`),
      }
    );
    expect(events).toEqual([
      "turn",
      "status:Give me a moment. I'm reading 7 days of history from one sensor.",
      "turn",
      "chunk:VOC peaks every evening.",
    ]);
    // The heads-up is not part of the reply.
    expect(result.response).toBe("VOC peaks every evening.");
  });

  it("stays quiet when the model wrote its own sentence before the batch", async () => {
    mockCreate
      .mockResolvedValueOnce(
        toolCallStream("get_history", { entity_id: "sensor.voc", start_time: weekAgo() }, "Give me a moment, reading a week of VOC.")
      )
      .mockResolvedValueOnce(answerStream("Done."));
    const events: string[] = [];
    await engine.chat(
      { message: "analyse VOC", userId: "u" },
      { onStatus: (t) => events.push(`status:${t}`), onChunk: (t) => events.push(`chunk:${t}`) }
    );
    expect(events).toEqual(["chunk:Give me a moment, reading a week of VOC.", "chunk:Done."]);
  });

  it("never sends a heads-up for a quick action", async () => {
    mockCreate
      .mockResolvedValueOnce(toolCallStream("call_service", { domain: "light", service: "turn_off", entity_id: "light.kitchen" }))
      .mockResolvedValueOnce(answerStream("The kitchen light is off."));
    const status: string[] = [];
    const result = await engine.chat(
      { message: "turn off the kitchen light", userId: "u" },
      { onStatus: (t) => status.push(t) }
    );
    expect(status).toEqual([]);
    expect(result.response).toBe("The kitchen light is off.");
  });

  it("still accepts a bare onChunk function", async () => {
    mockCreate.mockResolvedValueOnce(answerStream("Hi there."));
    const chunks: string[] = [];
    await engine.chat({ message: "hi", userId: "u" }, (c) => chunks.push(c));
    expect(chunks).toEqual(["Hi there."]);
  });
});

describe("OpenRouter session affinity", () => {
  const build = (baseUrl?: string) => {
    const config = {
      llmProvider: "openai",
      llmModel: "gpt-test",
      openaiApiKey: "k",
      openaiBaseUrl: baseUrl,
      memoryTokenLimit: 1500,
      logLevel: "info",
    } as Config;
    const memory = { getFactsWithinTokenLimit: vi.fn().mockResolvedValue([]) } as unknown as IMemoryStore;
    const conversations = {
      getConversationHistory: vi.fn().mockReturnValue([]),
      storeMessage: vi.fn(),
    } as unknown as IConversationStore;
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
    return new OpenAIChatEngine(config, memory, conversations, {} as IFactExtractor, {} as HomeAssistantClient, scanner, topology);
  };
  const reply = () =>
    makeStream([
      { choices: [{ delta: { content: "ok" }, finish_reason: null }], provider: "OpenAI" },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);

  beforeEach(() => {
    resetTokenCapCache();
    mockCreate.mockReset();
  });

  it("sends the conversation id as session_id when the endpoint is OpenRouter", async () => {
    mockCreate.mockResolvedValueOnce(reply());
    await build("https://openrouter.ai/api/v1").chat({ message: "hi", userId: "u", conversationId: "conv-9" });
    expect(mockCreate.mock.calls[0][0].session_id).toBe("conv-9");
  });

  it("sends no session_id to any other OpenAI-compatible endpoint", async () => {
    mockCreate.mockResolvedValueOnce(reply());
    await build("http://homeassistant:11434/v1").chat({ message: "hi", userId: "u", conversationId: "conv-9" });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("session_id");
  });

  it("names the serving provider in the turn log when the chunks carry it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce(reply());
    const engine = build("https://openrouter.ai/api/v1");
    (engine as unknown as { config: Config }).config.logLevel = "debug";
    await engine.chat({ message: "hi", userId: "u", conversationId: "conv-9" });
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("turn ok"));
    expect(line).toContain("provider=OpenAI");
    log.mockRestore();
  });
});
