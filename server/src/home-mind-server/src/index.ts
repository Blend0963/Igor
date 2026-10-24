import "dotenv/config";
import express from "express";
import cors from "cors";
import { createRequire } from "module";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createAuthMiddleware, HA_CORE_ADDRESSES, isIngressRequest } from "./api/auth.js";

// Read version from package.json
const require = createRequire(import.meta.url);
const { version } = require("../package.json");
import { ShodhMemoryStore } from "./memory/shodh-client.js";
import { createConversationStore } from "./memory/conversation-factory.js";
import { MERGE_MARKER_FILENAME } from "./memory/shared-memory.js";
import { HomeAssistantClient } from "./ha/client.js";
import { DeviceScanner } from "./ha/device-scanner.js";
import { DEFAULT_LAYOUT_DOMAINS, TopologyScanner } from "./ha/topology-scanner.js";
import { fetchExposedEntities } from "./ha/exposed-entities.js";
import { AssistExposure } from "./ha/exposure.js";
import { createChatEngine, createFactExtractor } from "./llm/factory.js";
import { createRouter } from "./api/routes.js";
import { createSttService, sttModelFor } from "./stt/stt-service.js";
import { createTtsService } from "./tts/tts-service.js";
import { configureMediaStore } from "./llm/media-store.js";
import { createTitleGenerator } from "./llm/thread-title.js";
import { WorkspaceStore } from "./memory/workspace-store.js";
import { configureVision, createVisionDescriber } from "./llm/vision.js";
import { Scheduler, setScheduler } from "./jobs/scheduler.js";
import { HouseWatch, houseContext } from "./jobs/house-watch.js";
import { leanMode } from "./llm/lean.js";
import { createOneShot } from "./llm/one-shot.js";
import { setConfigDir } from "./llm/home-tools.js";
import { setConfigEdits } from "./llm/tool-policy.js";
import { createDiagnostics } from "./api/diagnostics.js";
import { createModelLister } from "./llm/model-list.js";
import { MemoryCleanupJob } from "./jobs/memory-cleanup.js";
import { BalanceWatchJob } from "./jobs/balance-watch.js";

// Load configuration
const config = loadConfig();

// Initialize components
console.log("Initializing Home Mind API...");

// Initialize Shodh memory store (required)
console.log(`  Connecting to Shodh Memory: ${config.shodhUrl}`);
const memory = new ShodhMemoryStore({
  baseUrl: config.shodhUrl,
  apiKey: config.shodhApiKey,
});

// Verify Shodh is available
const healthy = await memory.isHealthy();
if (!healthy) {
  console.error("ERROR: Shodh Memory is not available at", config.shodhUrl);
  console.error("Please ensure Shodh is running before starting Home Mind.");
  process.exit(1);
}
console.log("  ✓ Memory store: Shodh Memory (cognitive, semantic search)");

// Initialize conversation store
const conversations = createConversationStore(config);
console.log(`  ✓ Conversation store: ${config.conversationStorage}`);

const extractor = createFactExtractor(config);
console.log(`  Fact extractor: ${config.llmProvider}/${config.llmModel}`);

// One reading of "what may the assistant see", shared by the room map and the
// tools. Home Assistant filters both from the same list; when only the layout
// followed it, search_entities still returned every entity in the house.
const exposure = new AssistExposure(() => fetchExposedEntities(config.haUrl, config.haToken));

const ha = new HomeAssistantClient(config, config.toolsFromExposed ? exposure : undefined);
console.log(`  Home Assistant: ${config.haUrl}`);
console.log(
  `  Tools: ${
    config.toolsFromExposed
      ? "limited to the entities exposed to Assist"
      : "the whole house (TOOLS_FROM_EXPOSED=false)"
  }`
);

let deviceOverrides = {};
if (config.deviceOverrides) {
  try {
    deviceOverrides = JSON.parse(config.deviceOverrides);
  } catch {
    console.warn("  ⚠ DEVICE_OVERRIDES is not valid JSON — ignored");
  }
}
const scanner = new DeviceScanner(ha, 30 * 60 * 1000, deviceOverrides);
// The layout is sent with every request, so on a large install its size is a
// standing cost. "all" opts out of filtering; otherwise a comma-separated list
// overrides the default domain set.
const layoutDomains =
  config.layoutDomains?.trim().toLowerCase() === "all"
    ? null
    : config.layoutDomains
      ? config.layoutDomains.split(",").map((d) => d.trim()).filter(Boolean)
      : DEFAULT_LAYOUT_DOMAINS;
// The entities the user exposed to Assist are Home Assistant's own answer to
// "what should the assistant see", so prefer them over the domain heuristic.
// Reading them needs the websocket API; when that fails the domains apply.
const exposureProvider = config.layoutFromExposed ? () => exposure.list() : null;
const topology = new TopologyScanner(ha, 30 * 60 * 1000, layoutDomains, exposureProvider);
await Promise.all([scanner.scan(), topology.scan()]);
console.log(`  ✓ Device scanner: ${scanner.getProfiles().length} light profiles loaded`);
console.log(`  ✓ Topology scanner: home layout ${topology.hasLayout() ? "loaded" : "unavailable"}`);

const llm = createChatEngine(config, memory, conversations, extractor, ha, scanner, topology);
console.log(`  LLM client: ${config.llmProvider}/${config.llmModel}`);

// Initialize STT (optional — only when STT_PROVIDER is set)
const stt = createSttService(config);
if (stt) {
  console.log(`  STT: ${config.sttProvider} / ${sttModelFor(config)}`);
} else {
  console.log("  STT: disabled");
}

// Initialize TTS (optional — only when TTS_PROVIDER is set)
const tts = createTtsService(config);
if (tts) {
  console.log(
    `  TTS: ${config.ttsProvider} / ${config.ttsProvider === "mistral" && config.ttsModel === "tts-1" ? "voxtral" : config.ttsModel} (voice: ${config.ttsVoice}` +
      `${config.ttsLanguage ? `, language: ${config.ttsLanguage}` : ""})`
  );
} else {
  console.log("  TTS: disabled");
}

// Create Express app
const app = express();
app.disable("x-powered-by");
// The panel is framed by Home Assistant's ingress, so no frame-ancestors ban;
// these two are free and close MIME sniffing and referrer leaks of the
// ingress token path.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // The panel page: everything from this origin only, nothing framed but by
  // Home Assistant itself (ingress is same-origin), no plugins, no <base>.
  // The inline script and styles are the page's own; no HTML is ever built
  // from replies, and this keeps a file opened from a reply from loading
  // anything foreign.
  if (!req.path.startsWith("/api/")) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; " +
        "manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
    );
  }
  next();
});

// CORS middleware (only when CORS_ORIGINS is configured)
if (config.corsOrigins) {
  const origins = config.corsOrigins.split(",").map((o) => o.trim());
  app.use(cors({ origin: origins, credentials: true }));
  console.log(`  CORS: ${origins.join(", ")}`);
}

// API token auth, before any body is read: an unauthenticated caller cannot
// make the server parse anything. While the integration has not confirmed it
// holds the token (API_AUTH_GRACE), Home Assistant Core alone may call without
// it; nothing else on the network may.
if (!config.apiToken) {
  console.warn("  WARNING: no API_TOKEN: the API is open to anything that can reach this port.");
} else if (config.apiAuthGrace) {
  console.warn("  API auth: token required, except from Home Assistant Core until the integration confirms the token.");
}
const authMiddleware = createAuthMiddleware(config.apiToken, {
  gracePeers: config.apiAuthGrace ? HA_CORE_ADDRESSES : [],
});
app.use("/api", authMiddleware);

// Room for what /api/chat may carry in base64: up to 10 images and 5 attached
// files of 10 MB each (CHAT_LIMITS in api/routes.ts); every other route gets
// small bodies only.
app.use("/api/chat", express.json({ limit: "80mb" }));
app.use("/api", express.json({ limit: "1mb" }));

// The installed app (the panel opened outside Home Assistant, through the
// user's own reverse proxy) has no HA login in front of it, so it needs the
// API token. Only a page that HA already authenticated, the panel inside
// ingress, may read it, to show it once for copying into the app.
app.get("/api/app-token", (req, res) => {
  if (!config.apiToken) return res.json({ token: null });
  if (!isIngressRequest(req)) return res.status(403).json({ error: "Only from the Home Assistant panel." });
  res.setHeader("Cache-Control", "no-store");
  res.json({ token: config.apiToken });
});

// Add request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// The one-time memory merge records itself next to the conversation database.
// With in-memory conversations there is nowhere durable to put it, and the
// merge's own duplicate check keeps a repeat from copying anything.
// Projects and the cost counter, next to the conversation database.
const dataDir = config.conversationStorage === "sqlite" ? path.dirname(config.conversationDbPath) : undefined;
const workspace = new WorkspaceStore(dataDir ? path.join(dataDir, "workspace.db") : ":memory:");

// Camera snapshots are described by the chat model (look_at_camera).
configureVision(createVisionDescriber(config));

// Reminders, scheduled tasks and the morning briefing, in the house's time zone.
let houseTimeZone: string | undefined;
const scheduler = new Scheduler({
  llm,
  conversations,
  notify: (title, message) => ha.notify(config.notifyService, title, message),
  timeZone: async () => {
    if (!houseTimeZone) {
      houseTimeZone = await ha
        .getConfig()
        .then((c) => c.time_zone)
        .catch(() => undefined);
    }
    return houseTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  },
  readState: async (entityId) => (await ha.getState(entityId)).state,
  storePath: dataDir ? path.join(dataDir, "scheduled-tasks.json") : undefined,
});
setScheduler(scheduler);
scheduler.start();
scheduler
  .configureBriefing({ userId: config.briefingUserId, time: config.dailyBriefingTime, prompt: config.dailyBriefingPrompt })
  .catch((err) => console.warn("[scheduler] briefing not configured:", err instanceof Error ? err.message : err));

// read_config_file reads Home Assistant's YAML here (the add-on's /config).
setConfigDir(config.haConfigDir);
// How far Igor may change the configuration (CONFIG_EDITS).
setConfigEdits(config.configEdits);
console.log(`  Configuration changes: ${config.configEdits}`);

// The house watch: plain checks every few minutes, the cheap model only when
// something new is flagged, notifications on the reminders' channel.
let houseLanguage: string | undefined;
const houseWatch = new HouseWatch(
  {
    readStates: (all) => ha.getStatesForWatch(all),
    readTraces: () => ha.getAutomationTraces(),
    context: (states) =>
      houseContext(states, async (entityId) => {
        const res = await ha.callService("weather", "get_forecasts", entityId, { type: "daily" });
        return Array.isArray(res) ? undefined : res.service_response;
      }),
    judge: createOneShot(config, "watch"),
    notify: (title, message) => ha.notify(config.notifyService, title, message),
    conversations,
    userId: config.briefingUserId,
    timeZone: () => scheduler.timeZone(),
    language: async () => {
      if (!houseLanguage) houseLanguage = await ha.getConfig().then((c) => c.language).catch(() => undefined);
      return houseLanguage ?? "fr";
    },
    storePath: dataDir ? path.join(dataDir, "house-watch.json") : undefined,
  },
  {
    mode: config.houseWatch,
    quietHours: config.watchQuietHours,
    maxPerDay: config.watchMaxPerDay,
    livelyTime: config.watchLivelyTime,
    intervalMinutes: 5,
    include: config.watchEntities,
    exclude: config.watchExclude,
    plain: leanMode(),
  }
);
houseWatch.start();

const diagnostics = createDiagnostics({ config, ha, memory, tts: tts ?? undefined, stt: stt ?? undefined });

// Charts and images the tools produce, next to the conversation database so a
// thread still shows them after a restart.
configureMediaStore(
  config.conversationStorage === "sqlite" ? path.join(path.dirname(config.conversationDbPath), "media") : undefined
);

const mergeMarkerPath =
  config.conversationStorage === "sqlite"
    ? path.join(path.dirname(config.conversationDbPath), MERGE_MARKER_FILENAME)
    : undefined;

// Mount API routes
app.use("/api", createRouter(llm, memory, "shodh", version, config.customPrompt, conversations, stt ?? undefined, tts ?? undefined, config.ttsLanguage, mergeMarkerPath, {
  voice: config.customPromptVoice,
  thread: config.customPromptThread,
  assistMode: config.assistMode,
}, {
  generateTitle: createTitleGenerator(config),
  workspace,
  scheduler,
  diagnostics,
  models: createModelLister(config, config.openaiApiKey),
}));

// The built-in thread panel: plain static files next to the compiled server
// (the add-on image copies them in). Optional on purpose — when the
// directory is absent, e.g. a server built from dist alone, the root
// endpoint below stays the JSON descriptor it always was. In the add-on,
// Home Assistant ingress proxies this page behind the HA login, which is
// the whole authentication story for the panel; the raw port stays
// unexposed.
const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public"
);
if (existsSync(publicDir)) {
  // The Android share menu posts here. The service worker answers it
  // (public/sw.js); this only covers the first share, before the worker is
  // installed, by opening the app instead of failing.
  app.post("/share", (_req, res) => res.redirect(303, "./"));
  app.use(express.static(publicDir));
}

// Root endpoint
app.get("/", (_req, res) => {
  res.json({
    name: "Home Mind Server",
    version,
    description: "Home Assistant AI with cognitive memory for voice integration",
    memoryBackend: "shodh",
    conversationStorage: config.conversationStorage,
    endpoints: {
      chat: "POST /api/chat",
      chatStream: "POST /api/chat/stream",
      memory: "GET /api/memory/:userId",
      health: "GET /api/health",
    },
  });
});

// Errors that reach Express (a malformed or oversized body): a short JSON
// answer, never a stack trace.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  const e = err as { status?: number; type?: string };
  const status = typeof e.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 500;
  if (status >= 500) console.error("[http] unhandled error:", err instanceof Error ? err.message : err);
  res.status(status).json({ error: e.type === "entity.too.large" ? "Request too large" : status >= 500 ? "Internal error" : "Bad request" });
});

// Start server
app.listen(config.port, () => {
  console.log(`
┌─────────────────────────────────────────┐
│      Home Mind Server Started           │
├─────────────────────────────────────────┤
│  Port: ${config.port.toString().padEnd(33)}│
│  LLM: ${(config.llmProvider + "/" + config.llmModel).substring(0, 32).padEnd(32)}│
│  Memory: Shodh (cognitive)              │
│  Conversations: ${config.conversationStorage.padEnd(23)}│
│  HA URL: ${config.haUrl.substring(0, 30).padEnd(30)}│
│  Log Level: ${config.logLevel.padEnd(27)}│
└─────────────────────────────────────────┘

Ready to accept requests at http://localhost:${config.port}
`);
});

// Start periodic memory cleanup
const cleanupJob = new MemoryCleanupJob(memory, conversations, config.memoryCleanupIntervalHours);
cleanupJob.start();

// Watch the cloud balance (no-op in BYOK mode)
const balanceJob = new BalanceWatchJob({
  enabled: config.llmMode === "cloud" && config.llmProvider === "openai",
  apiKey: config.openaiApiKey,
  baseUrl: config.openaiBaseUrl,
  ha,
});
balanceJob.start();

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Shutting down...");
  cleanupJob.stop();
  scheduler.stop();
  balanceJob.stop();
  conversations.close();
  memory.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  cleanupJob.stop();
  scheduler.stop();
  balanceJob.stop();
  conversations.close();
  memory.close();
  process.exit(0);
});
