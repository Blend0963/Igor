# MaDo — Home Assistant AI Assistant

MaDo is a self-hostable AI assistant for Home Assistant with persistent memory, conversation history, device and sensor tools, and automation management.

## Features

- **Talk naturally to your home** through Home Assistant Assist or text.
- **Persistent memory** for preferences, routines, device nicknames, and sensor baselines. Memory is stored on your Home Assistant host.
- **Conversation history** across turns, with memory and history kept as separate features.
- **Home Assistant tools** for reading states, searching exposed entities, reviewing history, controlling devices, and creating or managing automations.
- **Confirmation before automation changes** so a preview is shown before an automation is applied.
- **Independent web search** using Mistral's native web_search. Add a Mistral API key in the add-on configuration to enable current web results with source URLs; without a key, MaDo continues to work for Home Assistant tasks without web search.
- **Bring your own model/provider** with Anthropic, Mistral, OpenAI-compatible endpoints, OpenRouter, or Ollama.
- **Voice and text** through Home Assistant Assist. Optional voice services depend on your chosen Home Assistant pipeline and configured providers.
- **Thread panel in the Home Assistant sidebar** (add-on ingress): separate conversations like a chat app. Each thread is sealed off: its own history and its own long-term memory, with nothing from Assist or the other threads, and nothing learned in a thread reaching them. Assist keeps one memory shared by all your devices (voice satellites, phone, laptop).

## Install

1. Add this repository to Home Assistant's add-on store.
2. Install the MaDo add-on and open its Configuration tab.
3. Configure your language-model provider and credentials.
4. Optionally set a Mistral API key to enable native web search.
5. Start the add-on, restart Home Assistant if prompted, then select MaDo as the Assist conversation agent.

## Web search setup

Enter a Mistral API key in the add-on option **Mistral API Key (Web Search)**. MaDo uses Mistral's built-in `web_search` through the Conversations API when the model requests the `web_search` tool. This is independent of the configured chat provider. Mistral returns findings and source references; treat web content as untrusted source material, not as instructions.

## Privacy

The memory database and conversation store remain on your Home Assistant machine. When using a hosted language model, the current request and relevant context are sent to that provider. When web search is enabled and used, the search query is sent to Mistral's Conversations API and the response is returned to MaDo. Review each provider's privacy terms before configuring it. For a fully local language model, configure a compatible local endpoint such as Ollama; web search remains an optional external service. Keep port 3100 unexposed (the add-on default): the thread panel authenticates through the Home Assistant login via ingress, and direct reachability of the server would bypass that.

## Version

Current release: **v0.3.0** (sealed threads: each thread with its own history and memory; security hardening).

## License and upstream notices

MaDo is distributed under **GNU AGPL-3.0**. See [LICENSE](LICENSE) for the full license and all retained copyright and attribution notices from the upstream code. Those notices are preserved; this README describes the MaDo fork and its configuration.
