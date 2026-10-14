/**
 * Text-to-speech service.
 * Currently only the OpenAI TTS API is supported.
 * When TTS_PROVIDER is not set (or "none"), the service is disabled
 * and the /api/tts endpoint returns 501.
 */

import OpenAI from "openai";
import type { Config } from "../config.js";
import { spellNumbersForSpeech } from "./number-words.js";
import { spellInitialismsForSpeech } from "./initialisms.js";

/**
 * Everything that changes between the reply the user reads and the text the voice is given.
 * Initialisms first, so the digits they carry ("PM10") are already free-standing when the
 * number speller looks at them. Nothing here touches what Home Assistant displays.
 */
export function prepareTextForSpeech(text: string, language?: string): string {
  return spellNumbersForSpeech(spellInitialismsForSpeech(text, language), language);
}

export interface ITtsService {
  synthesize(text: string, language?: string): Promise<Buffer>;
}

export class OpenAITtsService implements ITtsService {
  private client: OpenAI;
  private model: string;
  private voice: string;

  private language?: string;

  constructor(apiKey: string, model: string, voice: string, baseUrl?: string, language?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
    this.model = model;
    this.voice = voice;
    this.language = language;
  }

  async synthesize(text: string, language?: string): Promise<Buffer> {
    // OpenAI TTS detects language automatically from input text — no explicit language param needed.
    // Numbers and initialisms are the exception: the voice inflects a bare numeral for a case
    // the sentence never asked for ("156 enot" spoken "sto šestinpetdesetih enot") and runs
    // the letters of "CO2" into a non-word, so both are spelled out here, on the way to the
    // voice only. What the caller displays keeps its digits and its "PM2,5".
    const spoken = prepareTextForSpeech(text, language ?? this.language);
    const response = await this.client.audio.speech.create({
      model: this.model,
      // Cast because the SDK's type lists only OpenAI's own voices, while the
      // voice name is whatever the configured endpoint accepts.
      voice: this.voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
      input: spoken,
      // Must be explicit. OpenAI defaults to MP3, but an OpenAI-compatible
      // endpoint need not: at least one defaults to raw PCM, which /api/tts
      // would then serve as audio/mpeg and every caller would play as noise.
      response_format: "mp3",
    });
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

/**
 * Voxtral TTS on Mistral's API (`POST /v1/audio/speech`). The response is
 * JSON carrying the audio as base64 (`audio_data`); a raw audio body is
 * accepted as well, so a change on Mistral's side cannot turn speech into
 * noise.
 */
export const MISTRAL_TTS_MODEL = "voxtral-mini-tts-latest";

export class MistralTtsService implements ITtsService {
  constructor(
    private apiKey: string,
    private model: string,
    private voice: string | undefined,
    private baseUrl = "https://api.mistral.ai/v1",
    private language?: string
  ) {}

  async synthesize(text: string, language?: string): Promise<Buffer> {
    const spoken = prepareTextForSpeech(text, language ?? this.language);
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        input: spoken.slice(0, 4000),
        ...(this.voice ? { voice_id: this.voice } : {}),
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`Mistral TTS returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("json")) {
      const payload = (await response.json()) as { audio_data?: unknown; audio?: unknown };
      const b64 = typeof payload.audio_data === "string" ? payload.audio_data : typeof payload.audio === "string" ? payload.audio : "";
      if (!b64) throw new Error("Mistral TTS returned no audio");
      return Buffer.from(b64, "base64");
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

export function createTtsService(config: Config): ITtsService | null {
  if (config.ttsProvider === "none") return null;

  if (config.ttsProvider === "mistral") {
    const key = config.ttsApiKey ?? config.mistralApiKey;
    if (!key) return null;
    // The OpenAI defaults ("tts-1", "alloy") mean "not chosen" here.
    const model = config.ttsModel && config.ttsModel !== "tts-1" ? config.ttsModel : MISTRAL_TTS_MODEL;
    const voice = config.ttsVoice && config.ttsVoice !== "alloy" ? config.ttsVoice : undefined;
    return new MistralTtsService(key, model, voice, config.ttsBaseUrl, config.ttsLanguage);
  }

  const apiKey = config.ttsApiKey ?? config.openaiApiKey;
  if (!apiKey) return null;

  return new OpenAITtsService(
    apiKey,
    config.ttsModel,
    config.ttsVoice,
    config.ttsBaseUrl ?? config.openaiBaseUrl,
    config.ttsLanguage
  );
}
