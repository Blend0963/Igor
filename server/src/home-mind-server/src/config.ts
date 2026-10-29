import { z } from "zod";

/** "a, b ,c" → ["a", "b", "c"]; nothing → undefined. */
const splitList = (v: string | undefined): string[] | undefined => {
  const items = (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return items.length ? items : undefined;
};

const ConfigSchema = z
  .object({
    // Server
    port: z.coerce.number().default(3100),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // LLM
    // cloud = key managed via nives.house; byok = user's own key. Set by the
    // add-on's options-to-env.sh; standalone deployments default to byok.
    llmMode: z.enum(["cloud", "byok"]).default("byok"),
    llmProvider: z.enum(["anthropic", "openai", "ollama"]).default("anthropic"),
    llmModel: z.string().default("claude-haiku-4-5-20251001"),
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    openaiBaseUrl: z.string().url().optional(),
    // Optional Mistral key for the native Conversations API web_search tool.
    mistralApiKey: z.string().optional(),

    // OpenAI fact-extractor tuning (applies only to OpenAIFactExtractor — chat
    // returns free-form text and ignores these). Some OpenAI-compatible
    // providers (notably qwen3.6:27b via Ollama) emit empty content unless
    // JSON mode is requested; some local models need a larger output budget.
    openaiResponseFormat: z.enum(["json_object"]).optional(),
    openaiMaxTokens: z.coerce.number().int().positive().optional(),
    // Ceiling on a single reply, for both engines. Reasoning models spend this
    // budget thinking before they answer, so a tight cap can truncate a reply
    // that had barely started.
    maxOutputTokens: z.coerce.number().int().positive().optional(),
    // How much a reasoning model thinks before it answers, sent as
    // `reasoning_effort` on OpenAI-compatible calls (chat and fact extraction).
    // That thinking is spent from the output cap above, so voice turns want it
    // low. Unset sends nothing and leaves the model on its own default.
    reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high"]).optional(),
    // Reasoning in chat-panel threads, where an answer may take a few seconds
    // more and be worth it (Mistral Large 4's hybrid reasoning). Assist keeps
    // reasoningEffort above; "none" turns it off here too.
    threadReasoning: z.enum(["none", "low", "medium", "high"]).default("high"),
    // Dedicated model for the post-turn fact-extraction pass. Unset = the
    // main chat model. The extraction pass is short and structured, so it
    // can run on a much cheaper model (e.g. ministral-8b-latest on Mistral)
    // without making the main answers any less smart.
    extractionModel: z.string().optional(),
    // Cheaper model for plain commands and quick state questions
    // (llm/model-router.ts). Unset = every request on the main model.
    fastModel: z.string().optional(),
    // The house's own model for Assist (llm/local-llm.ts): llama.cpp's server
    // on the audio VM. Unset = Assist on the main model, as before.
    localLlmUrl: z.string().url("LOCAL_LLM_URL must be a URL like http://192.168.1.20:8180").optional(),
    localLlmKey: z.string().optional(),
    // llama.cpp serves one model whatever the name; it shows in the logs and usage.
    localLlmModel: z.string().default("qwen3-8b"),
    // The owner's working rules for the local model (scripts, contacts…), no persona.
    localLlmPrompt: z.string().optional(),
    // A plain order done by the local model: the server's sentence, nothing,
    // or the online model's wording.
    localOrderReply: z.enum(["sentence", "silent", "online"]).default("sentence"),
    // Read the next spoken request's prompt ahead of time (llm/openai-client.ts prewarm).
    localLlmPrewarm: z.boolean().default(true),
    // Reminders, scheduled tasks and the morning briefing (jobs/scheduler.ts).
    // Notify service for them ("mobile_app_pixel"); unset = a persistent
    // notification in Home Assistant.
    notifyService: z.string().optional(),
    dailyBriefingTime: z.string().regex(/^\d{1,2}:\d{2}$/, "DAILY_BRIEFING_TIME must be HH:MM").optional(),
    dailyBriefingPrompt: z.string().optional(),
    // Whose briefing it is: the user id the panel and Assist use.
    briefingUserId: z.string().default("default"),
    // The house watch (jobs/house-watch.ts): off, on (the entities Igor may
    // see) or all (the whole house); quiet hours, a daily cap on non-urgent
    // notifications, and the optional daily "anything useful to say?" time.
    houseWatch: z.enum(["off", "on", "all"]).default("off"),
    watchQuietHours: z
      .string()
      .regex(/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/, "WATCH_QUIET_HOURS must be HH:MM-HH:MM")
      .default("22:00-07:00"),
    watchMaxPerDay: z.coerce.number().int().min(1).max(50).default(5),
    watchLivelyTime: z.string().regex(/^\d{1,2}:\d{2}$/, "WATCH_LIVELY_TIME must be HH:MM").optional(),
    // Entity ids or patterns ("sensor.*_battery"), comma-separated: only
    // these are watched when any is given; never these.
    watchEntities: z.string().optional().transform(splitList),
    watchExclude: z.string().optional().transform(splitList),
    // Where Igor may read Home Assistant's YAML (read_config_file); the
    // add-on maps the configuration folder here. Absent = no file access.
    haConfigDir: z.string().default("/config"),

    // Ollama
    ollamaBaseUrl: z.string().url().optional(),

    // Home Assistant
    haUrl: z.string().url("HA_URL must be a valid URL"),
    haToken: z.string().min(1, "HA_TOKEN is required"),
    haSkipTlsVerify: z
      .string()
      .transform((v) => v === "true")
      // zod 4: .default() hands the value back untouched, so "false" would come
      // out as a truthy string. .prefault() runs it through the transform.
      .prefault("false"),

    // Memory - Shodh (required)
    shodhUrl: z.string().url("SHODH_URL is required"),
    shodhApiKey: z.string().min(1, "SHODH_API_KEY is required"),

    // Memory settings
    // Remembered facts sent with every request, in tokens. Re-sent on every
    // model call of a tool loop, so it multiplies; 1500 holds dozens of facts,
    // and the most relevant ones are picked first.
    memoryTokenLimit: z.coerce.number().default(1500),
    memoryCleanupIntervalHours: z.coerce.number().min(0).default(6),

    // Conversation history
    conversationStorage: z.enum(["memory", "sqlite"]).default("memory"),
    conversationDbPath: z.string().default("/data/conversations.db"),

    // Custom prompt. CUSTOM_PROMPT applies everywhere; the per-mode ones are
    // appended to it for that kind of conversation only (spoken Assist, or a
    // thread in the chat panel), so shared rules are written once.
    customPrompt: z.string().optional(),
    customPromptVoice: z.string().optional(),
    customPromptThread: z.string().optional(),
    // How to treat an Assist request. "auto" trusts the integration, which
    // only knows a request is spoken when it comes from a satellite; voice
    // from the phone app arrives as text. "voice" / "text" force one style
    // for every Assist request. Chat-panel threads are never affected.
    assistMode: z.enum(["auto", "voice", "text"]).default("auto"),
    // Long-term facts of chat-panel threads: shared with Assist and the other
    // threads (default), or kept per thread. Conversation history is per
    // thread either way. See memory/memory-scope.ts.
    threadMemory: z.enum(["shared", "isolated", "off"]).default("off"),

    // Per-entity device capability overrides (JSON, for devices with incorrect HA-reported modes)
    deviceOverrides: z.string().optional(),

    // Comma-separated entity domains to keep in the home layout, which ships
    // in every system prompt. "all" keeps everything (the previous behaviour).
    layoutDomains: z.string().optional(),

    // Build the layout from the entities exposed to Assist instead of guessing
    // by domain. Needs the websocket API; falls back to layoutDomains.
    layoutFromExposed: z
      .string()
      .transform((v) => v !== "false")
      .prefault("true"),

    // Bound the tools to the entities exposed to Assist, the way Home
    // Assistant's own agent does. "false" lets them reach the whole house.
    toolsFromExposed: z
      .string()
      .transform((v) => v !== "false")
      .prefault("true"),

    // App / API access
    corsOrigins: z.string().optional(), // Comma-separated origins, e.g. "http://localhost:5173,https://app.example.com"
    apiToken: z.string().optional(), // Bearer token for API auth (when unset, no auth enforced)
    // The token handoff to the companion integration is not confirmed yet:
    // Home Assistant Core alone may call without the token meanwhile.
    apiAuthGrace: z
      .string()
      .transform((v) => v === "true" || v === "1")
      .prefault("false"),
    // How far Igor may change the configuration: off (read only), automations
    // (the automation tools, the default) or yaml (also write_config_file).
    configEdits: z.enum(["off", "automations", "yaml"]).default("automations"),

    // Speech-to-text (for HomeMind App)
    // "mistral" transcribes with Voxtral on Mistral's own API, keyed by
    // MISTRAL_API_KEY unless STT_API_KEY is set.
    sttProvider: z.enum(["openai", "mistral", "none"]).default("none"),
    sttApiKey: z.string().optional(), // Overrides openaiApiKey for STT; falls back to openaiApiKey if unset
    sttBaseUrl: z.string().url().optional(), // Custom Whisper-compatible endpoint
    // Unset = the provider's own default (whisper-1, voxtral-mini-latest).
    sttModel: z.string().optional(),

    // Text-to-speech (for HomeMind App)
    // "mistral" speaks with Voxtral TTS on Mistral's own API, keyed by
    // MISTRAL_API_KEY unless TTS_API_KEY is set.
    ttsProvider: z.enum(["openai", "mistral", "none"]).default("none"),
    ttsApiKey: z.string().optional(), // Overrides openaiApiKey for TTS; falls back to openaiApiKey if unset
    ttsBaseUrl: z.string().url().optional(), // Custom OpenAI-compatible TTS endpoint
    ttsModel: z.string().default("tts-1"),
    ttsVoice: z.string().default("alloy"),
    // The language the configured voice actually speaks, as a BCP-47 code
    // ("sl", "en"). Optional: unset means "unknown", and the HA integration
    // then falls back to advertising its full supported list.
    ttsLanguage: z.string().optional(),
    // The gender of the configured voice. Not cosmetic: many languages inflect
    // the first person for the speaker's gender, so this decides how the model
    // must write about itself. Optional — unset means "don't say anything about
    // it", which is right for text-only setups and for voices we haven't
    // classified.
    ttsVoiceGender: z.enum(["female", "male"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.llmProvider === "anthropic" && !data.anthropicApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic",
        path: ["anthropicApiKey"],
      });
    }
    if (data.llmProvider === "openai" && !data.openaiApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OPENAI_API_KEY is required when LLM_PROVIDER is openai",
        path: ["openaiApiKey"],
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  // Treat empty strings as undefined for optional fields
  const emptyToUndefined = (v: string | undefined) =>
    v === "" ? undefined : v;

  const result = ConfigSchema.safeParse({
    port: process.env.PORT,
    logLevel: emptyToUndefined(process.env.LOG_LEVEL),
    llmMode: emptyToUndefined(process.env.LLM_MODE),
    llmProvider: emptyToUndefined(process.env.LLM_PROVIDER),
    llmModel: emptyToUndefined(process.env.LLM_MODEL),
    anthropicApiKey: emptyToUndefined(process.env.ANTHROPIC_API_KEY),
    openaiApiKey: emptyToUndefined(process.env.OPENAI_API_KEY),
    openaiBaseUrl: emptyToUndefined(process.env.OPENAI_BASE_URL),
    mistralApiKey: emptyToUndefined(process.env.MISTRAL_API_KEY),
    openaiResponseFormat: emptyToUndefined(process.env.OPENAI_RESPONSE_FORMAT),
    openaiMaxTokens: emptyToUndefined(process.env.OPENAI_MAX_TOKENS),
    // OPENAI_MAX_TOKENS was documented as the way to raise this and only ever
    // reached the fact extractor, so it is honoured here too rather than
    // quietly ignored.
    maxOutputTokens: emptyToUndefined(process.env.MAX_OUTPUT_TOKENS ?? process.env.OPENAI_MAX_TOKENS),
    reasoningEffort: emptyToUndefined(process.env.REASONING_EFFORT),
    threadReasoning: emptyToUndefined(process.env.THREAD_REASONING),
    extractionModel: emptyToUndefined(process.env.EXTRACTION_MODEL),
    fastModel: emptyToUndefined(process.env.FAST_MODEL),
    localLlmUrl: emptyToUndefined(process.env.LOCAL_LLM_URL),
    localLlmKey: emptyToUndefined(process.env.LOCAL_LLM_KEY),
    localLlmModel: emptyToUndefined(process.env.LOCAL_LLM_MODEL),
    localLlmPrompt: emptyToUndefined(process.env.LOCAL_LLM_PROMPT),
    localOrderReply: emptyToUndefined(process.env.LOCAL_ORDER_REPLY),
    localLlmPrewarm: emptyToUndefined(process.env.LOCAL_LLM_PREWARM) === undefined ? undefined : process.env.LOCAL_LLM_PREWARM !== "false",
    notifyService: emptyToUndefined(process.env.NOTIFY_SERVICE),
    dailyBriefingTime: emptyToUndefined(process.env.DAILY_BRIEFING_TIME),
    dailyBriefingPrompt: emptyToUndefined(process.env.DAILY_BRIEFING_PROMPT),
    briefingUserId: emptyToUndefined(process.env.BRIEFING_USER_ID),
    houseWatch: emptyToUndefined(process.env.HOUSE_WATCH),
    watchQuietHours: emptyToUndefined(process.env.WATCH_QUIET_HOURS),
    watchMaxPerDay: emptyToUndefined(process.env.WATCH_MAX_PER_DAY),
    watchLivelyTime: emptyToUndefined(process.env.WATCH_LIVELY_TIME),
    watchEntities: emptyToUndefined(process.env.WATCH_ENTITIES),
    watchExclude: emptyToUndefined(process.env.WATCH_EXCLUDE),
    haConfigDir: emptyToUndefined(process.env.HA_CONFIG_DIR),
    ollamaBaseUrl: emptyToUndefined(process.env.OLLAMA_BASE_URL),
    haUrl: process.env.HA_URL,
    haToken: process.env.HA_TOKEN,
    haSkipTlsVerify: process.env.HA_SKIP_TLS_VERIFY,
    shodhUrl: process.env.SHODH_URL,
    shodhApiKey: process.env.SHODH_API_KEY,
    memoryTokenLimit: emptyToUndefined(process.env.MEMORY_TOKEN_LIMIT),
    memoryCleanupIntervalHours: emptyToUndefined(process.env.MEMORY_CLEANUP_INTERVAL_HOURS),
    conversationStorage: emptyToUndefined(process.env.CONVERSATION_STORAGE),
    conversationDbPath: emptyToUndefined(process.env.CONVERSATION_DB_PATH),
    customPrompt: emptyToUndefined(process.env.CUSTOM_PROMPT),
    customPromptVoice: emptyToUndefined(process.env.CUSTOM_PROMPT_VOICE),
    customPromptThread: emptyToUndefined(process.env.CUSTOM_PROMPT_THREAD),
    assistMode: emptyToUndefined(process.env.ASSIST_MODE),
    threadMemory: emptyToUndefined(process.env.THREAD_MEMORY),
    deviceOverrides: emptyToUndefined(process.env.DEVICE_OVERRIDES),
    layoutDomains: emptyToUndefined(process.env.LAYOUT_DOMAINS),
    layoutFromExposed: emptyToUndefined(process.env.LAYOUT_FROM_EXPOSED),
    toolsFromExposed: emptyToUndefined(process.env.TOOLS_FROM_EXPOSED),
    corsOrigins: emptyToUndefined(process.env.CORS_ORIGINS),
    apiToken: emptyToUndefined(process.env.API_TOKEN),
    apiAuthGrace: emptyToUndefined(process.env.API_AUTH_GRACE),
    configEdits: emptyToUndefined(process.env.CONFIG_EDITS),
    sttProvider: emptyToUndefined(process.env.STT_PROVIDER),
    sttApiKey: emptyToUndefined(process.env.STT_API_KEY),
    sttBaseUrl: emptyToUndefined(process.env.STT_BASE_URL),
    sttModel: emptyToUndefined(process.env.STT_MODEL),
    ttsProvider: emptyToUndefined(process.env.TTS_PROVIDER),
    ttsApiKey: emptyToUndefined(process.env.TTS_API_KEY),
    ttsBaseUrl: emptyToUndefined(process.env.TTS_BASE_URL),
    ttsModel: emptyToUndefined(process.env.TTS_MODEL),
    ttsVoice: emptyToUndefined(process.env.TTS_VOICE),
    ttsLanguage: emptyToUndefined(process.env.TTS_LANGUAGE),
    ttsVoiceGender: emptyToUndefined(process.env.TTS_VOICE_GENDER),
  });

  if (!result.success) {
    console.error("Configuration errors:");
    for (const error of result.error.issues) {
      console.error(`  - ${error.path.join(".")}: ${error.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
