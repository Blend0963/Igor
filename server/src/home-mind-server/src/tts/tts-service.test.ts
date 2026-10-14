import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAITtsService, MistralTtsService, createTtsService, MISTRAL_TTS_MODEL } from "./tts-service.js";
import type { Config } from "../config.js";

// The audio format has to be asked for by name. OpenAI's own API defaults to
// MP3, but an OpenAI-compatible endpoint need not — the one behind the add-on's
// cloud voice defaults to raw PCM. Left unset, /api/tts serves PCM bytes as
// audio/mpeg and every caller, the HA text-to-speech entity included, plays
// noise. Nothing else in the stack can detect that, so it is pinned here.

describe("OpenAITtsService", () => {
  function serviceWithSpy() {
    const create = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));
    const svc = new OpenAITtsService("k", "some/model", "some-voice", "https://example.invalid/v1");
    (svc as unknown as { client: { audio: { speech: { create: typeof create } } } }).client = {
      audio: { speech: { create } },
    };
    return { svc, create };
  }

  it("always asks for mp3", async () => {
    const { svc, create } = serviceWithSpy();
    await svc.synthesize("Dober dan.");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: "mp3" })
    );
  });

  it("passes the configured model and voice through unchanged", async () => {
    const { svc, create } = serviceWithSpy();
    await svc.synthesize("Dober dan.");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "some/model", voice: "some-voice", input: "Dober dan." })
    );
  });

  it("spells whole numbers and initialisms out on the way to the voice", async () => {
    // The reply the user sees keeps its digits and its "PM2,5"; only what the voice receives changes.
    const create = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));
    const svc = new OpenAITtsService("k", "m", "v", "https://example.invalid/v1", "sl");
    (svc as unknown as { client: { audio: { speech: { create: typeof create } } } }).client = {
      audio: { speech: { create } },
    };
    await svc.synthesize("VOC je 156 enot, PM2,5 pa 8,6 mikrograma.");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ input: "ve o ce je sto šestinpetdeset enot, pe em 2,5 pa 8,6 mikrograma." })
    );
  });

  it("leaves the text alone when the voice is not Slovene", async () => {
    const create = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));
    const svc = new OpenAITtsService("k", "m", "v", "https://example.invalid/v1", "en");
    (svc as unknown as { client: { audio: { speech: { create: typeof create } } } }).client = {
      audio: { speech: { create } },
    };
    await svc.synthesize("156 units");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ input: "156 units" }));
  });

  it("returns the audio as a Buffer", async () => {
    const { svc } = serviceWithSpy();
    expect(Buffer.isBuffer(await svc.synthesize("Dober dan."))).toBe(true);
  });
});

describe("MistralTtsService (Voxtral)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to /audio/speech and decodes base64 audio_data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ audio_data: Buffer.from("mp3!").toString("base64") }), { headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const audio = await new MistralTtsService("k", MISTRAL_TTS_MODEL, "voice-1").synthesize("Bonjour");
    expect(audio.toString()).toBe("mp3!");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.mistral.ai/v1/audio/speech");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: MISTRAL_TTS_MODEL, voice_id: "voice-1", response_format: "mp3", input: "Bonjour" });
  });

  it("accepts a raw audio body too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.from("raw"), { headers: { "content-type": "audio/mpeg" } })));
    expect((await new MistralTtsService("k", "m", undefined).synthesize("x")).toString()).toBe("raw");
  });

  it("is built from the Mistral key, ignoring the OpenAI defaults", () => {
    const svc = createTtsService({ ttsProvider: "mistral", mistralApiKey: "k", ttsModel: "tts-1", ttsVoice: "alloy" } as Config);
    expect(svc).toBeInstanceOf(MistralTtsService);
    expect((svc as unknown as { model: string; voice?: string }).model).toBe(MISTRAL_TTS_MODEL);
    expect((svc as unknown as { voice?: string }).voice).toBeUndefined();
    expect(createTtsService({ ttsProvider: "mistral", ttsModel: "tts-1", ttsVoice: "alloy" } as Config)).toBeNull();
  });
});
