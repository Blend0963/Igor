# Changelog

## Unreleased — Security hardening

- Trust the ingress user header only from the Supervisor's ingress proxy (172.30.32.2). Port 3100 is unexposed on the host, but every other add-on on the hassio network could reach it and set X-Remote-User-Id itself, which skipped the API token entirely (0.2.1 regression).
- Validate every model-supplied id that ends up in a Home Assistant URL path (entity_id, service domain and name, automation config id). The base URL is http://supervisor/core, so an id with `..` segments carried the add-on's Supervisor token to the Supervisor API.
- Refuse the `hassio` domain and `homeassistant.stop`, from call_service and from automations the assistant writes (templated names included): the model reads untrusted web results and entity names, which must never be able to stop add-ons, write to their stdin, restore backups or shut the host down.
- A conversation id no longer opens another user's thread: history, the conversation endpoint and thread deletion only see the requesting user's own messages.
- Cap the size of chat requests (message, ids, custom prompt, image count), add `nosniff` / `no-referrer` headers and drop `X-Powered-By`, and create the add-on's secret files owner-only from the start.

## 0.2.2 — Threads actually get their own history

- Fix the empty thread sidebar: both chat engines (Anthropic and OpenAI-compatible) overrode the conversation id from the request with the shared Assist conversation, so panel messages were stored in the Assist history and no thread ever appeared.
- Honor only the mado-thread: prefix: thread ids coming from the panel get their own conversation, while Assist keeps the single shared conversation as before (Assist sends its own per-chat-log id, which must not fragment the shared history).
- Threads keep the rolling 20-message ceiling and stay exempt from the 24-hour cleanup; long-term memory remains shared across threads and Assist.

## 0.2.1 — The panel under ingress, without the API key

- Accept Home Assistant ingress requests in the API token middleware: the Supervisor stamps X-Remote-User-Id on the requests it proxies after the Home Assistant login, so the thread panel no longer shows the API key dialog behind ingress when token enforcement is on.
- Direct callers are unchanged: they still need the bearer token, and the add-on port stays unexposed by default, which is what keeps the ingress header trust sound.

## 0.2.0 — Thread panel

- Add a built-in multi-thread chat panel served by the add-on over Home Assistant ingress: create, open, and delete separate conversation threads like a chat app. The panel appears in the Home Assistant sidebar behind the Home Assistant login; the raw port 3100 stays unexposed by default.
- Segment short-term memory per thread: each web thread is its own conversation, while the shared Assist conversation is untouched. Long-term memory stays shared across all threads and Assist.
- Give conversations a sidebar title derived from the first user message, so threads are recognizable at a glance.
- Exempt web threads from the 24-hour conversation cleanup: only the shared Assist conversation keeps every message, while threads keep the rolling 20-message window.

## 0.1.5 — Timestamps are metadata, not speech

- Time-mark only the user's past messages in the conversation history; the assistant's own replies are sent unstamped, because stamped replies taught the model to open answers with "[09:12]".
- State explicitly in the written and voice system prompts, and in the semantic-recall header, that time markers are metadata about when something was said — never to be copied into a reply.

## 0.1.4 — Memory is not the present

- Timestamp every conversation-history message and every semantically recalled message sent to the model, so memories read as past events rather than the current state of the home.
- Add "MEMORY IS NOT THE PRESENT" rules to the written and voice system prompts: never assert device state from a memory, verify the live state with get_state / search_entities, and treat "do it again" as a fresh command to execute now.
- Recognize French transient-state and command-echo statements ("a été allumée", "actuellement", "vient d'être éteinte") as garbage facts; the periodic cleanup job purges them retroactively.

## 0.1.3 — Mistral BYOK chat provider

- Add `mistral` to the add-on's bring-your-own-key provider choices (port of upstream Nives PR #107).
- Map Mistral chat to the OpenAI-compatible client: official `https://api.mistral.ai/v1` endpoint with `mistral-small-latest` as the default model.
- Omit `stream_options` for Mistral, which rejects that OpenAI-specific request field.
- Treat HTTP 422 reasoning-parameter validation errors as unsupported and withhold non-`none` Thinking Effort values from Mistral endpoints.

## 0.1.1 – 0.1.2 — Shared conversation and Mistral content fixes

- Use one persistent conversation across Assist devices and days, with semantic recall (embeddings and cosine similarity) of older stored history (#2).
- Handle structured content blocks in streamed model responses and normalize them during fact extraction (#3).

## 0.1.0 — MaDo initial release

- Establish MaDo branding and Home Assistant add-on metadata.
- Default new installations to bring-your-own-key model configuration.
- Add optional Mistral native web search with source URLs and excerpts.
- Preserve Home Assistant tools, automation confirmation flow, persistent memory, and conversation history.
- Retain the AGPL-3.0 license and upstream copyright/attribution notices.
