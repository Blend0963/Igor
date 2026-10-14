# Changelog

## 0.4.1 — A real viewfinder

- The 📷 button opens a viewfinder inside the chat panel (live preview, shutter, front/back switch) instead of a file picker. The `capture` hint it relied on is ignored by desktop browsers and some app webviews, which showed the same picker as 📎. The photo is taken at up to 1600 px and lands in the message like an attachment. Where the camera cannot be opened (permission refused, no camera), the file picker remains the fallback. The camera stops as soon as the photo is taken, the viewfinder is closed, or the app goes to the background.

## 0.4.0 — A prompt for each kind of conversation

- Three conversation styles instead of two. Voice Assist stays short and spoken, typed Assist stays plain text, and chat-panel threads get their own built-in instructions: a general-purpose assistant that still runs the home, with Markdown, code blocks and answers as long as the question needs.
- New add-on options `custom_prompt_voice` and `custom_prompt_thread`, appended to `custom_prompt` for that kind of conversation only, so shared rules (identity, contacts, confirmations) are written once and only the style differs. Existing installs keep exactly the persona they had.
- New option `assist_mode` (`auto` / `voice` / `text`). Home Assistant only marks satellite requests as spoken, so voice from the phone app used to get the typed style; `voice` treats every Assist request as spoken. Threads are never affected.
- When a custom persona is set, the built-in instructions now say that it wins on style (length, tone, language, preambles, what needs a confirmation), except for the confirm-first flows the tools enforce and honesty about what actually happened.
- Voice replies no longer read web addresses aloud: sources are named instead of linked.
- The built-in instructions' examples are now French instead of Slovenian (inherited from the upstream project).
- Images in chat threads: attach with 📎, take a photo with 📷 (opens the phone's camera in the Home Assistant app), paste, or drop onto the panel, then ask about it, or send the photo alone for "what is this?". Photos are shrunk to 1600 px JPEG in the browser before they leave. Images go to the model with the message but are not stored: the thread remembers what MaDo said about them. Needs a vision-capable model (Mistral Large/Medium/Small 3+, Claude, GPT-4o…).
- Mistral receives images in its documented form (`image_url` as a plain string); other providers keep the OpenAI form with `detail: "low"`. Images must be JPEG/PNG/WebP/GIF data URLs or https links.
- Rename a thread: ✎ next to it in the sidebar, or click its title. Names are kept server-side (`PATCH /api/conversations/:userId/:conversationId`) and removed with the thread.
- Microphone in chat threads (🎤): speak, tap ⏹, and the transcript is sent like a typed message (or added to what you were typing). Recorded in the browser, converted to 16 kHz WAV, transcribed by Mistral's Voxtral. New option `speech_to_text` (`auto` / `off`): on by default whenever a Mistral key is available (the web-search key, or the chat key with the Mistral provider). The button only shows when transcription is on; where the browser cannot record, the phone's recorder opens instead. With transcription on, MaDo also appears as a speech-to-text engine in Home Assistant's voice assistant settings.
- The chat panel is added to the Home Assistant sidebar automatically, once, on the first start of this version (Supervisor leaves "Show in sidebar" off for ingress add-ons). Switching it off again sticks.
- Fix the empty bubble above every answer in the panel: the server opens each model turn, the first one included, and the panel opened a new bubble for each. Errors now show in the answer bubble instead of an empty one.

## 0.3.2 — Code blocks with a copy button

- The thread panel shows code in assistant replies the way chat apps do: each ``` fenced block gets its own box with the language and a "Copier" button, and `inline code` is set in monospace. Rendering is built from DOM text nodes only, so a reply can never inject markup, and a block still being streamed already shows as code. The copy falls back to a textarea copy where Home Assistant's ingress frame refuses the clipboard API. Assist and voice are unchanged.

## 0.3.1 — Threads answer again

- Fix every panel thread failing with "Aucune réponse du serveur": a thread's memory bucket was named `<user>@mado-thread:<id>`, and Shodh rejects the `:` in a user_id (400 INVALID_INPUT). The bucket is now `<user>@mado-thread.<id>`, using only the characters Shodh accepts. Assist was not affected.

## 0.3.0 — Sealed threads, security hardening

- Panel threads are now fully sealed off. Each thread has its own long-term memory (facts learned there stay there), its semantic recall only searches that thread, and `forget_memory` only touches it; nothing from Assist or from the other threads reaches it, and nothing learned in a thread reaches them. Assist keeps one memory shared by every device. Before, only the short-term history was separate: facts and recall leaked both ways.
- Threads keep up to 500 messages instead of 20, so a long thread no longer forgets its own beginning; deleting a thread also deletes everything it memorised.

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
