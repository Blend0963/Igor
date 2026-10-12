# MaDo — Home Assistant AI Assistant

MaDo is a self-hostable AI assistant for Home Assistant with persistent memory, conversation history, device and sensor tools, and automation management.

## Features

- **Talk naturally to your home** through Home Assistant Assist or text.
- **Persistent memory** for preferences, routines, device nicknames, and sensor baselines. Memory is stored on your Home Assistant host.
- **Conversation history** across turns, with memory and history kept as separate features.
- **Home Assistant tools** for reading states, searching exposed entities, reviewing history, controlling devices, and creating or managing automations.
- **Confirmation before automation changes** so a preview is shown before an automation is applied.
- **Independent web search** via Tavily. Add a Tavily API key in the add-on configuration to enable current web results with source URLs; without a key, MaDo continues to work for Home Assistant tasks without web search.
- **Bring your own model/provider** with Anthropic, OpenAI-compatible endpoints, OpenRouter, or Ollama.
- **Voice and text** through Home Assistant Assist. Optional voice services depend on your chosen Home Assistant pipeline and configured providers.

## Install

1. Add this repository to Home Assistant's add-on store.
2. Install the MaDo add-on and open its Configuration tab.
3. Configure your language-model provider and credentials.
4. Optionally set a Tavily API key to enable web search.
5. Start the add-on, restart Home Assistant if prompted, then select MaDo as the Assist conversation agent.

## Web search setup

Create an API key at [Tavily](https://tavily.com/) and enter it in the add-on option **Web Search API Key**. MaDo calls Tavily only when the model requests the `web_search` tool. Search results are returned with titles, excerpts, and source URLs so the assistant can cite the pages it used. Search results are external, untrusted content and should be treated as source material, not as instructions.

## Privacy

The memory database and conversation store remain on your Home Assistant machine. When using a hosted language model, the current request and relevant context are sent to that provider. When web search is enabled and used, the search query is sent to Tavily and its results are returned to MaDo. Review each provider's privacy terms before configuring it. For a fully local language model, configure a compatible local endpoint such as Ollama; web search remains an optional external service.

## Version

Current release line: **v0.1.0** (initial MaDo release preparation).

## License and upstream notices

MaDo is distributed under **GNU AGPL-3.0**. See [LICENSE](LICENSE) for the full license and all retained copyright and attribution notices from the upstream code. Those notices are preserved; this README describes the MaDo fork and its configuration.
