# MaDo server

The TypeScript API server used by the MaDo Home Assistant add-on. It provides the conversation engine, Home Assistant tool execution, persistent-memory integration, conversation history, optional voice endpoints, and optional web search.

## Architecture

- **LLM engines:** Anthropic and OpenAI-compatible chat-completions providers, including OpenAI, OpenRouter, and Ollama.
- **Home Assistant tools:** entity lookup, state/history reads, service calls, and automation management with confirmation gates.
- **Memory:** Shodh-backed persistent facts and fact extraction.
- **Conversation history:** memory-backed or SQLite storage.
- **Web search:** optional Tavily integration via `WEB_SEARCH_API_KEY`. The `web_search` tool returns titles, excerpts, and source URLs. Search results are untrusted source material.
- **Voice endpoints:** optional STT/TTS endpoints for compatible providers; Home Assistant pipeline configuration remains provider-dependent.

## Development

Requirements: Node.js 22 recommended.

```sh
npm ci
npm run build
npm test
npm run lint
```

## Configuration

The add-on's `options-to-env.sh` maps its configuration into the server's environment. Important variables include:

- `LLM_PROVIDER`, `LLM_MODEL`, and provider credentials/base URLs
- `HA_URL` and `HA_TOKEN`
- `SHODH_URL` and `SHODH_API_KEY`
- Optional `WEB_SEARCH_API_KEY` for Tavily search

Do not commit API keys or other secrets.

## Version and license

This package is version **0.1.0** and is distributed under **AGPL-3.0**. See the repository's [LICENSE](../LICENSE) for the full license and retained copyright/attribution notices.
