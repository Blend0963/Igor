# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

```
HA Assist (Voice/Text) → HA Custom Component (Python) → Igor server (Express/TS) → LLM API (Anthropic/OpenAI/Ollama) + Shodh Memory + HA REST API
```

**Single path, no fallbacks.** All interactions flow through the Igor server (`src/home-mind-server/`). Shodh Memory is the only memory backend (required, no SQLite fallback). LLM provider is selected via `LLM_PROVIDER` env var (default: `anthropic`).

### Home Layout Index

`TopologyScanner` (`ha/topology-scanner.ts`) runs at startup and every 30 minutes. It uses the HA template API (`POST /api/template`) with a single Jinja2 query that calls `floors()`, `floor_name()`, `floor_areas()`, `area_name()`, `area_entities()`, and `areas()` (available since HA 2024.4). Unassigned areas are derived by exclusion — areas not returned by any `floor_areas()` call.

Builds a compact `floor → room → [entity_id (friendly name)]` text section (entities without a name stay bare ids; an area too big to render with names falls back to bare ids) and injects it into every system prompt alongside the device cheat sheet. This gives the LLM spatial awareness without tool calls — it knows which floor and room every device belongs to before reasoning begins.

If the template API fails (older HA, network error), the scanner logs a warning and injects nothing — the rest of the system works normally.

### The Assist exposure list bounds the room map and the tools

Settings → Voice assistants → Expose is the user's own list of what an assistant may see, and Home Assistant's own agent builds both its prompt and its live-context tool from it, so an unexposed entity does not exist for that agent. The list is websocket-only (`ha/exposed-entities.ts`). `AssistExposure` (`ha/exposure.ts`) is one cached reading of it, TTL 30 minutes (the topology scan interval), retried after 60 s when a read fails, with concurrent reads collapsed into one websocket call. `index.ts` creates one instance and hands it to the `TopologyScanner` as its exposure provider (`LAYOUT_FROM_EXPOSED`, default on) and to `HomeAssistantClient` (`TOOLS_FROM_EXPOSED`, default on).

With the client bounded, `get_state` and `get_history` refuse an unexposed entity before any request, `get_entities` and `search_entities` return exposed entities only, and `call_service` refuses before the request leaves: a named `entity_id` (string, list or comma-separated), ids in `data.entity_id` or a nested `target.entity_id`, `entity_id: "all"`, and, while the list has an opinion, any `area_id` / `device_id` / `floor_id` / `label_id` target, which cannot be vetted without resolving it. Running `script.<name>` needs that script exposed. The refusal text (`notExposedMessage`) tells the model the entity is out of scope and not to retry other spellings. An exposed group still acts on all of its members; Home Assistant's own agent behaves the same.

**A list that cannot be read, or an empty one, means "no opinion" and filters nothing.** An old HA, a token without websocket access, a network error or a user who exposed nothing must never leave the assistant blind to the whole house. A refresh that fails mid-session keeps the last good list instead of widening. The eval rig's mock HA has no websocket, so there the list is always "no opinion".

**Automations are not bounded yet.** The create/update payloads the assistant writes can still name any entity, and `listAutomations()` deliberately reads past the list: automations are rarely exposed, and filtering them would stop `update_automation` / `delete_automation` from finding the automation the assistant just made. Gating automation targets is a follow-up.

### Device Capability Index

`DeviceScanner` (`ha/device-scanner.ts`) runs at startup and every 30 minutes. It fetches all `light.*` entities, reads `supported_color_modes` attributes, and builds `DeviceCapabilityProfile` objects with pre-computed `whiteMethod` and `colorMethod`. These are formatted as a markdown cheat sheet and injected into every system prompt via `buildSystemPrompt()` / `buildSystemPromptText()`.

**White method precedence**: `rgbw`/`rgbww` → `rgbw_color: [0,0,0,255]`; `color_temp` → `color_temp_kelvin`; `rgb`/`xy`/`hs` → `rgb_color: [255,255,255]`; else → none.

`DeviceScanner` reads lights through the same `HomeAssistantClient`, so with `TOOLS_FROM_EXPOSED` on the cheat sheet covers exposed lights only.

**`DEVICE_OVERRIDES`** env var (JSON) allows per-entity overrides for devices with incorrect HA-reported modes (e.g. Gledopto GL-C-008P always reports `color_temp+xy` regardless of wiring). Overrides are applied after auto-detection. Fields: `whiteMethod` and/or `colorMethod`.

### Request Flow (IChatEngine.chat)

1. Load user's facts from Shodh via semantic search (query = current message)
2. Refresh DeviceScanner + TopologyScanner if stale (both run in parallel via `Promise.all`)
3. Build system prompt: static part (cached via `cache_control: ephemeral` for Anthropic, plain string for OpenAI) + dynamic part (facts + datetime + home layout + device cheat sheet)
3. Load conversation history from `IConversationStore` (keyed by conversationId)
4. Stream response with tool loop (parallel tool execution)
5. Fire-and-forget fact extraction (extracts facts, replaces conflicting old ones)
6. Return response to caller

### Two LLM Calls Per Request

- **Chat**: `IChatEngine` — handles conversation + HA tool calls. Implementations: `LLMClient` (Anthropic), `OpenAIChatEngine` (OpenAI/Ollama)
- **Extraction**: `IFactExtractor` — extracts facts from conversation (async, non-blocking). Implementations: `FactExtractor` (Anthropic), `OpenAIFactExtractor` (OpenAI/Ollama)

Provider is selected at startup by `llm/factory.ts` based on `LLM_PROVIDER` config.

### Memory Architecture

- **Long-term facts**: Shodh Memory (external service, semantic search, Hebbian learning, natural decay)
- **Conversation history**: `IConversationStore` with two backends: `InMemoryConversationStore` (default, lost on restart) and `SqliteConversationStore` (persistent via `better-sqlite3`). Controlled by `CONVERSATION_STORAGE` env var (`memory` | `sqlite`). Max 20 messages/conversation. **The add-on always sets `sqlite`.**
- **Known users** live in their own `users` table (sqlite) / `knownUsers` set (memory) — deliberately *not* derived from conversation rows, which `cleanupOldConversations()` prunes after 24h. Deriving them from messages is what silently disabled `MemoryCleanupJob` in every release before 2.3.3 (live logs showed "[cleanup] No known users" on every run for a week while Shodh held 67 facts).
- **Whose memory**: facts are keyed by `userId`. Since 2.7.0 the integration sends its configured `user_id` on every request by default (the "Shared memory" option in its options flow); per-user buckets (HA `context.user_id`, falling back to the configured id for satellites and automations, which carry no user) are the opt-in. That fallback used to be the only behaviour and silently split households into memories that could not see each other. `memory/shared-memory.ts` holds the server half: a once-per-user-id-per-process info log (`[memory] Memory bucket ... is empty`) when a chat request's bucket is empty while another known user has facts, fire and forget; and `POST /api/memory/:userId/merge`, a one-time, non-destructive copy of every other known user's facts into `:userId` (normalised-content dedupe, sources only read, marker `memory-merges.json` next to `CONVERSATION_DB_PATH` when sqlite, in-flight calls for the same target share one run). The integration calls it from a background task on every setup while shared memory is on, retrying while the add-on boots after Core; the marker makes repeats free. Users come from `getKnownUsers()` because Shodh has no "list buckets" call, and `getFacts()` returns at most 100 facts per bucket, so that is also the most one merge copies from each.
- **Memory scopes** (`memory/memory-scope.ts`, `resolveMemoryScope(userId, conversationId, threadMemory)`): every Assist request (any device, any HA conversation id) uses the conversation `mado-user:<userId>`; a panel thread (`mado-thread:<id>`) uses its own conversation and semantic recall limited to its own messages, and Assist's recall excludes every thread. Long-term facts: Assist uses the bucket `<userId>`; a thread uses the same bucket by default (`THREAD_MEMORY=shared`), or its own `<userId>@mado-thread.<id>` with `THREAD_MEMORY=isolated` (Shodh allows only alphanumerics, `-`, `_`, `@`, `.` in a user_id). Messages keep the real `userId`, so thread buckets never become known users and are never merged. Threads keep 500 messages (`THREAD_MESSAGE_CAP`; the model sees `HISTORY_WINDOW.thread`), and deleting a thread clears its isolated bucket if it had one
- **Entity cache**: 10-second TTL in HomeAssistantClient (invalidated after service calls)
- **Fact categories**: baseline, preference, identity, device, pattern, correction
- **Smart replacement**: Extractor identifies existing facts that new facts supersede (via `replaces` field)

## Development Commands

All commands run from `src/home-mind-server/`:

```bash
npm run dev          # tsx watch (hot reload), starts at localhost:3100
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/
npm test             # vitest run
npm run test:watch   # vitest (watch mode)
npm run test:coverage # vitest with v8 coverage

# Single test file
npm test -- src/memory/shodh-client.test.ts

# Single test by name
npm test -- -t "can check health"
```

Requires Shodh Memory running at SHODH_URL. For local dev: `cp .env.example .env` and fill in credentials.

## Testing Patterns

Vitest with `globals: true`. Tests mock constructors using `class` syntax in `vi.mock()` factories (not `vi.fn().mockImplementation()`) because the code uses `new`. Config tests use `vi.resetModules()` + dynamic `import()` to test different env var configurations.

Integration tests (e.g., `shodh-client.test.ts`) only run when `SHODH_TEST_URL` and `SHODH_TEST_API_KEY` are set — otherwise `describe.skip`.

## Code Patterns

**ES Modules with `.js` extensions** in TypeScript imports (required by `moduleResolution: "NodeNext"` in tsconfig):
```typescript
import { loadConfig } from "./config.js";
```

**Zod validation** for all config and request schemas. Config loads from env vars via `loadConfig()` in `config.ts` — exits process on validation failure. Uses `emptyToUndefined()` helper because Docker Compose sets empty strings (not `undefined`) for unset env vars.

**HA tool definitions** are provider-neutral `ToolDefinition[]` in `llm/tool-definitions.ts`, converted to provider format via `toAnthropicTools()` / `toOpenAITools()`. Eleven tools: `get_state`, `get_entities`, `search_entities`, `call_service`, `get_history`, `create_automation`, `list_automations`, `delete_automation`, `update_automation`, `list_services`, `forget_memory`. Shared execution logic in `llm/tool-handler.ts`. The automation create/update/delete tools run through a server-enforced confirmation gate (`llm/automation-confirmations.ts`) — first call previews, a later-turn re-call commits, **scoped by a stable identity** (entity_id for update/delete, normalized alias for create). The payload is never compared: the model reformats it wildly between turns, which is what made the v2.1.10 fingerprint approach loop forever. Create had no identity key at all until 2.3.3, so any create in a later turn confirmed any earlier create preview.

`forget_memory` (conversational memory deletion, issue #54) takes a content `query` — never a fact id (ids aren't shown to the model and can't survive turns). The handler resolves it deterministically against ALL of the user's facts (`memory/fact-resolution.ts`: exact normalized match, else Dice over token sets; ambiguity → candidates, no action) and gates through the same confirm module using an `identityOverride` = the resolved fact's **normalized content** — so a reworded confirm-turn query still commits, and extraction re-adding the content under a new Shodh id between preview and confirm can't cause an id mismatch. Commit deletes every duplicate id of the content group. Every forget_memory invocation (preview, commit, ambiguous, near-miss) appends the memories it touched to `ToolContext.forgetTargets`, which both engines hand to `extractAndStoreFacts`; extraction then **runs as usual but drops any extracted fact scoring ≥ `FORGET_FILTER_THRESHOLD` (0.85) against a touched memory**. Filtering rather than suppressing is deliberate: "forget that my name is Alex, my name is now HAL 9000" must forget the old fact AND learn the new one, and a same-frame replacement scores ~0.73 while a reworded re-learn scores ~0.91 — hence the much higher threshold than resolution's 0.6. Engines pass ONE shared `ToolContext` per turn so tool calls can write `forgetTargets` back.

**Tool loop is capped** at `MAX_TOOL_ITERATIONS` (8) in both engines. On the final iteration the request is re-issued with tool calling disabled (`tool_choice: "none"` / `{type: "none"}`) so a stuck model produces a written answer rather than running to the integration's 120s timeout, burning the user's allowance. Tool arguments are parsed defensively — malformed JSON becomes a retryable tool error, never an exception that fails the whole request (cheap models emit these). `/api/chat` also accepts an optional `images` array (data URLs) → forwarded as multimodal content to vision-capable models (used by the integration's `ai_task` entity for camera-snapshot analysis).

**Prompt modes** (`llm/prompts.ts`, `PromptMode`): `voice` (VOICE_INSTRUCTIONS), `text` (SYSTEM_INSTRUCTIONS = TEXT_CORE + STT_AWARENESS + LANGUAGE_AND_FOLLOWUPS + TEXT_STYLE) and `thread` (THREAD_SCOPE + TEXT_CORE + LANGUAGE_AND_FOLLOWUPS + THREAD_STYLE: Markdown, code blocks, any length, home tools kept). The engines pick `thread` for `mado-thread:` ids; `api/routes.ts` `resolveChatStyle()` picks voice/text for Assist from `ASSIST_MODE` (`auto` keeps the integration's isVoice, which is only true for satellites) and composes the persona as `CUSTOM_PROMPT` + `CUSTOM_PROMPT_VOICE` / `CUSTOM_PROMPT_THREAD`; a request's own `customPrompt` (AI Task) replaces both. With a persona set, `PERSONA_PRECEDENCE` tells the model the persona wins on style but not on the tool-enforced confirm flows. A spoken (non-thread, attended) message that names Igor after its opening goes first through `llm/addressee-check.ts`: one short call to `EXTRACTION_MODEL` (else fast, else main; JSON mode on Mistral, 16 tokens, 4 s limit) answers `{"pour_igor": bool}`; on false both engines return `notForMe` without calling the main model or storing anything; a failure or unclear verdict answers normally. `SpokenGuard` still silences a spoken reply containing `NOT_FOR_ME` anywhere.

**Token economy**: every model call of a tool loop re-sends the whole context, so context size multiplies. `llm/prompt-cache-key.ts` sends Mistral a `prompt_cache_key` (`igor:<mode>:<factBucket>`; retried without it once and remembered if refused). `llm/compact-state.ts` trims entity states in tool results (UI-only attributes dropped, arrays > 12 and strings > 300 chars cut, lists capped at 25 with a "narrow the query" note); tool results are serialized without indentation. History window per world in `memory-scope.ts` (`HISTORY_WINDOW`: Assist 12, thread 20), `RECALL_LIMIT` 4 with history ids excluded, `MEMORY_TOKEN_LIMIT` default 1500, extraction sees `factsForExtraction()` (top 25 by similarity). `UsageTally` logs one `[usage]` line per request.

**Mistral platform tools** (`llm/mistral-platform.ts`, `llm/platform-tools.ts`): `run_code` (code_interpreter), `generate_image` (image_generation), `search_documents` (document_library, `MISTRAL_LIBRARY_IDS`), `use_connector` (connector, `MISTRAL_CONNECTORS`, enum-bounded). Each is one `POST /v1/conversations` with the built-in tool, `store: false`, model `MISTRAL_TOOL_MODEL` (default `mistral-medium-latest`); outputs parsed defensively by `parseConversationOutputs`. Offered per style by `toolsForMode()` (thread: all; voice/text: only search_documents) and only when `MISTRAL_API_KEY` is set. Files a tool produced are downloaded (`/v1/files/{id}/content`) into `llm/media-store.ts` (`<db dir>/media`, uuid names, 500 newest, 15 MB max) and served by `GET /api/media/:id` (raster images inline, anything else as a download, CSP sandbox); their Markdown links go on `ToolContext.attachments` and the engine appends any the answer left out (`missingAttachments`). Files: `/api/chat` accepts `documents: [{name, data: <any base64 data URL>}]` (5 max, 10 MB each), turned into `<document name="…">` blocks appended to the stored message by `withDocuments()` → `files/extract.ts` `extractFileText()`: docx/xlsx/pptx/odt/ods/odp parsed locally from their XML (`files/zip.ts`, bounded reader: 500 entries, 50 MB inflated), text formats as UTF-8, zip = listing + readable entries (no OCR inside archives), PDF text layer read locally with pdf.js (`files/pdf.ts`, pdfjs-dist legacy build, 500 pages); a PDF where half the pages carry < 25 characters is a scan and needs `/v1/ocr` (mistral-ocr-latest, key required). The request field `ocr` ("ask" default | "yes" | "no") decides: on "ask" `withAttachedDocuments()` returns a confirmation (pages, cost at `OCR_PRICE_PER_1000_PAGES`, default 4 USD) instead of reading, `/api/chat/stream` sends `event: ocr_confirm` and ends (nothing stored), `/api/chat` answers 409; the panel shows the price and resends with the answer; 40k chars per file; unreadable files become a bracketed note. History messages older than the last `RECENT_FILE_MESSAGES` (6) keep a 1500-char excerpt (`shortenAttachedFiles`, both engines), and extraction sees `[attached document: name]` only. `/api/health` reports `documents: true` and `ocr`. `create_file` (thread, no key needed) builds docx/pdf/xlsx/csv/md/txt/json/html/xml/ics/zip in `files/create.ts` without dependencies (stored zip writer, minimal OOXML, WinAnsi Helvetica PDF) and returns a `[📎 name](api/media/<id>)` link; the panel downloads it under that name. Threads send `reasoning_effort = THREAD_REASONING` (default high; the old "no reasoning on Mistral" guard is gone because `contentToText` drops `thinking` chunks) with a 16384 output cap, and a thinking chunk emits status "Réflexion…". TTS: `TTS_PROVIDER=mistral` → `MistralTtsService` (`/v1/audio/speech`, base64 `audio_data` or raw audio). The extractor uses JSON mode on Mistral and unwraps `{"facts": [...]}`. The panel renders Markdown with DOM nodes only and ```` ```chart ```` JSON blocks as SVG charts.

**0.8 features**: `ChatRequest.signal` aborts a reply (OpenAI engine passes it to the SDK; the turn's text so far is stored with "*[Réponse interrompue]*", no extraction); `api/running-turns.ts` holds an AbortController per thread reply, `POST /api/running/:userId/:conversationId/stop`. `llm/model-router.ts` `isSimpleRequest()` sends plain commands / quick state questions to `FAST_MODEL` with reasoning none, falling back to the main model on error. `ChatResponse.usage` (model + summed tokens) feeds `memory/workspace-store.ts` (SQLite `workspace.db`: projects, conversation→project, usage rows; cost from `llm/prices.ts`, `MODEL_PRICES` overrides). Project instructions are appended to a thread's persona in `routes.ts` `withProject()`. Home tools (`HOME_EXTRA_TOOLS`, all styles, also in Anthropic `HA_TOOLS`; handlers `llm/home-tools.ts`): `look_at_camera` (`camera_proxy?width=1024`, described by `llm/vision.ts` in a separate call because Mistral refuses a user message after a tool message; shown in threads via the media store), `get_statistics` (websocket `recorder/statistics_during_period` through `ha/websocket.ts`), `schedule_task` / `list_scheduled_tasks` / `cancel_scheduled_task` (`jobs/scheduler.ts`: JSON file next to the DB, 30 s tick, HA time zone from `/api/config`, reminders notify without a model call, tasks run `llm.chat` in `mado-thread:scheduled-tasks`, the built-in morning briefing in `mado-thread:morning-briefing`, `NOTIFY_SERVICE` or a persistent notification). Panel pickers: `/api/chat` takes `model` and `reasoning` (threads only, stripped for Assist), which override the main model, the fast-model routing and the reasoning effort; `GET /api/models` (`llm/model-list.ts`: configured models plus the Mistral account's chat models with tools, hourly cache). Panel endpoints: `GET /api/search/:userId?q=`, `POST .../truncate {messageId}` (edit / regenerate), `GET .../export?format=md|pdf|docx`, `/api/projects/:userId[/:projectId]`, `PUT .../project`, `/api/tasks/:userId[/:taskId]`, `GET /api/usage/:userId?days=`, `POST /api/diagnostics {paid}` (`api/diagnostics.ts`).

**Prompt caching**: System prompt split into static (cached) + dynamic (facts/datetime) blocks in `llm/prompts.ts`. Two variants: regular and voice (shorter). Custom prompt replaces the default identity line (opening sentence) rather than appending — this gives it maximum authority over persona. Dynamic block includes both human-readable datetime with UTC offset (e.g., `10:15 PM CET (UTC+1)`) and a raw ISO timestamp for unambiguous tool use.

**Timestamp normalization**: `normalizeTimestamp()` in `tool-handler.ts` appends `Z` to bare ISO timestamps (no timezone suffix) before passing them to HA. This prevents HA from misinterpreting timezone-naive timestamps from the LLM. All tool calls are debug-logged with `[tool]` prefix showing name, input, and elapsed time.

**HA light service data fields**: `brightness` (0-255), `rgb_color` ([R,G,B] each 0-255), `color_temp_kelvin` (2000-6500; 2700=warm white, 4000=neutral, 6500=daylight), `hs_color` ([hue 0-360, saturation 0-100]), `rgbw_color` ([R,G,B,W] each 0-255). For white light on RGBW strips (WLED etc.), use `rgbw_color: [0,0,0,255]` — the dedicated white LED channel. `color_temp_kelvin` is accepted by HA but WLED doesn't render it correctly on RGBW strips. For non-RGBW lights, `color_temp_kelvin` works fine. Check `supported_color_modes` in entity attributes to determine which mode to use. There is no separate `set_color` service — use `light.turn_on` with data fields. These are documented in `call_service` tool description in `tool-definitions.ts`.

**White light mode selection** (by `supported_color_modes`): `rgbw` → `rgbw_color: [0,0,0,255]`; `color_temp` only → `color_temp_kelvin`; `xy`/`hs`/`rgb` (RGB-only, no white channel) → `rgb_color: [255,255,255]`. RGB-only lights (e.g. Gledopto GL-C-008P) cannot render `color_temp_kelvin` even though HA accepts it — they need explicit RGB values.

**Shodh type mapping**: Our fact categories map to Shodh memory types (e.g., `baseline` → `Observation`, `preference` → `Preference`) in `shodh-client.ts`.

**Self-signed TLS**: HA client uses undici Agent with `rejectUnauthorized: false` when `HA_SKIP_TLS_VERIFY=true`. Note: when the server runs in Docker and connects to HA over LAN, use `http://` in `HA_URL` — HA typically only serves HTTPS via add-ons or reverse proxies (e.g. Tailscale), not on the raw LAN IP. Using `https://` against a plain HTTP endpoint causes SSL handshake failures even with `HA_SKIP_TLS_VERIFY=true`.

**Token estimation**: Uses `content.length / 4` as rough token count (4 chars ≈ 1 token) for fact budget limiting.

**JSON from LLMs**: Both fact extractors strip markdown code fences (`` ```json ... ``` ``) before `JSON.parse()` — LLMs sometimes wrap JSON responses.

**Startup sequence**: Server checks Shodh health (`memory.isHealthy()`) and exits with `process.exit(1)` if unhealthy, before Express starts listening. Graceful shutdown handles SIGTERM/SIGINT and calls `memory.close()`.

**SSE streaming**: `/api/chat/stream` sends `event: chunk` for text, `event: done` with full response, `event: error` on failure. Calls `res.flushHeaders()` immediately. Both `/api/chat` and `/api/chat/stream` use the same `llm.chat()` internally — non-streaming just omits the `onChunk` callback.

### HA Integration Gotchas (Python)

**HA conversation agent** uses `intent.IntentResponse` (not `conversation.IntentResponse`):
```python
intent_response = intent.IntentResponse(language=user_input.language)
intent_response.async_set_speech(response)
return ConversationResult(response=intent_response)
```

**OptionsFlow has no `__init__`** — passing `config_entry` to the superclass constructor breaks in newer HA versions (fixed in v0.9.1).

**Voice detection**: Detected via `user_input.agent_id is not None` (not HA metadata), sets `isVoice=true` on server request.

**Conversation IDs**: Uses `ulid.ulid_now()` (not UUID).

**120-second timeout**: `DEFAULT_TIMEOUT = 120` for API calls because tool-using LLM responses can take 60+ seconds.

## Environment Variables

Server requires: `HA_URL`, `HA_TOKEN`, `SHODH_URL`, `SHODH_API_KEY`, plus the API key for the selected provider (not needed for Ollama).

LLM config:
- `LLM_PROVIDER` — `anthropic` (default), `openai`, or `ollama`
- `LLM_MODEL` — model ID (default: `claude-haiku-4-5-20251001`; must be set explicitly for Ollama)
- `ANTHROPIC_API_KEY` — required when `LLM_PROVIDER=anthropic`
- `OPENAI_API_KEY` — required when `LLM_PROVIDER=openai`
- `OPENAI_BASE_URL` — optional, for OpenAI-compatible APIs (Azure, local proxies)
- `OLLAMA_BASE_URL` — optional, Ollama API endpoint (default: `http://localhost:11434/v1`)
- `REASONING_EFFORT` — optional `none|minimal|low|medium|high`, sent as `reasoning_effort` on OpenAI-compatible calls (chat and fact extraction); unset sends nothing. A model that rejects the parameter with a 400 naming it is remembered per endpoint and model (`llm/reasoning-effort.ts`) and gets it no more, so one setting is safe across models. Add-on option `reasoning_effort`

Optional: `PORT` (default 3100), `API_TOKEN` (bearer token for auth — when set, all endpoints except health require it), `HA_SKIP_TLS_VERIFY`, `MEMORY_TOKEN_LIMIT` (default 3000), `LOG_LEVEL`, `CONVERSATION_STORAGE` (`memory` | `sqlite`, default `memory`), `CONVERSATION_DB_PATH` (default `/data/conversations.db`, only used when `CONVERSATION_STORAGE=sqlite`), `CUSTOM_PROMPT` (server-level default custom system prompt), `LAYOUT_FROM_EXPOSED` (default `true`; build the room map from the entities exposed to Assist), `TOOLS_FROM_EXPOSED` (default `true`; bound `get_state` / `get_entities` / `search_entities` / `get_history` / `call_service` to the entities exposed to Assist; `false` lets them reach the whole house), `TZ` (timezone for the Docker container, set by the add-on from Home Assistant; Node.js uses this for `toLocaleString()` so the LLM sees correct local time)

Local model (optional, `llm/local-llm.ts`): `LOCAL_LLM_URL` (llama.cpp's OpenAI-compatible server, `/v1` added when missing), `LOCAL_LLM_KEY`, `LOCAL_LLM_MODEL` (default `qwen3-8b`). OpenAI engine only. Every Assist request (not threads, not requests with images) runs on it, with the addressee check, the order check and fact extraction; semantic recall/embedding and fast-model routing are skipped for it. A failed local call answers `LOCAL_UNAVAILABLE` and is never retried on the cloud model. Local requests get `LOCAL_INSTRUCTIONS` (prompts.ts), `LOCAL_TOOLS`, `LOCAL_HISTORY` messages, `LOCAL_SAMPLING`, `LOCAL_REMINDER` before the words, and an ISO time to the minute. Prewarm (`LOCAL_LLM_PREWARM`, default on): after each local request and every `PREWARM_EVERY_MS`, the engine replays the last spoken request's parameters with `prewarm: true` and `message: ""`; `runChat` builds the same messages, sends them with a placeholder user turn and `max_tokens: 1`, and returns without storing anything, so the next request finds everything before the user's words in llama.cpp's cache. The local model never speaks: its streamed text is not forwarded, `LOCAL_OUTPUT_CAP` bounds it, and no required-tool retry runs. It acts and reads; after a batch, unless `needsLocalFollowUp()` (search_entities/get_entities, or a script that returned a service_response), its loop ends and the results go to the online model. `askOnline()` runs through `streamCompletion()` on the main client with the `web_search` tool (when `MISTRAL_API_KEY` is set): a search call is executed with `handleToolCall` and answered by a second call with tools disabled; `web_search` is not a local tool. The addressee check runs on the online model for local turns too. When the batch is a plain order whose outcome is known (`actionSentence()` returns a sentence), `LOCAL_ORDER_REPLY` decides: `sentence` (default) speaks that sentence with no online call, `silent` answers "" (not an error), `online` goes through `askOnline()`. The local prompt reads only the last `LOCAL_PROMPT_HISTORY` messages and a date line (`localDateLine()`, no time), so its volatile tail barely changes. The local prompt has no live-state section, and a local request aborts a prewarm under way (`prewarmAbort`). Then `askOnline()` (main client and model, `onlinePersona()` + `ONLINE_REPLY_INSTRUCTIONS`, the last `LOCAL_HISTORY` exchanges, an `onlineFacts()` system message listing this turn's local tool calls and results, and the user's exact message) streams the reply; fallback the plain sentence after `DONE_TIMEOUT_MS`, else the local draft, else `GENERAL_UNAVAILABLE`. Local turns with memory also get `SHARE_MEMORY_TOOL` (`share_memory`), handled in the engine by `shareMemory()`: only requested texts matching a held fact are returned, and `onlineFacts()` lists only those verified memories, never the request. The local prompt's persona is `localPersona(LOCAL_LLM_PROMPT)` (`LOCAL_IDENTITY` + the owner's working rules), never the request's persona.

STT (optional): `STT_PROVIDER` (`openai` | `mistral` | `none`, default `none`), `STT_API_KEY` (overrides `OPENAI_API_KEY`, or `MISTRAL_API_KEY` for mistral), `STT_BASE_URL` (custom Whisper-compatible endpoint; mistral defaults to `https://api.mistral.ai/v1`), `STT_MODEL` (default `whisper-1`, or `voxtral-mini-latest` for mistral). The add-on sets `STT_PROVIDER=mistral` when a Mistral key exists unless `speech_to_text: off`; the chat panel shows its 🎤 button only when `/api/health` reports `stt: true`

TTS (optional): `TTS_PROVIDER` (`openai` | `mistral` | `none`, default `none`; mistral = Voxtral, keyed by `MISTRAL_API_KEY`), `TTS_API_KEY` (overrides `OPENAI_API_KEY`), `TTS_BASE_URL` (custom OpenAI-compatible endpoint), `TTS_MODEL` (default `tts-1`), `TTS_VOICE` (default `alloy`)

Integration tests: `SHODH_TEST_URL`, `SHODH_TEST_API_KEY`

## Authentication

Bearer token auth via `API_TOKEN`. The add-on ALWAYS sets it (since 0.9.3); while the companion integration has not yet written its SHA-256 receipt, `options-to-env.sh` also sets `API_AUTH_GRACE=true`, and then Home Assistant Core (`172.30.32.1`, `HA_CORE_ADDRESSES`) alone may call without a token; every other caller needs it. `createAuthMiddleware` also shuts out an address after 20 failures in 10 minutes (429 for 15 minutes). Auth runs before any body parsing: `express.json` is 80 MB on `/api/chat*` only, 1 MB elsewhere. When `API_TOKEN` is unset (standalone dev) everything passes and a warning is logged.

Tool policy (`llm/tool-policy.ts`): `CONFIG_EDITS` off|automations|yaml filters the automation write tools and `write_config_file`; an unattended turn (`ChatRequest.unattended`: scheduler runs, and `/api/chat*` requests without a conversationId, i.e. AI Task) gets no tool that needs a person (automation writes, write_config_file, forget_memory, schedule_task, cancel_scheduled_task, notify_when, use_connector), filtered from the tool list AND refused in `handleToolCall`. Sensitive `call_service` calls (`SENSITIVE_SERVICES` / `SENSITIVE_DOMAINS` in tool-handler.ts: lock unlock/open, alarm disarm, homeassistant.restart/stop, androidtv.adb_command, recorder purges, shell_command/python_script/pyscript/rest_command/command_line) go through the preview-and-confirm gate keyed by service+target, and are refused without continuity. `write_config_file` refuses new occurrences of `FORBIDDEN_ADDITIONS` (config-files.ts). The panel shows only raster blobs (`RASTER_TYPES`) and re-types downloads as octet-stream; non-API responses carry a CSP.

- **Health endpoint** (`/api/health`) is always public, even when auth is enabled
- **Timing-safe comparison** prevents timing attacks on the token
- **Ingress**: a request carrying `X-Remote-User-Id` skips the token only when its peer address is the Supervisor ingress proxy (`172.30.32.2`, `INGRESS_PROXY_ADDRESSES` in `api/auth.ts`); other add-ons on the hassio network can reach port 3100 and set the header themselves
- **HA URL paths**: `HomeAssistantClient` shape-checks every model-supplied id before it reaches a URL path (entity_id, service domain/name, automation config id), because `..` segments would otherwise reach the Supervisor API with the add-on token. `hassio.*` and `homeassistant.stop` are refused from `call_service` and from automation actions (`isBlockedService`)
- **Conversations are per user**: `GET`/`DELETE /api/conversations/:userId/:conversationId` and the engines' history only see the requesting user's messages, since thread ids are chosen by the caller
- **HACS config flow** validates tokens against `/api/memory/{userId}` (not `/api/health`, since health bypasses auth)

## API Endpoints

- `POST /api/chat` — Full response (uses streaming internally). Body: `{ message, userId?, conversationId?, isVoice?, customPrompt? }`
- `POST /api/chat/stream` — SSE streaming (`event: chunk` then `event: done`). Same body as `/api/chat`
- `POST /api/stt` — Transcribe audio. Multipart `audio` field. Returns `{ text }`. 501 if `STT_PROVIDER=none`.
- `POST /api/tts` — Synthesize speech. Body `{ text, language? }`. Returns `audio/mpeg`. 501 if `TTS_PROVIDER=none`.
- `GET /api/health` — Health check (always public, bypasses auth)
- `GET /api/memory/:userId` — List user's facts
- `POST /api/memory/:userId/facts` — Add fact manually
- `POST /api/memory/:userId/merge`: one-time copy of other known users' facts into this user (see "Whose memory" above). Returns `{ merged, sources: [{ userId, copied, duplicates }] }`, or `{ merged: 0, skipped: true }` once it has run
- `DELETE /api/memory/:userId` — Clear all facts
- `DELETE /api/memory/:userId/facts/:factId` — Delete specific fact
- `GET /api/conversations/:userId` — List conversations
- `GET /api/conversations/:userId/:conversationId` — Get conversation messages
- `PATCH /api/conversations/:userId/:conversationId` — Rename and/or favourite (body `{ title?, pinned? }`, title 1-120 chars; 404 unless the user has messages in it). Titles in `conversation_titles`, favourites in `conversation_pins` (`ConversationSummary.pinned`), both removed with the conversation
- `DELETE /api/conversations/:userId/:conversationId` — Delete conversation
- `GET /api/running/:userId` — Threads with a reply still being written (`api/running-turns.ts`, fed by both chat routes for `mado-thread:` ids); `GET /api/running/:userId/:conversationId` → `{ running, text, status }` so a panel that lost its stream can follow the reply until it is stored. A new thread's first request also gets a title from `llm/thread-title.ts` (extraction model, run alongside the reply), stored with `setConversationTitle` and sent as SSE `event: title`
- **0.9 features** (not an endpoint): `schedule_task` takes `in_minutes` / `in_hours` / `in_days` + `time`, computed by `relativeTime()` in `jobs/scheduler.ts` (local calendar days, elapsed minutes/hours; the tool result's `when` is `formatLocal()`, weekday included). Schedule type `when` (`notify_when` tool): entity + op (equals/not_equals/below/above) + value + forMinutes + until, checked each tick through `SchedulerDeps.readState` (exposure-bounded `getState`), fires once. `send_notification` → `Scheduler.notifyNow` (20/hour). House watch `jobs/house-watch.ts` (`HOUSE_WATCH` off|on|all, `WATCH_QUIET_HOURS`, `WATCH_MAX_PER_DAY`, `WATCH_LIVELY_TIME`): `findIssues()` / `findFailedAutomations()` (websocket `trace/list`) every 5 min, cooldowns urgent 1 h / warn 6 h / info 24 h, judged by `llm/one-shot.ts` (FAST_MODEL, else EXTRACTION_MODEL, else main; JSON verdict), safety always sent, memo in `house-watch.json`, alerts stored in `mado-thread:house-watch`. `CONFIG_TOOLS` (text and thread styles): `get_config_item`, `get_automation_traces`, `read_config_file` (`ha/config-files.ts`, `HA_CONFIG_DIR` default `/config`, YAML only, no secrets.yaml, no escape via `..` or symlinks, secret-looking values masked), `check_ha_config`; `write_config_file` (handled in `tool-handler.ts`, refused without conversation continuity): call 1 keeps the full new content server-side (`prepareConfigWrite`, pending per conversation+path, 15 min) and returns a diff of the masked texts; call 2 in a later turn (`confirm: true`, optional `backup`) writes exactly that content (`applyConfigWrite`; refused if the file changed since), runs `checkConfig()` and `revertConfigWrite()` on failure, reloads script/automation/scene for their files; `restoreMasked()` puts back values the model only saw as «masqué»
- `GET /api/app-token` — `{ token }` (the API token) only for a request Home Assistant ingress authenticated (`isIngressRequest`), 403 otherwise; the panel's 🔑 shows it for copying into the installed app. PWA: `public/manifest.webmanifest`, `public/sw.js` (network-first page shell, never touches `api/`; Android share target posts to `./share`, kept in the `mado-share-v1` cache and picked up by the panel on `?share=1`), `public/icons/`; `POST /share` on the server only redirects to `./` for a share that arrives before the worker is installed. The worker is registered only when the panel is not framed (not under ingress) and in a secure context
- **Action chips** (not an endpoint): `llm/action-chips.ts` turns successful `call_service` results (Home Assistant's changed states), `schedule_task` / `notify_when` and confirmed automation writes into `{kind, label}` chips on `ToolContext.actions`; both engines return them as `ChatResponse.actions` (so in the SSE `done` event) and store them with the assistant message (`setMessageActions`, SQLite table `message_actions`, cascade-deleted with the message). `GET /api/conversations/:userId/:conversationId` returns them as `messages[].actions`; the panel shows them above the answer. Panel theme: CSS variables on `:root`, dark values under `prefers-color-scheme: dark`
- `GET /api/admin/conversations` — All users + conversation summaries (ingress only)

## Deployment

**How this actually ships:** as part of the Igor add-on (directory `nives/`, a name kept for compatibility with existing installs), not standalone. The add-on's `nives/Dockerfile` builds this source in a Node stage, and s6-overlay runs it alongside Shodh in one container. Shodh comes from a **GitHub release binary** (both `linux-x64` and `linux-arm64` — the official Docker image is amd64-only), not from Docker Hub. See `nives/CLAUDE.md` for the s6 service layout and the config bridge.

**The HA integration is not installed via HACS.** It ships inside this repo at `nives/rootfs/opt/nives/` and the `install-integration` s6 oneshot copies it into `/config/custom_components/nives/` on startup, whenever its content differs from the installed copy. Users never touch HACS.


## Known Limitations

- Single-user only (multi-user via OIDC planned)
- Conversation history lost on server restart by default (set `CONVERSATION_STORAGE=sqlite` for persistence)
- Both chat and extraction use the same model (configured via `LLM_MODEL`)
- Fact extraction sometimes stores transient state or LLM hallucinations (improvement planned)
